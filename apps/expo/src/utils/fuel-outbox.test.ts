import { describe, expect, it } from "vitest";

import {
  createFuelOutboxId,
  type FuelLogCommand,
  FuelOutbox,
  type FuelOutboxStorage,
} from "./fuel-outbox";

function memoryStorage(): FuelOutboxStorage {
  let value: string | null = null;
  return {
    get: async () => value,
    set: async (next) => {
      value = next;
    },
  };
}

function sampleCommand(
  overrides: Partial<FuelLogCommand> = {},
): FuelLogCommand {
  return {
    clientId: createFuelOutboxId(),
    workspaceId: "ws",
    tripId: "trip",
    gallons: 12.5,
    pricePerGallon: 3.89,
    totalCents: 4863,
    fuelType: "gas",
    loggedAt: "2026-07-13T18:00:00.000Z",
    ...overrides,
  };
}

describe("FuelOutbox", () => {
  it("enqueues and flushes successfully", async () => {
    const outbox = new FuelOutbox(memoryStorage());
    const command = sampleCommand({ clientId: "fuel-1" });
    await outbox.enqueue(command);
    expect(await outbox.list()).toHaveLength(1);

    await outbox.flush(async () => undefined);
    expect(await outbox.list()).toEqual([]);
  });

  it("marks failed attempts and keeps the entry", async () => {
    const outbox = new FuelOutbox(memoryStorage());
    const command = sampleCommand({ clientId: "fuel-2" });
    await outbox.enqueue(command);
    await outbox.flush(async () => {
      throw new Error("offline");
    });
    const list = await outbox.list();
    expect(list).toMatchObject([
      { command, state: "failed", attempts: 1, error: "offline" },
    ]);
  });

  it("dedupes by clientId on re-enqueue", async () => {
    const outbox = new FuelOutbox(memoryStorage());
    await outbox.enqueue(sampleCommand({ clientId: "same", gallons: 10 }));
    await outbox.enqueue(sampleCommand({ clientId: "same", gallons: 11 }));
    const list = await outbox.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.command.gallons).toBe(11);
  });
});
