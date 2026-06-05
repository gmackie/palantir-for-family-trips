// `useTripChat` — the shared (web + React Native) client hook for trip chat.
//
// Design constraints (see docs/plans/2026-06-05-trip-chat-design.md "Client UI
// + push"):
//   - Postgres is the source of truth; the WebSocket is a best-effort live feed.
//     So on EVERY (re)connect we backfill via `chat.history` and merge — a
//     dropped socket never loses a message.
//   - Optimistic send: `send` appends the row returned by the `chat.send`
//     mutation immediately, then reconciles by id when the DO echoes the same
//     message back over the socket (`mergeMessages` dedupes by id, live wins).
//   - Platform-agnostic: this file imports ONLY `react` and uses ONLY the global
//     `WebSocket` (present on both web and RN). No web-only or RN-only modules,
//     no DOM types beyond the structural `GlobalWebSocket` surface below — so the
//     same hook powers `apps/nextjs` and `apps/expo`.
//
// tRPC is injected as plain callbacks (`history`, `sendMessage`) rather than
// importing the API client, keeping the hook decoupled and unit-testable.

import { useCallback, useEffect, useRef, useState } from "react";

import type { ChatMessage, MergeItem } from "./messages";
import { mergeMessages } from "./messages";
import { createReconnectScheduler } from "./reconnect";

// --- Minimal structural WebSocket surface ----------------------------------
// We deliberately do NOT depend on lib.dom's `WebSocket` (RN's global differs
// slightly and we don't want to require `dom` in consumers' tsconfig "types").
// This captures only what the hook touches. The global is read off `globalThis`.

interface GlobalWebSocketEventMap {
  open: unknown;
  close: unknown;
  error: unknown;
  message: { data: unknown };
}

interface GlobalWebSocket {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener<K extends keyof GlobalWebSocketEventMap>(
    type: K,
    listener: (ev: GlobalWebSocketEventMap[K]) => void,
  ): void;
}

interface GlobalWebSocketCtor {
  new (url: string): GlobalWebSocket;
  readonly OPEN: number;
}

function getWebSocketCtor(): GlobalWebSocketCtor | undefined {
  return (globalThis as { WebSocket?: GlobalWebSocketCtor }).WebSocket;
}

// --- Inbound frame shapes (mirror the DO broadcasts) -----------------------
// apps/nextjs/worker/trip-room.ts + packages/api/src/router/chat.ts emit:
//   { type: "message", message }   { type: "delete", id }
//   { type: "presence", users }    { type: "typing", userId }

type InboundFrame =
  | { type: "message"; message: ChatMessage }
  | { type: "delete"; id: string }
  | { type: "presence"; users: string[] }
  | { type: "typing"; userId: string };

// Raw parsed frame before validation. We narrow off `type` and read the other
// fields defensively so a malformed broadcast can never crash the socket loop.
type RawFrame = { type?: unknown; [k: string]: unknown };

export interface UseTripChatOptions {
  /** Trip whose room to join. */
  tripId: string;
  /**
   * WebSocket origin, e.g. `wss://app.example.com` (web) or the dev host (RN).
   * The hook appends `/api/chat/${tripId}/ws`.
   */
  wsBaseUrl: string;
  /** Calls `chat.history`. Re-run on every (re)connect to backfill. */
  history: (opts: { tripId: string; limit?: number }) => Promise<ChatMessage[]>;
  /** Calls `chat.send`. Resolves with the persisted row (used optimistically). */
  sendMessage: (body: string) => Promise<ChatMessage>;
  /** Override the typing-indicator auto-clear timeout (ms). */
  typingTimeoutMs?: number;
  /** Override the outbound typing-frame throttle interval (ms). */
  typingThrottleMs?: number;
  /** History page size. */
  historyLimit?: number;
}

export interface UseTripChatResult {
  messages: ChatMessage[];
  presence: string[];
  typing: string[];
  connected: boolean;
  /** Send a message. Optimistically appends, reconciles on broadcast echo. */
  send: (body: string) => Promise<void>;
  /** Notify the room that the current user is typing (throttled). */
  sendTyping: () => void;
}

const DEFAULT_TYPING_TIMEOUT_MS = 4_000;
const DEFAULT_TYPING_THROTTLE_MS = 1_500;
const DEFAULT_HISTORY_LIMIT = 50;

export function useTripChat(opts: UseTripChatOptions): UseTripChatResult {
  const {
    tripId,
    wsBaseUrl,
    history,
    sendMessage,
    typingTimeoutMs = DEFAULT_TYPING_TIMEOUT_MS,
    typingThrottleMs = DEFAULT_TYPING_THROTTLE_MS,
    historyLimit = DEFAULT_HISTORY_LIMIT,
  } = opts;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [presence, setPresence] = useState<string[]>([]);
  const [typing, setTyping] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);

  // Refs that must survive reconnects / re-renders without re-triggering the
  // socket effect. `history`/`sendMessage` are kept in refs so the effect can
  // depend only on `tripId`/`wsBaseUrl` (the identity of the callbacks may
  // change every render without us tearing down a healthy socket).
  const historyRef = useRef(history);
  const sendMessageRef = useRef(sendMessage);
  historyRef.current = history;
  sendMessageRef.current = sendMessage;

  const socketRef = useRef<GlobalWebSocket | null>(null);
  const mountedRef = useRef(true);
  const lastTypingSentRef = useRef(0);
  // Per-user typing auto-clear timers (keyed by userId).
  const typingTimersRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );

  // Merge helper that stays referentially stable and guards unmount.
  const ingest = useCallback((items: MergeItem[]) => {
    if (!mountedRef.current) return;
    setMessages((prev) => mergeMessages(prev, items));
  }, []);

  const markTyping = useCallback(
    (userId: string) => {
      if (!mountedRef.current) return;
      setTyping((prev) => (prev.includes(userId) ? prev : [...prev, userId]));
      const timers = typingTimersRef.current;
      const existing = timers.get(userId);
      if (existing) clearTimeout(existing);
      timers.set(
        userId,
        setTimeout(() => {
          timers.delete(userId);
          if (mountedRef.current) {
            setTyping((prev) => prev.filter((u) => u !== userId));
          }
        }, typingTimeoutMs),
      );
    },
    [typingTimeoutMs],
  );

  // Socket lifecycle: connect, reconnect with capped exponential backoff,
  // backfill history on each open. Re-created only when tripId/wsBaseUrl change.
  useEffect(() => {
    mountedRef.current = true;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let closedByUs = false;
    let current: GlobalWebSocket | null = null;

    const backfill = () => {
      historyRef.current({ tripId, limit: historyLimit }).then(
        (rows) => ingest(rows),
        () => {
          /* best-effort: a failed backfill is retried on the next reconnect */
        },
      );
    };

    const connect = () => {
      // Bail before opening if there's nothing to connect to: an empty tripId
      // (or a missing WebSocket global, e.g. SSR) must never spin the loop.
      if (!tripId) return;
      const Ctor = getWebSocketCtor();
      if (!Ctor) return; // no WebSocket in this environment (e.g. SSR) — bail.

      const ws = new Ctor(`${wsBaseUrl}/api/chat/${tripId}/ws`);
      current = ws;
      socketRef.current = ws;

      ws.addEventListener("open", () => {
        if (closedByUs) return;
        attempt = 0; // reset backoff on a healthy connection
        if (mountedRef.current) setConnected(true);
        backfill();
      });

      ws.addEventListener("message", (ev) => {
        let frame: RawFrame;
        try {
          frame = JSON.parse(String(ev.data)) as RawFrame;
        } catch {
          return;
        }
        if (!frame || typeof frame !== "object") return;
        switch (frame.type) {
          case "message":
            if (frame.message) {
              const { message } = frame as Extract<
                InboundFrame,
                { type: "message" }
              >;
              ingest([message]);
            }
            break;
          case "delete":
            if (typeof frame.id === "string") {
              ingest([{ type: "delete", id: frame.id }]);
            }
            break;
          case "presence":
            if (mountedRef.current && Array.isArray(frame.users)) {
              setPresence(frame.users as string[]);
            }
            break;
          case "typing":
            if (typeof frame.userId === "string") markTyping(frame.userId);
            break;
          default:
            break; // ignore unknown frames
        }
      });

      // A failed connection fires `error` THEN `close`; the scheduler's own
      // re-entry guard makes the double registration safe (schedules once). A
      // fresh scheduler per `connect()` means its guard resets each attempt.
      const scheduler = createReconnectScheduler({
        isClosedByUs: () => closedByUs,
        onDisconnected: () => {
          if (mountedRef.current) setConnected(false);
        },
        setReconnectTimer: (fn, delayMs) => {
          reconnectTimer = setTimeout(fn, delayMs);
          return reconnectTimer;
        },
        clearReconnectTimer: (timer) => clearTimeout(timer),
        connect,
        getAttempt: () => attempt,
        setAttempt: (next) => {
          attempt = next;
        },
      });
      ws.addEventListener("close", scheduler.onDown);
      ws.addEventListener("error", scheduler.onDown);
    };

    connect();

    return () => {
      closedByUs = true;
      mountedRef.current = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      for (const t of typingTimersRef.current.values()) clearTimeout(t);
      typingTimersRef.current.clear();
      try {
        current?.close();
      } catch {
        /* ignore */
      }
      socketRef.current = null;
    };
  }, [tripId, wsBaseUrl, historyLimit, ingest, markTyping]);

  const send = useCallback(
    async (body: string) => {
      const trimmed = body.trim();
      if (!trimmed) return;
      const row = await sendMessageRef.current(trimmed);
      // Optimistic append; the live `{type:"message"}` echo reconciles by id.
      ingest([row]);
    },
    [ingest],
  );

  const sendTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSentRef.current < typingThrottleMs) return;
    const ws = socketRef.current;
    const Ctor = getWebSocketCtor();
    if (!ws || !Ctor || ws.readyState !== Ctor.OPEN) return;
    lastTypingSentRef.current = now;
    try {
      ws.send(JSON.stringify({ type: "typing" }));
    } catch {
      /* ignore transient send failures */
    }
  }, [typingThrottleMs]);

  return { messages, presence, typing, connected, send, sendTyping };
}
