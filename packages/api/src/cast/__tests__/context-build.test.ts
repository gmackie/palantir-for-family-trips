import { encode } from "@googlemaps/polyline-codec";
import { describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/gmacko_test";

const { buildCastDayContext } = await import("../context");

function fakeSelectDb(queue: unknown[][]) {
  const select = vi.fn(() => {
    const rows = queue.shift() ?? [];
    // biome-ignore lint/suspicious/noExplicitAny: test chain stub
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(rows),
      then: (
        resolve: (rows: unknown[]) => unknown,
        reject: (error: unknown) => unknown,
      ) => Promise.resolve(rows).then(resolve, reject),
    };
    return chain;
  });
  return { db: { select }, select };
}

const TRIP = [{ name: "Van Trip", tz: "America/Denver", workspaceId: "ws-1" }];
const INPUT = { tripId: "trip-1", targetDate: "2026-07-28" };

// Denver-ish → mid-Utah-ish: points ~90 miles apart, so a POI parked at one
// sample point is far outside the 15-mile radius of the others.
const ROUTE_POINTS: Array<[number, number]> = [
  [39.7, -105.0],
  [38.6, -106.0],
  [38.57, -109.55],
];
const POLYLINE = encode(ROUTE_POINTS, 5);

function poiRow(id: string, lat: number, lng: number) {
  return {
    id,
    name: `POI ${id}`,
    category: "campsite",
    lat: String(lat),
    lng: String(lng),
    source: "osm",
  };
}

describe("buildCastDayContext", () => {
  it("throws when the trip does not exist", async () => {
    const { db } = fakeSelectDb([[]]);
    await expect(buildCastDayContext(db, INPUT)).rejects.toThrow(
      /Trip not found/,
    );
  });

  it("degraded leg: maps day + segment, skips POI queries entirely", async () => {
    const day = {
      intent: "drive",
      title: "Over the Rockies",
      heroTitle: "Big climb",
      heroDetail: null,
      overnightName: "Moab BLM",
      overnightKind: "dispersed",
      cutIfBehind: "Skip the scenic loop",
      note: null,
      blocksJson: null,
      segmentId: "seg-1",
    };
    const segment = {
      id: "seg-1",
      name: "Denver → Moab",
      originName: "Denver",
      destinationName: "Moab",
      routePolyline: null,
      distanceMiles: "353",
      durationMinutes: 330,
    };
    const anchors = [
      {
        title: "Campground reservation",
        kind: "reservation",
        placeName: "Moab",
        startDate: "2026-07-28",
        endDate: null,
        note: null,
      },
    ];
    const { db, select } = fakeSelectDb([TRIP, [day], [segment], anchors]);

    const context = await buildCastDayContext(db, INPUT);
    expect(context).toMatchObject({
      tripName: "Van Trip",
      tz: "America/Denver",
      hasDriveLeg: true,
      degraded: true,
      pois: [],
    });
    expect(context.segment).toMatchObject({
      originName: "Denver",
      destinationName: "Moab",
      distanceMiles: 353,
      hasGeometry: false,
    });
    expect(context.day).toMatchObject({
      intent: "drive",
      overnightName: "Moab BLM",
      blocks: [], // null blocksJson normalizes to []
    });
    expect(context.anchors).toEqual(anchors);
    // trip + day + segment + anchors — and NOT the 5 corridor POI samples.
    expect(select).toHaveBeenCalledTimes(4);
  });

  it("with geometry: samples the corridor and dedupes POIs across samples", async () => {
    const day = {
      intent: "drive",
      title: null,
      heroTitle: null,
      heroDetail: null,
      overnightName: null,
      overnightKind: null,
      cutIfBehind: null,
      note: null,
      blocksJson: [{ part: "morning", title: "Roll out", detail: "early" }],
      segmentId: "seg-1",
    };
    const segment = {
      id: "seg-1",
      name: "Denver → Moab",
      originName: "Denver",
      destinationName: "Moab",
      routePolyline: POLYLINE,
      distanceMiles: "353",
      durationMinutes: 330,
    };
    // Same two rows returned for every sample's bounding-box query; both sit
    // at the middle route point, so only the middle samples rank them, and
    // the dedupe set must collapse the repeats to exactly two POIs.
    const midRows = [
      poiRow("p1", ROUTE_POINTS[1]![0], ROUTE_POINTS[1]![1]),
      poiRow("p2", ROUTE_POINTS[1]![0] + 0.01, ROUTE_POINTS[1]![1]),
    ];
    const { db, select } = fakeSelectDb([
      TRIP,
      [day],
      [segment],
      [], // anchors
      midRows,
      midRows,
      midRows,
      midRows,
      midRows,
    ]);

    const context = await buildCastDayContext(db, INPUT);
    expect(context.degraded).toBe(false);
    expect(context.day?.blocks).toHaveLength(1);
    expect(select).toHaveBeenCalledTimes(4 + 5); // 5 corridor samples

    const ids = context.pois.map((p) => p.name).sort();
    expect(ids).toEqual(["POI p1", "POI p2"]);
    for (const poi of context.pois) {
      expect(poi.milesAway).toBeLessThanOrEqual(15);
      expect(poi.routeFraction).toBeGreaterThan(0);
      expect(poi.routeFraction).toBeLessThan(1);
    }
  });

  it("no drive leg: play day with no segment link yields an empty context", async () => {
    const day = {
      intent: "play",
      title: "Rest day",
      heroTitle: null,
      heroDetail: null,
      overnightName: null,
      overnightKind: null,
      cutIfBehind: null,
      note: null,
      blocksJson: null,
      segmentId: null,
    };
    const { db } = fakeSelectDb([TRIP, [day], []]);
    const context = await buildCastDayContext(db, INPUT);
    expect(context.hasDriveLeg).toBe(false);
    expect(context.segment).toBeNull();
    expect(context.pois).toEqual([]);
  });
});
