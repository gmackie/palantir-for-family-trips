import { describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/gmacko_test";

const { buildCopilotWorld } = await import("../world-ops");

/** Drizzle-shaped select stub: one canned result set per call, in order. */
function fakeDb(queue: unknown[][]) {
  return {
    select: vi.fn(() => {
      const rows = queue.shift() ?? [];
      // biome-ignore lint/suspicious/noExplicitAny: test chain stub
      const chain: any = {
        from: () => chain,
        where: () => Promise.resolve(rows),
      };
      return chain;
    }),
  };
}

const ANCHORS = [
  {
    id: "a2",
    title: "Moab campground",
    kind: "reservation",
    placeName: "Devils Garden",
    lat: "38.57",
    lng: "-109.55",
    startDate: "2026-08-05",
  },
  {
    id: "a1",
    title: "Bryce sunrise",
    kind: "must_see",
    placeName: null,
    lat: null,
    lng: null,
    startDate: "2026-08-03",
  },
];

const SEGMENTS = [
  {
    id: "s2",
    name: "Moab → Grand Junction",
    originName: "Moab",
    destinationName: "Grand Junction",
    distanceMiles: "113",
    durationMinutes: 110,
    sortOrder: 2,
  },
  {
    id: "s1",
    name: "Bryce → Moab",
    originName: "Bryce Canyon area",
    destinationName: "Moab",
    distanceMiles: "250.5",
    durationMinutes: 262,
    sortOrder: 1,
  },
];

describe("buildCopilotWorld", () => {
  it("uses this trip's anchors, in date order", async () => {
    const world = await buildCopilotWorld(fakeDb([ANCHORS, []]), "trip_1");
    expect(world.brief.anchors?.map((a) => a.title)).toEqual([
      "Bryce sunrise",
      "Moab campground",
    ]);
    expect(world.brief.tripId).toBe("trip_1");
    // Coordinates come through only when the anchor actually has them.
    expect(world.brief.anchors?.[1]).toMatchObject({
      lat: 38.57,
      lng: -109.55,
    });
    expect(world.brief.anchors?.[0]?.lat).toBeUndefined();
  });

  it("turns segments into legs in plan order", async () => {
    const world = await buildCopilotWorld(fakeDb([[], SEGMENTS]), "trip_1");
    expect(world.legs).toEqual([
      {
        fromKey: "Bryce Canyon area",
        toKey: "Moab",
        hours: 4.4,
        miles: 250.5,
      },
      { fromKey: "Moab", toKey: "Grand Junction", hours: 1.8, miles: 113 },
    ]);
  });

  it("drops segments that cannot honestly quote a drive", async () => {
    // The co-pilot states drive hours out loud. A leg with no duration, or no
    // endpoints, would make it invent one — the exact thing it must not do.
    const world = await buildCopilotWorld(
      fakeDb([
        [],
        [
          { ...SEGMENTS[1], durationMinutes: null },
          { ...SEGMENTS[0], destinationName: null },
          { ...SEGMENTS[0], id: "s3", durationMinutes: 0 },
        ],
      ]),
      "trip_1",
    );
    expect(world.legs).toEqual([]);
  });

  it("returns an empty world for a trip with nothing planned yet", async () => {
    // "I don't know your route yet" is trustworthy. Borrowing another trip's
    // route — which is what defaultSeedWorld did for every trip — is not.
    const world = await buildCopilotWorld(fakeDb([[], []]), "trip_new");
    expect(world.legs).toEqual([]);
    expect(world.pois).toEqual([]);
    expect(world.brief.anchors).toEqual([]);
    expect(world.brief.tripId).toBe("trip_new");
  });

  it("merges caller preferences into the brief without losing anchors", async () => {
    const world = await buildCopilotWorld(fakeDb([ANCHORS, []]), "trip_1", {
      brief: { maxDriveHoursPerDay: 6, prioritize: ["rest"] },
    });
    expect(world.brief.maxDriveHoursPerDay).toBe(6);
    expect(world.brief.prioritize).toEqual(["rest"]);
    expect(world.brief.anchors).toHaveLength(2);
  });

  it("never carries the dogfood seed anchors", async () => {
    // Regression guard for the bug this module exists to fix.
    const world = await buildCopilotWorld(
      fakeDb([ANCHORS, SEGMENTS]),
      "trip_1",
    );
    const titles = world.brief.anchors?.map((a) => a.title) ?? [];
    expect(titles).not.toContain("Denver");
    expect(titles).not.toContain("Lake Forest");
    expect(world.pois.some((p) => p.name.includes("Manteca"))).toBe(false);
  });
});
