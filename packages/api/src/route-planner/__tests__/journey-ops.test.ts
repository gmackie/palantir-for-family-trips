import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { logStopOp } from "../journey-ops";

type SegmentRow = {
  id: string;
  tripId: string;
  sortOrder: number;
  originLat: string | null;
  originLng: string | null;
  originName: string | null;
  destinationLat: string | null;
  destinationLng: string | null;
  destinationName: string | null;
};

type StopRow = {
  id: string;
  tripId: string;
  segmentId: string;
  sortOrder: number;
  routeStatus: "ready" | "pending";
};

function memoryStore(options?: { failPin?: boolean }) {
  const state = {
    segments: [] as SegmentRow[],
    stops: [] as StopRow[],
    pins: [] as Array<{ segmentId: string; tripId: string }>,
  };

  // biome-ignore lint/suspicious/noExplicitAny: self-referential transaction fake
  const store: any = {
    state,
    async transaction<T>(operation: (tx: typeof store) => Promise<T>) {
      const snapshot = structuredClone(state);
      try {
        return await operation(store);
      } catch (error) {
        state.segments.splice(0, state.segments.length, ...snapshot.segments);
        state.stops.splice(0, state.stops.length, ...snapshot.stops);
        state.pins.splice(0, state.pins.length, ...snapshot.pins);
        throw error;
      }
    },
    async findStop(tripId: string, stopId: string) {
      return (
        state.stops.find((row) => row.tripId === tripId && row.id === stopId) ??
        null
      );
    },
    async listRecordedChain(tripId: string) {
      return state.stops
        .filter((row) => row.tripId === tripId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((stop) => ({
          stop,
          segment: state.segments.find((row) => row.id === stop.segmentId)!,
        }));
    },
    async insertSegment(values: Omit<SegmentRow, "id">) {
      const row = { id: randomUUID(), ...values };
      state.segments.push(row);
      return row;
    },
    async insertStop(values: StopRow) {
      state.stops.push(values);
      return values;
    },
    async insertPin(values: { segmentId: string; tripId: string }) {
      if (options?.failPin) throw new Error("pin insert failed");
      state.pins.push(values);
    },
    async nextSegmentSortOrder(tripId: string) {
      return (
        state.segments
          .filter((row) => row.tripId === tripId)
          .reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1
      );
    },
  };

  return store;
}

const input = {
  stopId: "a4c843a0-f21d-4930-af8e-b5178bc5cc08",
  tripId: "trip-1",
  userId: "user-1",
  name: "Avery Park",
  lat: 45.7,
  lng: -121,
  arrivedAt: new Date("2026-07-12T15:00:00.000Z"),
  kind: "camp" as const,
  note: "First night",
};

describe("logStopOp", () => {
  it("uses the client stop id to make retries idempotent", async () => {
    const store = memoryStore();

    const first = await logStopOp(store as never, input);
    const retried = await logStopOp(store as never, input);

    expect(retried).toEqual(first);
    expect(store.state.stops).toHaveLength(1);
    expect(store.state.segments).toHaveLength(1);
    expect(store.state.pins).toHaveLength(1);
  });

  it("rolls back the segment and stop when pin creation fails", async () => {
    const store = memoryStore({ failPin: true });

    await expect(logStopOp(store as never, input)).rejects.toThrow(
      "pin insert failed",
    );
    expect(store.state.stops).toHaveLength(0);
    expect(store.state.segments).toHaveLength(0);
    expect(store.state.pins).toHaveLength(0);
  });

  it("keeps a stop retryable when routing is unavailable", async () => {
    const store = memoryStore();
    const previousSegmentId = randomUUID();
    store.state.segments.push({
      id: previousSegmentId,
      tripId: input.tripId,
      sortOrder: 0,
      originLat: "46",
      originLng: "-122",
      originName: "Start",
      destinationLat: "45.8",
      destinationLng: "-121.2",
      destinationName: "Previous camp",
    });
    store.state.stops.push({
      id: randomUUID(),
      tripId: input.tripId,
      segmentId: previousSegmentId,
      sortOrder: 0,
      routeStatus: "ready",
    });
    await logStopOp(store as never, input, async () => null);

    expect(store.state.stops[1]?.routeStatus).toBe("pending");
  });
});
