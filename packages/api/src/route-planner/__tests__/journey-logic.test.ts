import {
  journeyRouteStatusEnum,
  journeyStopKindEnum,
  journeyStops,
} from "@sortey/db/schema";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  fallbackMiles,
  kindToPinType,
  nextSortOrder,
  planHeal,
  resolveCurrentPoint,
  resolvePrevPoint,
  type SegmentLike,
  STOP_KINDS,
} from "../journey-logic";

function seg(
  partial: Partial<SegmentLike> & { id: string; sortOrder: number },
): SegmentLike {
  return {
    originLat: null,
    originLng: null,
    originName: null,
    destinationLat: null,
    destinationLng: null,
    destinationName: null,
    ...partial,
  };
}

describe("journey stop schema contract", () => {
  it("exports the stop kinds and route states used by every client", () => {
    expect(journeyStopKindEnum).toEqual([
      "camp",
      "overnight",
      "rest",
      "scenic",
      "fuel",
      "water",
      "dump",
      "town",
      "custom",
    ]);
    expect(journeyRouteStatusEnum).toEqual(["ready", "pending"]);
    expect(getTableColumns(journeyStops).sortOrder).toBeDefined();
  });
});

describe("kindToPinType", () => {
  it("maps every kind to a valid pin type", () => {
    for (const k of STOP_KINDS) expect(kindToPinType(k)).toBeTruthy();
    expect(kindToPinType("camp")).toBe("campsite");
    expect(kindToPinType("overnight")).toBe("campsite");
    expect(kindToPinType("rest")).toBe("rest_area");
    expect(kindToPinType("dump")).toBe("dump_station");
    expect(kindToPinType("town")).toBe("custom");
    expect(kindToPinType("custom")).toBe("custom");
  });
});

describe("nextSortOrder", () => {
  it("is 0 for an empty trip", () => {
    expect(nextSortOrder([])).toBe(0);
  });
  it("is max+1 otherwise, regardless of order", () => {
    expect(
      nextSortOrder([{ sortOrder: 0 }, { sortOrder: 2 }, { sortOrder: 1 }]),
    ).toBe(3);
  });
});

describe("resolvePrevPoint", () => {
  it("returns null for the first stop", () => {
    expect(resolvePrevPoint([])).toBeNull();
  });
  it("returns the highest-sortOrder segment's destination", () => {
    const segs = [
      seg({
        id: "a",
        sortOrder: 0,
        destinationLat: "47.6",
        destinationLng: "-122.3",
        destinationName: "Seattle",
      }),
      seg({
        id: "b",
        sortOrder: 1,
        destinationLat: "46.6",
        destinationLng: "-120.5",
        destinationName: "Yakima",
      }),
    ];
    expect(resolvePrevPoint(segs)).toEqual({
      lat: 46.6,
      lng: -120.5,
      name: "Yakima",
    });
  });
  it("returns null when the last segment lacks coords", () => {
    expect(resolvePrevPoint([seg({ id: "a", sortOrder: 0 })])).toBeNull();
  });
});

describe("resolveCurrentPoint", () => {
  const segs = [
    seg({
      id: "a",
      sortOrder: 0,
      startDate: "2026-07-05",
      destinationLat: "45.7",
      destinationLng: "-121.0",
      destinationName: "Avery Park",
    }),
    seg({
      id: "b",
      sortOrder: 1,
      startDate: "2026-07-08",
      destinationLat: "44.0",
      destinationLng: "-121.3",
      destinationName: "Bend (planned)",
    }),
    seg({
      id: "c",
      sortOrder: 2,
      startDate: "2026-08-03",
      destinationLat: "42.4",
      destinationLng: "-83.5",
      destinationName: "Plymouth (planned)",
    }),
  ];
  it("returns the last TRAVELED stop, ignoring future planned legs", () => {
    expect(resolveCurrentPoint(segs, "2026-07-06")?.name).toBe("Avery Park");
  });
  it("advances as planned dates become today/past", () => {
    expect(resolveCurrentPoint(segs, "2026-07-09")?.name).toBe(
      "Bend (planned)",
    );
  });
  it("falls back to the last segment when no dates are traveled yet", () => {
    expect(resolveCurrentPoint(segs, "2026-06-01")?.name).toBe(
      "Plymouth (planned)",
    );
  });
});

describe("fallbackMiles", () => {
  it("estimates straight-line distance", () => {
    // Seattle → Yakima ≈ 95 mi straight-line.
    const mi = fallbackMiles(
      { lat: 47.6, lng: -122.3, name: "Seattle" },
      { lat: 46.6, lng: -120.5, name: "Yakima" },
    );
    expect(mi).toBeGreaterThan(80);
    expect(mi).toBeLessThan(110);
  });
});

describe("planHeal", () => {
  const segs = [
    seg({
      id: "a",
      sortOrder: 0,
      destinationLat: "48.4",
      destinationLng: "-122.3",
      destinationName: "Mount Vernon",
    }),
    seg({
      id: "b",
      sortOrder: 1,
      destinationLat: "47.6",
      destinationLng: "-120.7",
      destinationName: "Leavenworth",
    }),
    seg({
      id: "c",
      sortOrder: 2,
      destinationLat: "46.6",
      destinationLng: "-120.5",
      destinationName: "Yakima",
    }),
  ];

  it("re-points the next segment to the predecessor's destination", () => {
    const plan = planHeal(segs, "b");
    expect(plan?.next.id).toBe("c");
    expect(plan?.newOrigin).toEqual({
      lat: 48.4,
      lng: -122.3,
      name: "Mount Vernon",
    });
  });

  it("returns null when deleting the last stop (nothing downstream)", () => {
    expect(planHeal(segs, "c")).toBeNull();
  });

  it("has no origin when deleting the first stop (next becomes the new head)", () => {
    const plan = planHeal(segs, "a");
    expect(plan?.next.id).toBe("b");
    expect(plan?.newOrigin).toBeNull();
  });

  it("returns null for an unknown segment", () => {
    expect(planHeal(segs, "zzz")).toBeNull();
  });
});
