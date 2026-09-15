import { describe, expect, it } from "vitest";

import {
  colorPolylineByFuelRange,
  colorRouteRunsByFuelRange,
  DEFAULT_CAUTION_FRACTION,
  FUEL_BAND_COLORS,
  fuelBandAt,
  isCostcoName,
  type LatLng,
} from "./fuel-route-colors";

// ~69.1 miles per degree of latitude at any longitude — used to build routes
// with known mileage. 1° lat ≈ 69.09 mi under the haversine radius (3958.8).
const MILES_PER_DEG_LAT = 69.09;

function northwardRoute(totalMiles: number, pointCount: number): LatLng[] {
  const totalDeg = totalMiles / MILES_PER_DEG_LAT;
  return Array.from({ length: pointCount }, (_, i) => ({
    lat: (totalDeg * i) / (pointCount - 1),
    lng: 0,
  }));
}

/** A due-east line at a fixed latitude, `miles` long across `count` points. */
function eastwardRoute(miles: number, count: number, lat: number) {
  const degPerMile = 1 / (69.172 * Math.cos((lat * Math.PI) / 180));
  return Array.from({ length: count }, (_, i) => ({
    lat,
    lng: -100 + (miles * degPerMile * i) / (count - 1),
  }));
}

describe("fuelBandAt (parity with packages/api route-planner/zones)", () => {
  it("returns safe with plenty of range left", () => {
    expect(fuelBandAt(0, 300)).toBe("safe");
    expect(fuelBandAt(100, 300)).toBe("safe");
  });

  it("enters caution at exactly the caution-fraction boundary (inclusive)", () => {
    // remaining == rangeMiles * fraction → caution
    expect(fuelBandAt(225, 300)).toBe("caution"); // remaining 75 == 300*0.25
    expect(fuelBandAt(224.999, 300)).toBe("safe");
  });

  it("returns empty at and past zero remaining (inclusive)", () => {
    expect(fuelBandAt(300, 300)).toBe("empty");
    expect(fuelBandAt(400, 300)).toBe("empty");
  });

  it("respects a custom caution fraction", () => {
    expect(fuelBandAt(150, 300, 0.5)).toBe("caution");
    expect(fuelBandAt(149, 300, 0.5)).toBe("safe");
  });

  it("degrades to safe when range is invalid", () => {
    expect(fuelBandAt(100, 0)).toBe("safe");
    expect(fuelBandAt(100, -5)).toBe("safe");
    expect(fuelBandAt(100, Number.NaN)).toBe("safe");
  });
});

describe("colorPolylineByFuelRange", () => {
  it("returns [] for degenerate input", () => {
    expect(colorPolylineByFuelRange([], 300)).toEqual([]);
    expect(colorPolylineByFuelRange([{ lat: 0, lng: 0 }], 300)).toEqual([]);
    expect(colorPolylineByFuelRange(northwardRoute(100, 5), 0)).toEqual([]);
  });

  it("colors a short route as a single safe segment covering every point", () => {
    const points = northwardRoute(50, 5);
    const segments = colorPolylineByFuelRange(points, 300);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.band).toBe("safe");
    expect(segments[0]?.color).toBe(FUEL_BAND_COLORS.safe);
    expect(segments[0]?.coordinates).toHaveLength(points.length);
  });

  it("splits into safe→caution as the tank drains, sharing the split point", () => {
    // 280 miles on a 300-mile tank: caution starts at 225 miles in.
    const points = northwardRoute(280, 29); // 10-mile steps
    const segments = colorPolylineByFuelRange(points, 300);
    expect(segments.map((s) => s.band)).toEqual(["safe", "caution"]);

    const safe = segments[0]!;
    const caution = segments[1]!;
    // Adjacent segments share the boundary coordinate so the polyline has no gap.
    expect(safe.coordinates.at(-1)).toEqual(caution.coordinates[0]);
  });

  it("starts mid-band when milesSinceFill is provided", () => {
    // Already 250 miles since fill on a 300-mile tank → route starts in caution.
    const points = northwardRoute(40, 5);
    const segments = colorPolylineByFuelRange(points, 300, {
      milesSinceFill: 250,
    });
    expect(segments[0]?.band).toBe("caution");
  });

  it("goes empty and STAYS empty past the range with no refuel points", () => {
    // 700 miles on a 300-mile tank. The route must go red where the tank runs
    // dry and stay red — silently "refilling" at the range boundary would
    // assume away the exact thing this coloring warns about.
    const points = northwardRoute(700, 71); // ~10-mile steps
    const segments = colorPolylineByFuelRange(points, 300);
    expect(segments.map((s) => s.band)).toEqual(["safe", "caution", "empty"]);
    // Nothing follows empty: the last segment runs to the end of the route.
    expect(segments.at(-1)?.coordinates.at(-1)).toEqual({
      latitude: points.at(-1)!.lat,
      longitude: points.at(-1)!.lng,
    });
  });

  it("refuels only at the supplied Fuel Zone miles", () => {
    // Refill at mile 250 (before empty) → the tank resets there and the route
    // never reaches empty across 500 miles on a 300-mile tank.
    const points = northwardRoute(500, 51);
    const segments = colorPolylineByFuelRange(points, 300, {
      refuelAtMiles: [250],
    });
    const bands = segments.map((s) => s.band);
    expect(bands).not.toContain("empty");
    expect(bands).toContain("safe");
  });

  it("an already-empty tank reads empty, not full", () => {
    // 400 miles since fill on a 300-mile tank. The old modulo wrapped this to
    // 100 and painted the route green from a dry tank.
    const points = northwardRoute(50, 6);
    const segments = colorPolylineByFuelRange(points, 300, {
      milesSinceFill: 400,
    });
    expect(segments.map((s) => s.band)).toEqual(["empty"]);
  });

  it("clamps negative milesSinceFill to zero", () => {
    const points = northwardRoute(50, 5);
    const segments = colorPolylineByFuelRange(points, 300, {
      milesSinceFill: -100,
    });
    expect(segments).toHaveLength(1);
    expect(segments[0]?.band).toBe("safe");
  });

  it("uses the default caution fraction constant", () => {
    expect(DEFAULT_CAUTION_FRACTION).toBe(0.25);
  });
});

describe("isCostcoName", () => {
  it("matches Costco case-insensitively anywhere in the name", () => {
    expect(isCostcoName("Costco Gas Station")).toBe(true);
    expect(isCostcoName("COSTCO WHOLESALE #123")).toBe(true);
    expect(isCostcoName("Shell")).toBe(false);
    expect(isCostcoName(null)).toBe(false);
    expect(isCostcoName(undefined)).toBe(false);
    expect(isCostcoName("")).toBe(false);
  });
});

describe("colorRouteRunsByFuelRange", () => {
  it("keeps runs separate so no false road is drawn across a gap", () => {
    // Two 50-mile runs 500 miles apart. Concatenating them would draw a
    // straight line over country the route never touches.
    const runA = northwardRoute(50, 6);
    const runB = eastwardRoute(50, 6, 40);
    const runs = colorRouteRunsByFuelRange(
      [
        { points: runA, gapMilesBefore: 0 },
        { points: runB, gapMilesBefore: 500 },
      ],
      300,
    );

    expect(runs).toHaveLength(2);
    // No segment spans both runs: every polyline stays within its own run.
    const first = runs[0]!.flatMap((s) => s.coordinates);
    const second = runs[1]!.flatMap((s) => s.coordinates);
    expect(first.every((c) => c.longitude === runA[0]!.lng)).toBe(true);
    expect(second.every((c) => c.latitude === runB[0]!.lat)).toBe(true);
  });

  it("charges the gap's miles to the tank even though nothing is drawn", () => {
    // 250 miles of un-drawn segment on a 300-mile tank: the second run must
    // open in caution, not safe — those miles were still driven.
    const runs = colorRouteRunsByFuelRange(
      [
        { points: northwardRoute(20, 3), gapMilesBefore: 0 },
        { points: eastwardRoute(20, 3, 40), gapMilesBefore: 250 },
      ],
      300,
    );
    expect(runs[0]![0]?.band).toBe("safe");
    expect(runs[1]![0]?.band).toBe("caution");
  });

  it("a refuel inside the gap resets the tank for the next run", () => {
    const runs = colorRouteRunsByFuelRange(
      [
        { points: northwardRoute(20, 3), gapMilesBefore: 0 },
        { points: eastwardRoute(20, 3, 40), gapMilesBefore: 250 },
      ],
      300,
      { refuelAtMiles: [200] },
    );
    // Filled at mile 200, so entering run two only ~70 miles are on the tank.
    expect(runs[1]![0]?.band).toBe("safe");
  });

  it("returns [] without a usable range", () => {
    expect(
      colorRouteRunsByFuelRange(
        [{ points: northwardRoute(20, 3), gapMilesBefore: 0 }],
        0,
      ),
    ).toEqual([]);
  });
});
