// `useTripLocations` — the shared (web + React Native) client hook for live
// member locations on the trip map.
//
// Design constraints mirror `useTripChat` exactly (see that file's header and
// docs/plans/2026-06-08-road-trip-driving-bundle.md "Feature 1a → Task 5"):
//   - Postgres is the source of truth; the WebSocket is a best-effort live feed.
//     So on EVERY (re)connect we backfill via `location.listMemberLocations` and
//     merge — a dropped socket never strands the map on a stale position.
//   - It joins the SAME trip-room WebSocket as chat (`/api/chat/${tripId}/ws`).
//     The `TripRoom` Durable Object relay is payload-agnostic, so the server's
//     `updateLocation` broadcast (`{ type: "location", ... }`) arrives on this
//     socket alongside chat frames; we filter for `type === "location"`.
//   - Platform-agnostic: imports ONLY `react` and uses ONLY the global
//     `WebSocket` (present on web and RN). No DOM-only / RN-only modules.
//
// tRPC is injected as a plain `backfill` callback rather than importing the API
// client, keeping the hook decoupled and unit-testable. The newest-wins merge is
// the pure `mergeLocations` reducer in ./locations.ts.

import { useCallback, useEffect, useRef, useState } from "react";

import type { LocationEvent, LocationState } from "./locations";
import { mergeLocations } from "./locations";
import { createReconnectScheduler } from "./reconnect";

// --- Minimal structural WebSocket surface ----------------------------------
// Identical to `useTripChat`: avoid depending on lib.dom's `WebSocket` (RN's
// global differs slightly) and capture only what the hook touches.

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

// Raw parsed frame before validation. We narrow off `type` and read the other
// fields defensively so a malformed broadcast can never crash the socket loop.
type RawFrame = { type?: unknown; [k: string]: unknown };

/**
 * Validate a parsed frame as a `location` event. Returns `null` for any other
 * frame type (e.g. chat `message`/`presence`/`typing` that share this socket) or
 * a malformed location frame, so the socket loop can never crash on bad input.
 */
function parseLocationFrame(frame: RawFrame): LocationEvent | null {
  if (frame.type !== "location") return null;
  if (typeof frame.userId !== "string") return null;
  if (typeof frame.lat !== "number" || typeof frame.lng !== "number") {
    return null;
  }
  const heading = typeof frame.heading === "number" ? frame.heading : null;
  const speed = typeof frame.speed === "number" ? frame.speed : null;
  const updatedAt =
    typeof frame.updatedAt === "string" ||
    typeof frame.updatedAt === "number" ||
    frame.updatedAt instanceof Date
      ? frame.updatedAt
      : Date.now();
  return {
    userId: frame.userId,
    lat: frame.lat,
    lng: frame.lng,
    heading,
    speed,
    updatedAt,
  };
}

export interface UseTripLocationsOptions {
  /** Trip whose room to join. */
  tripId: string;
  /**
   * WebSocket origin, e.g. `wss://app.example.com` (web) or the dev host (RN).
   * The hook appends `/api/chat/${tripId}/ws` — the SAME room chat uses.
   */
  wsBaseUrl: string;
  /**
   * Calls `location.listMemberLocations`. Re-run on every (re)connect to
   * backfill the latest persisted positions (cold-start / fallback source).
   */
  backfill: (opts: { tripId: string }) => Promise<LocationEvent[]>;
}

export interface UseTripLocationsResult {
  /** Per-user latest position, keyed by `userId`. Newest `updatedAt` wins. */
  locations: LocationState;
  /** Whether the live socket is currently open. */
  connected: boolean;
}

export function useTripLocations(
  opts: UseTripLocationsOptions,
): UseTripLocationsResult {
  const { tripId, wsBaseUrl, backfill } = opts;

  const [locations, setLocations] = useState<LocationState>({});
  const [connected, setConnected] = useState(false);

  // Keep `backfill` in a ref so the socket effect can depend only on
  // `tripId`/`wsBaseUrl` — a changing callback identity must not tear down a
  // healthy socket (mirrors `useTripChat`).
  const backfillRef = useRef(backfill);
  backfillRef.current = backfill;

  const mountedRef = useRef(true);

  // Merge a single event in, guarding unmount. `mergeLocations` returns the same
  // reference when the frame is older/equal, so React skips a no-op re-render.
  const ingest = useCallback((event: LocationEvent) => {
    if (!mountedRef.current) return;
    setLocations((prev) => mergeLocations(prev, event));
  }, []);

  // Socket lifecycle: connect, reconnect with capped exponential backoff,
  // backfill on each open. Re-created only when tripId/wsBaseUrl change.
  useEffect(() => {
    mountedRef.current = true;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let closedByUs = false;
    let current: GlobalWebSocket | null = null;

    const runBackfill = () => {
      backfillRef.current({ tripId }).then(
        (rows) => {
          if (!mountedRef.current) return;
          // Fold each persisted row through the newest-wins reducer so a live
          // frame that beat the backfill is never overwritten by a stale row.
          setLocations((prev) => {
            let next = prev;
            for (const row of rows) next = mergeLocations(next, row);
            return next;
          });
        },
        () => {
          // best-effort: a failed backfill is retried on the next reconnect.
        },
      );
    };

    const connect = () => {
      if (!tripId) return; // empty tripId must never spin the loop.
      const Ctor = getWebSocketCtor();
      if (!Ctor) return; // no WebSocket in this environment (e.g. SSR) — bail.

      const ws = new Ctor(`${wsBaseUrl}/api/chat/${tripId}/ws`);
      current = ws;

      ws.addEventListener("open", () => {
        if (closedByUs) return;
        attempt = 0; // reset backoff on a healthy connection
        if (mountedRef.current) setConnected(true);
        runBackfill();
      });

      ws.addEventListener("message", (ev) => {
        let frame: RawFrame;
        try {
          frame = JSON.parse(String(ev.data)) as RawFrame;
        } catch {
          return;
        }
        if (!frame || typeof frame !== "object") return;
        const event = parseLocationFrame(frame);
        if (event) ingest(event);
      });

      // `error` then `close` both fire on a failed connection; the scheduler's
      // re-entry guard makes the double registration safe (schedules once).
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
      try {
        current?.close();
      } catch {
        /* ignore */
      }
    };
  }, [tripId, wsBaseUrl, ingest]);

  return { locations, connected };
}
