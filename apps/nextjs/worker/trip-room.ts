// `TripRoom` — the first Durable Object in this codebase.
//
// One instance per trip (addressed via `idFromName(tripId)`). It is a fan-out +
// presence hub ONLY — Postgres is the source of truth for chat history. Clients
// never send chat messages over the socket; the only inbound frames are
// `typing` and `heartbeat`. Chat is persisted via tRPC, which then POSTs to this
// DO's `/broadcast` endpoint to fan the new message out to connected sockets.
//
// Uses the hibernatable WebSocket API (`acceptWebSocket` / `getWebSockets` /
// `webSocketMessage` / `webSocketClose` handler methods) so the DO can be
// evicted from memory between events without dropping connections.
//
// The worker (Task 4) authenticates the session + verifies trip membership
// BEFORE forwarding the upgrade here, attaching trusted `x-user-id` /
// `x-user-name` headers. This DO trusts those headers unconditionally; it must
// never be reachable directly from the public internet.

import type { Env } from "./index";

// --- Minimal ambient Cloudflare runtime surface ----------------------------
// The worker entry compiles raw TS without `@cloudflare/workers-types` in its
// tsc env (see `cf-globals.d.ts`). Declare just the surface this DO touches so
// `tsc --noEmit` stays clean without pulling in the full types package. At
// runtime these are provided by the Workers runtime.

interface CfWebSocket {
  send(message: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
  readyState: number;
}

interface WebSocketPairCtor {
  new (): { 0: CfWebSocket; 1: CfWebSocket };
}

interface DurableObjectState {
  acceptWebSocket(ws: CfWebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): CfWebSocket[];
}

// Provided by the Workers runtime globally.
declare const WebSocketPair: WebSocketPairCtor;
// `WebSocket.READY_STATE_OPEN` is `1` in the Workers runtime.
const WS_OPEN = 1;

// The Workers runtime extends `ResponseInit` with a `webSocket` field for 101
// upgrade responses. The DOM lib that tsc uses here doesn't know about it.
interface WorkerResponseInit extends ResponseInit {
  webSocket?: CfWebSocket;
}

// --- Pure helpers (unit-testable without the DO harness) --------------------

/** Attachment shape stored per-socket via `serializeAttachment`. */
export interface SocketAttachment {
  userId: string;
  name: string;
}

/**
 * Collect the distinct user ids from a set of socket attachments, preserving
 * first-seen order. A user with multiple open sockets (e.g. two tabs) counts
 * once. Tolerant of `null`/malformed attachments.
 */
export function distinctUsers(
  attachments: readonly (SocketAttachment | null | undefined)[],
): string[] {
  const seen = new Set<string>();
  const users: string[] = [];
  for (const att of attachments) {
    const userId = att?.userId;
    if (typeof userId === "string" && userId && !seen.has(userId)) {
      seen.add(userId);
      users.push(userId);
    }
  }
  return users;
}

/** Build the presence broadcast payload from socket attachments. */
export function presenceMessage(
  attachments: readonly (SocketAttachment | null | undefined)[],
): { type: "presence"; users: string[] } {
  return { type: "presence", users: distinctUsers(attachments) };
}

export type InboundFrame =
  | { type: "typing" }
  | { type: "heartbeat" }
  | { type: string; [k: string]: unknown };

export type DispatchAction =
  | { kind: "typing"; userId: string }
  | { kind: "heartbeat" }
  | { kind: "ignore" };

/**
 * Decide what to do with a raw inbound WS frame. Pure so the dispatch logic can
 * be unit-tested without sockets. Clients may only send `typing`/`heartbeat`;
 * everything else (including chat) is ignored — chat arrives via `/broadcast`.
 */
export function dispatchInbound(raw: string, userId: string): DispatchAction {
  let frame: InboundFrame;
  try {
    frame = JSON.parse(raw) as InboundFrame;
  } catch {
    return { kind: "ignore" };
  }
  if (!frame || typeof frame !== "object") return { kind: "ignore" };
  switch (frame.type) {
    case "typing":
      return { kind: "typing", userId };
    case "heartbeat":
      return { kind: "heartbeat" };
    default:
      return { kind: "ignore" };
  }
}

// --- The Durable Object -----------------------------------------------------

export class TripRoom {
  private state: DurableObjectState;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Server-to-DO fan-out: tRPC persists a message then POSTs it here.
    if (url.pathname === "/broadcast") {
      if (req.method !== "POST") {
        return new Response("method not allowed", { status: 405 });
      }
      let msg: unknown;
      try {
        msg = await req.json();
      } catch {
        return new Response("invalid json", { status: 400 });
      }
      this.broadcast(msg);
      return new Response(null, { status: 200 });
    }

    // Otherwise: WebSocket upgrade. The worker has already authenticated the
    // session + verified trip membership and set these trusted headers.
    const userId = req.headers.get("x-user-id");
    if (!userId) {
      return new Response("missing identity", { status: 400 });
    }
    const name = req.headers.get("x-user-name") ?? "";

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Hibernation: tag the socket with the userId so the runtime can route to
    // it and so attachments survive eviction.
    this.state.acceptWebSocket(server, [userId]);
    const attachment: SocketAttachment = { userId, name };
    server.serializeAttachment(attachment);

    // A new connection changes presence for everyone.
    this.broadcastPresence();

    return new Response(null, {
      status: 101,
      webSocket: client,
    } as WorkerResponseInit);
  }

  // --- Hibernation WebSocket handlers ---------------------------------------

  webSocketMessage(ws: CfWebSocket, raw: string | ArrayBuffer): void {
    if (typeof raw !== "string") return; // we only speak JSON text frames
    const att = ws.deserializeAttachment() as SocketAttachment | null;
    const userId = att?.userId ?? "";
    const action = dispatchInbound(raw, userId);
    switch (action.kind) {
      case "typing":
        this.broadcast({ type: "typing", userId: action.userId });
        return;
      case "heartbeat":
        // No-op: receiving any frame already keeps the connection alive. We
        // re-broadcast presence cheaply so late joiners stay in sync.
        return;
      case "ignore":
        return;
    }
  }

  webSocketClose(_ws: CfWebSocket): void {
    this.broadcastPresence();
  }

  webSocketError(_ws: CfWebSocket): void {
    this.broadcastPresence();
  }

  // --- Internal fan-out helpers ---------------------------------------------

  private broadcast(msg: unknown): void {
    const payload = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      // Guard against sockets mid-close; `send` on a closed socket throws.
      if (ws.readyState !== WS_OPEN) continue;
      try {
        ws.send(payload);
      } catch {
        // Socket went away between the readyState check and send; ignore.
      }
    }
  }

  private broadcastPresence(): void {
    const attachments = this.state
      .getWebSockets()
      .map((ws) => ws.deserializeAttachment() as SocketAttachment | null);
    this.broadcast(presenceMessage(attachments));
  }
}
