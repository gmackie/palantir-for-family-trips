export const JOURNEY_OUTBOX_KEY = "sortey.journey-outbox.v1";

export type JourneyStopKind =
  | "camp"
  | "overnight"
  | "rest"
  | "scenic"
  | "fuel"
  | "water"
  | "dump"
  | "town"
  | "custom";

export interface JourneyStopCommand {
  stopId: string;
  workspaceId: string;
  tripId: string;
  name: string;
  lat: number;
  lng: number;
  arrivedAt: string;
  kind: JourneyStopKind;
  note?: string;
}

export interface JourneyOutboxEntry {
  command: JourneyStopCommand;
  state: "pending" | "failed";
  attempts: number;
  error?: string;
  queuedAt: string;
}

export interface JourneyOutboxStorage {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
}

export class JourneyOutbox {
  private flushing: Promise<void> | null = null;

  constructor(private readonly storage: JourneyOutboxStorage) {}

  async list(): Promise<JourneyOutboxEntry[]> {
    const raw = await this.storage.get();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as JourneyOutboxEntry[]) : [];
    } catch {
      return [];
    }
  }

  async enqueue(command: JourneyStopCommand): Promise<void> {
    const entries = await this.list();
    const existing = entries.find(
      (entry) => entry.command.stopId === command.stopId,
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
    send: (command: JourneyStopCommand) => Promise<unknown>,
  ): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushOnce(send).finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async flushOnce(
    send: (command: JourneyStopCommand) => Promise<unknown>,
  ): Promise<void> {
    const entries = await this.list();
    for (const entry of [...entries]) {
      try {
        await send(entry.command);
        const index = entries.findIndex(
          (candidate) => candidate.command.stopId === entry.command.stopId,
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

  private save(entries: JourneyOutboxEntry[]): Promise<void> {
    return this.storage.set(JSON.stringify(entries));
  }
}
