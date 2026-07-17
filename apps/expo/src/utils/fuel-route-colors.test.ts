import { describe, expect, it } from "vitest";

import {
  colorPolylineByFuelRange,
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

  it("auto-refills past the range boundary: bands cycle without ever going empty", () => {
    // 700 miles on a 300-mile tank wraps twice; the wrap loop refills the
    // tank, so "empty" is only reachable via fuelBandAt directly.
    const points = northwardRoute(700, 71); // ~10-mile steps
    const segments = colorPolylineByFuelRange(points, 300);
    const bands = segments.map((s) => s.band);
    expect(new Set(bands)).toEqual(new Set(["safe", "caution"]));
    // Alternates: no two adjacent segments share a band.
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i]).not.toBe(bands[i - 1]);
    }
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
