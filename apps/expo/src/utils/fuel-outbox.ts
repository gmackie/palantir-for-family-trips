/** Offline queue for fuel fill-ups (mirrors journey outbox patterns). */

export const FUEL_OUTBOX_KEY = "sortey.fuel-outbox.v1";

export function createFuelOutboxId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export interface FuelLogCommand {
  clientId: string;
  workspaceId: string;
  tripId: string;
  segmentId?: string;
  vanProfileId?: string;
  odometerMiles?: number;
  gallons: number;
  pricePerGallon: number;
  totalCents: number;
  fuelType: "gas" | "diesel" | "e85";
  stationName?: string;
  stationLat?: number;
  stationLng?: number;
  isCostco?: boolean;
  loggedAt: string;
  notes?: string;
  currency?: string;
  splitWithGroup?: boolean;
}

export interface FuelOutboxEntry {
  command: FuelLogCommand;
  state: "pending" | "failed";
  attempts: number;
  error?: string;
  queuedAt: string;
}

export interface FuelOutboxStorage {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
}

export class FuelOutbox {
  private flushing: Promise<void> | null = null;

  constructor(private readonly storage: FuelOutboxStorage) {}

  async list(): Promise<FuelOutboxEntry[]> {
    const raw = await this.storage.get();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as FuelOutboxEntry[]) : [];
    } catch {
      return [];
    }
  }

  async pendingCount(): Promise<number> {
    return (await this.list()).length;
  }

  async enqueue(command: FuelLogCommand): Promise<void> {
    const entries = await this.list();
    const existing = entries.find(
      (entry) => entry.command.clientId === command.clientId,
    );
    if (existing) {
      existing.command = command;
      existing.state = "pending";
      existing.error = undefined;
    } else {
      entries.push({
        command,
        state: "pending",
        attempts: 0,
        queuedAt: new Date().toISOString(),
      });
    }
    await this.save(entries);
  }

  flush(
    send: (command: FuelLogCommand) => Promise<unknown>,
  ): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushOnce(send).finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async flushOnce(
    send: (command: FuelLogCommand) => Promise<unknown>,
  ): Promise<void> {
    const entries = await this.list();
    for (const entry of [...entries]) {
      try {
        await send(entry.command);
        const index = entries.findIndex(
          (candidate) =>
            candidate.command.clientId === entry.command.clientId,
        );
        if (index !== -1) entries.splice(index, 1);
      } catch (error) {
        entry.state = "failed";
        entry.attempts += 1;
        entry.error = error instanceof Error ? error.message : "Sync failed";
      }
      await this.save(entries);
    }
  }

  private save(entries: FuelOutboxEntry[]): Promise<void> {
    return this.storage.set(JSON.stringify(entries));
  }
}
