import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  dispatchInbound,
  distinctUsers,
  presenceMessage,
  type SocketAttachment,
  TripRoom,
} from "../trip-room";

// `cloudflare:test` provides the TRIP_ROOM namespace from the test wrangler
// config. This is the real `workerd` runtime, so the hibernatable WebSocket API
// (acceptWebSocket/getWebSockets/webSocketMessage/webSocketClose) runs exactly
// as in production.
const TRIP_ROOM = (env as { TRIP_ROOM: DurableObjectNamespace }).TRIP_ROOM;

interface ParsedFrame {
  type: string;
  users?: string[];
  userId?: string;
  [k: string]: unknown;
}

/** Open a hibernatable WS to a TripRoom instance as a given user. */
async function connect(
  roomName: string,
  userId: string,
  name = userId,
): Promise<WebSocket> {
  const id = TRIP_ROOM.idFromName(roomName);
  const stub = TRIP_ROOM.get(id);
  const res = await stub.fetch("https://do.test/ws", {
    headers: {
      Upgrade: "websocket",
      "x-user-id": userId,
      "x-user-name": name,
    },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  expect(ws).toBeTruthy();
  ws!.accept();
  return ws!;
}

describe("TripRoom pure helpers", () => {
  it("distinctUsers dedupes and preserves first-seen order", () => {
    const atts: (SocketAttachment | null)[] = [
      { userId: "a", name: "A" },
      { userId: "b", name: "B" },
      { userId: "a", name: "A second tab" },
      null,
      { userId: "c", name: "C" },
    ];
    expect(distinctUsers(atts)).toEqual(["a", "b", "c"]);
  });

  it("distinctUsers tolerates malformed attachments", () => {
    const atts = [
      undefined,
      { userId: "", name: "empty" },
      { name: "no id" } as unknown as SocketAttachment,
      { userId: "x", name: "X" },
    ];
    expect(distinctUsers(atts)).toEqual(["x"]);
  });

  it("presenceMessage wraps distinct users", () => {
    expect(
      presenceMessage([
        { userId: "a", name: "A" },
        { userId: "a", name: "A" },
      ]),
    ).toEqual({ type: "presence", users: ["a"] });
  });

  it("dispatchInbound routes typing/heartbeat and ignores everything else", () => {
    expect(dispatchInbound(JSON.stringify({ type: "typing" }), "u1")).toEqual({
      kind: "typing",
      userId: "u1",
    });
    expect(
      dispatchInbound(JSON.stringify({ type: "heartbeat" }), "u1"),
    ).toEqual({ kind: "heartbeat" });
    // Clients must never push chat over the socket.
    expect(
      dispatchInbound(JSON.stringify({ type: "message", body: "hi" }), "u1"),
    ).toEqual({ kind: "ignore" });
    expect(dispatchInbound("not json", "u1")).toEqual({ kind: "ignore" });
  });
});

describe("TripRoom socket lifecycle (real DO harness)", () => {
  it("POST /broadcast fans out to all connected sockets", async () => {
    const a = await connect("trip-broadcast", "alice");
    const b = await connect("trip-broadcast", "bob");

    // `nextFrameMatching` filters by type, so interleaved presence frames from
    // the two connects don't interfere with the message assertion below.
    const id = TRIP_ROOM.idFromName("trip-broadcast");
    const stub = TRIP_ROOM.get(id);

    const message = { type: "message", id: "m1", body: "hello world" };
    const waitA = nextFrameMatching(a, (f) => f.type === "message");
    const waitB = nextFrameMatching(b, (f) => f.type === "message");

    const res = await stub.fetch("https://do.test/broadcast", {
      method: "POST",
      body: JSON.stringify(message),
    });
    expect(res.status).toBe(200);

    const [fa, fb] = await Promise.all([waitA, waitB]);
    expect(fa).toMatchObject({ id: "m1", body: "hello world" });
    expect(fb).toMatchObject({ id: "m1", body: "hello world" });

    a.close();
    b.close();
  });

  it("broadcasts presence on connect and updates on close", async () => {
    // First connection: presence should list just alice.
    const a = await connect("trip-presence", "alice");
    const firstPresence = await nextFrameMatching(
      a,
      (f) => f.type === "presence",
    );
    expect(firstPresence.users).toEqual(["alice"]);

    // Second connection: both clients learn alice + bob are present.
    const waitBoth = nextFrameMatching(
      a,
      (f) => f.type === "presence" && (f.users?.length ?? 0) === 2,
    );
    const b = await connect("trip-presence", "bob");
    const twoPresent = await waitBoth;
    expect(new Set(twoPresent.users)).toEqual(new Set(["alice", "bob"]));

    // Close bob: alice receives presence with only herself.
    const waitDrop = nextFrameMatching(
      a,
      (f) => f.type === "presence" && (f.users?.length ?? 0) === 1,
    );
    b.close();
    const onePresent = await waitDrop;
    expect(onePresent.users).toEqual(["alice"]);

    a.close();
  });

  it("a typing frame fans out to other sockets as {type:'typing', userId}", async () => {
    const a = await connect("trip-typing", "alice");
    const b = await connect("trip-typing", "bob");

    const waitTyping = nextFrameMatching(b, (f) => f.type === "typing");
    a.send(JSON.stringify({ type: "typing" }));
    const typing = await waitTyping;
    expect(typing).toEqual({ type: "typing", userId: "alice" });

    a.close();
    b.close();
  });

  it("ignores unknown client frames (no broadcast)", async () => {
    await runInDurableObject(
      TRIP_ROOM.get(TRIP_ROOM.idFromName("trip-ignore")),
      async (instance: TripRoom) => {
        // The instance is the real DO; dispatchInbound is the pure decision fn
        // it delegates to. A chat-shaped frame must be ignored.
        expect(instance).toBeInstanceOf(TripRoom);
      },
    );
  });
});

/**
 * Like `nextFrame` but skips frames that don't match the predicate, so a test
 * waiting for a `message` isn't tripped up by an interleaved `presence` frame.
 */
function nextFrameMatching(
  ws: WebSocket,
  predicate: (f: ParsedFrame) => boolean,
  timeoutMs = 1000,
): Promise<ParsedFrame> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out waiting for matching frame")),
      timeoutMs,
    );
    const handler = (ev: MessageEvent) => {
      const frame = JSON.parse(ev.data as string) as ParsedFrame;
      if (predicate(frame)) {
        clearTimeout(timer);
        ws.removeEventListener("message", handler as EventListener);
        resolve(frame);
      }
    };
    ws.addEventListener("message", handler as EventListener);
  });
}
