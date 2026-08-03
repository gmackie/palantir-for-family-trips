import { describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/gmacko_test";

const { computeServiceAlerts } = await import("../service-ops");

/**
 * Found by replaying a real trip (`scripts/replay-trip.ts`): the POI query
 * caps at 1,000 rows, and a ~100-mile box around the Bay Area holds 2,194
 * service POIs. Without an ORDER BY, Postgres returns an arbitrary subset and
 * the nearest dump station can simply be missing — the user is then told
 * "none on your route", which is the one answer this feature must never get
 * wrong.
 */
function fakeDb(queue: unknown[][]) {
  const calls = { orderBy: 0, limit: 0 };
  const db = {
    select: vi.fn(() => {
      const rows = queue.shift() ?? [];
      // biome-ignore lint/suspicious/noExplicitAny: test chain stub
      const chain: any = {
        from: () => chain,
        where: () => chain,
        orderBy: () => {
          calls.orderBy++;
          return chain;
        },
        limit: () => {
          calls.limit++;
          return Promise.resolve(rows);
        },
        then: (
          resolve: (rows: unknown[]) => unknown,
          reject: (error: unknown) => unknown,
        ) => Promise.resolve(rows).then(resolve, reject),
      };
      return chain;
    }),
  };
  return { db, calls };
}

const SEGMENTS = [
  {
    id: "s1",
    sortOrder: 1,
    originLat: "37.8",
    originLng: "-122.3",
    originName: "Oakland",
    destinationLat: "38.5",
    destinationLng: "-121.5",
    destinationName: "Sacramento",
    startDate: "2020-01-01",
    routePolyline: null,
  },
];

describe("computeServiceAlerts", () => {
  it("orders the POI query so the row cap drops the farthest, not a random 1,000", async () => {
    const { db, calls } = fakeDb([
      SEGMENTS,
      [], // POI rows — the assertion is about how they were asked for
    ]);
    await computeServiceAlerts(db, {
      tripId: "trip_1",
      levels: { grey: 80 },
    });
    expect(calls.orderBy).toBeGreaterThan(0);
    expect(calls.limit).toBeGreaterThan(0);
  });

  it("returns an empty run when the trip has no route geometry", async () => {
    // A run built on straight lines between segment endpoints would invent
    // roads; alerts still work from the current position.
    const { db } = fakeDb([SEGMENTS, []]);
    const result = await computeServiceAlerts(db, {
      tripId: "trip_1",
      levels: { grey: 80 },
    });
    expect(result.run).toEqual({ stops: [], unserved: [] });
    expect(result.position).not.toBeNull();
  });

  it("returns nothing to service when no levels are known", async () => {
    const { db } = fakeDb([SEGMENTS]);
    const result = await computeServiceAlerts(db, {
      tripId: "trip_1",
      levels: {},
    });
    expect(result.alerts).toEqual([]);
    expect(result.run.stops).toEqual([]);
  });
});
