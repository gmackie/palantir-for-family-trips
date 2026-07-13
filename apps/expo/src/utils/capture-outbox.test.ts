import { describe, expect, it } from "vitest";

import {
  CaptureOutbox,
  createCaptureId,
  type CaptureOutboxStorage,
  type ExpenseCaptureCommand,
} from "./capture-outbox";

function memoryStorage(): CaptureOutboxStorage {
  let value: string | null = null;
  return {
    get: async () => value,
    set: async (next) => {
      value = next;
    },
  };
}

function expense(overrides: Partial<ExpenseCaptureCommand> = {}): ExpenseCaptureCommand {
  return {
    kind: "expense.create",
    clientId: createCaptureId(),
    workspaceId: "ws",
    tripId: "trip",
    segmentId: "seg",
    merchant: "Test Mart",
    occurredAt: "2026-07-13T12:00:00.000Z",
    totalCents: 1200,
    ...overrides,
  };
}

describe("CaptureOutbox", () => {
  it("enqueues expense and pin commands", async () => {
    const outbox = new CaptureOutbox(memoryStorage());
    await outbox.enqueue(expense({ clientId: "e1" }));
    await outbox.enqueue({
      kind: "pin.create",
      clientId: "p1",
      workspaceId: "ws",
      tripId: "trip",
      segmentId: "seg",
      title: "Camp",
      type: "campsite",
      lat: "45.5",
      lng: "-122.6",
    });
    expect(await outbox.pendingCount()).toBe(2);
    await outbox.flush(async () => undefined);
    expect(await outbox.list()).toEqual([]);
  });

  it("keeps failed entries", async () => {
    const outbox = new CaptureOutbox(memoryStorage());
    await outbox.enqueue(expense({ clientId: "e2" }));
    await outbox.flush(async () => {
      throw new Error("offline");
    });
    const list = await outbox.list();
    expect(list[0]?.state).toBe("failed");
    expect(list[0]?.error).toBe("offline");
  });
});
