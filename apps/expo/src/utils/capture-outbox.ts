/**
 * Offline queue for non-money-contended captures: expenses + map pins.
 * (Line-item claims stay online-only per OFFLINE_FIRST_DESIGN.)
 */

export const CAPTURE_OUTBOX_KEY = "sortey.capture-outbox.v1";

export function createCaptureId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export type ExpenseCaptureCommand = {
  kind: "expense.create";
  clientId: string;
  workspaceId: string;
  tripId: string;
  segmentId: string;
  merchant: string;
  occurredAt: string;
  category?:
    | "meal"
    | "transit"
    | "lodging"
    | "activity"
    | "drinks"
    | "tickets"
    | "general";
  currency?: string;
  subtotalCents?: number;
  taxCents?: number;
  tipCents?: number;
  totalCents?: number;
  notes?: string | null;
};

export type PinCaptureCommand = {
  kind: "pin.create";
  clientId: string;
  workspaceId: string;
  tripId: string;
  segmentId: string;
  title: string;
  type: string;
  lat: string;
  lng: string;
  startsAt?: string;
  endsAt?: string;
  notes?: string | null;
};

export type CaptureCommand = ExpenseCaptureCommand | PinCaptureCommand;

export interface CaptureOutboxEntry {
  command: CaptureCommand;
  state: "pending" | "failed";
  attempts: number;
  error?: string;
  queuedAt: string;
}

export interface CaptureOutboxStorage {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
}

export class CaptureOutbox {
  private flushing: Promise<void> | null = null;

  constructor(private readonly storage: CaptureOutboxStorage) {}

  async list(): Promise<CaptureOutboxEntry[]> {
    const raw = await this.storage.get();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as CaptureOutboxEntry[]) : [];
    } catch {
      return [];
    }
  }

  async pendingCount(): Promise<number> {
    return (await this.list()).length;
  }

  async enqueue(command: CaptureCommand): Promise<void> {
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
    send: (command: CaptureCommand) => Promise<unknown>,
  ): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushOnce(send).finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async flushOnce(
    send: (command: CaptureCommand) => Promise<unknown>,
  ): Promise<void> {
    const entries = await this.list();
    for (const entry of [...entries]) {
      try {
        await send(entry.command);
        const index = entries.findIndex(
          (c) => c.command.clientId === entry.command.clientId,
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

  private save(entries: CaptureOutboxEntry[]): Promise<void> {
    return this.storage.set(JSON.stringify(entries));
  }
}
