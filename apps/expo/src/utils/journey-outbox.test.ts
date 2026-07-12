import { describe, expect, it } from "vitest";

import { JourneyOutbox, type JourneyStopCommand } from "./journey-outbox";

function memoryStorage(seed?: string) {
  let value = seed ?? null;
  return {
    get: async () => value,
    set: async (next: string) => {
      value = next;
    },
  };
}

const command: JourneyStopCommand = {
  stopId: "a4c843a0-f21d-4930-af8e-b5178bc5cc08",
  workspaceId: "workspace-1",
  tripId: "trip-1",
  name: "Avery Park",
  lat: 45.7,
  lng: -121,
  arrivedAt: "2026-07-12T15:00:00.000Z",
  kind: "camp",
  note: "First night",
};

describe("JourneyOutbox", () => {
  it("persists commands and removes them only after confirmed delivery", async () => {
    const storage = memoryStorage();
    const outbox = new JourneyOutbox(storage);
    await outbox.enqueue(command);

    expect(await outbox.list()).toMatchObject([
      { command, state: "pending", attempts: 0 },
    ]);

    await outbox.flush(async () => undefined);
    expect(await outbox.list()).toEqual([]);
  });

  it("rehydrates failures and retries the same stop id", async () => {
    const storage = memoryStorage();
    const first = new JourneyOutbox(storage);
    await first.enqueue(command);
    await first.flush(async () => {
      throw new Error("offline");
    });

    const restarted = new JourneyOutbox(storage);
    expect(await restarted.list()).toMatchObject([
      { command, state: "failed", attempts: 1, error: "offline" },
    ]);
    const delivered: string[] = [];
    await restarted.flush(async (queued) => {
      delivered.push(queued.stopId);
    });
    expect(delivered).toEqual([command.stopId]);
    expect(await restarted.list()).toEqual([]);
  });

  it("coalesces simultaneous flushes", async () => {
    const outbox = new JourneyOutbox(memoryStorage());
    await outbox.enqueue(command);
    let sends = 0;
    const send = async () => {
      sends += 1;
    };

    await Promise.all([outbox.flush(send), outbox.flush(send)]);
    expect(sends).toBe(1);
  });
});
