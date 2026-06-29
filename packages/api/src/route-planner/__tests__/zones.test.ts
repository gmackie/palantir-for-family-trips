import { describe, expect, it } from "vitest";

import {
  computeFuelZones,
  computeOvernightZones,
  DEFAULT_FUEL_THRESHOLD,
  fuelRangeMiles,
  type LatLng,
  OVERNIGHT_ZONE_RADIUS_MILES,
  type ZoneSegment,
} from "../zones";

/** ~1 degree of longitude at the equator ≈ 69 miles; build a due-east line. */
function eastwardLine(
  startLng: number,
  count: number,
  stepLng: number,
): LatLng[] {
  return Array.from({ length: count }, (_, i) => ({
    lat: 0,
    lng: startLng + i * stepLng,
  }));
}

describe("fuelRangeMiles", () => {
  it("derates MPG x tank by the default threshold", () => {
    // 15 MPG x 24.5 gal x 0.8 = 294
    expect(fuelRangeMiles(15, 24.5)).toBeCloseTo(294, 5);
    expect(DEFAULT_FUEL_THRESHOLD).toBe(0.8);
  });

  it("honors a custom threshold", () => {
    expect(fuelRangeMiles(20, 10, 0.5)).toBe(100);
  });

  it("returns 0 when the van model is incomplete or invalid", () => {
    expect(fuelRangeMiles(null, 24.5)).toBe(0);
    expect(fuelRangeMiles(15, null)).toBe(0);
    expect(fuelRangeMiles(0, 24.5)).toBe(0);
    expect(fuelRangeMiles(15, -5)).toBe(0);
    expect(fuelRangeMiles(undefined, undefined)).toBe(0);
  });
});

describe("computeFuelZones", () => {
  it("places a zone roughly every range-miles along the route", () => {
    // ~690 miles total (10 deg of longitude at equator), range 200mi → ~3 zones.
    const points = eastwardLine(-100, 11, 1);
    const zones = computeFuelZones(points, 200);
    expect(zones.length).toBeGreaterThanOrEqual(2);
    // Mile markers strictly increase and each gap is ~>= range.
    expect(zones[0]!.mileMarker).toBeGreaterThanOrEqual(190);
    for (let i = 1; i < zones.length; i++) {
      expect(zones[i]!.mileMarker).toBeGreaterThan(zones[i - 1]!.mileMarker);
    }
  });

  it("returns [] when range is 0 (incomplete van model)", () => {
    expect(computeFuelZones(eastwardLine(-100, 5, 1), 0)).toEqual([]);
  });

  it("returns [] for a degenerate polyline", () => {
    expect(computeFuelZones([], 200)).toEqual([]);
    expect(computeFuelZones([{ lat: 0, lng: 0 }], 200)).toEqual([]);
  });

  it("returns [] when the route is shorter than one tank range", () => {
    // ~69 miles, range 300 → never needs fuel.
    expect(computeFuelZones(eastwardLine(-100, 2, 1), 300)).toEqual([]);
  });
});

describe("computeOvernightZones", () => {
  const seg = (
    lat: number | null,
    lng: number | null,
    miles: number | null,
  ): ZoneSegment => ({
    destinationLat: lat,
    destinationLng: lng,
    distanceMiles: miles,
  });

  it("places a zone at every boundary except the final destination", () => {
    const segments = [
      seg(46.8, -114.0, 475), // Missoula
      seg(45.7, -108.5, 345), // Billings
      seg(44.0, -103.2, 375), // Rapid City
      seg(41.5, -93.6, 350), // Des Moines (final — no overnight)
    ];
    const zones = computeOvernightZones(segments);
    expect(zones).toHaveLength(3);
    expect(zones[0]).toMatchObject({
      lat: 46.8,
      lng: -114.0,
      radiusMiles: OVERNIGHT_ZONE_RADIUS_MILES,
      mileMarker: 475,
    });
    // Cumulative mile markers across the day boundaries.
    expect(zones[1]!.mileMarker).toBe(820);
    expect(zones[2]!.mileMarker).toBe(1195);
  });

  it("returns [] for a single-segment (no overnight) trip", () => {
    expect(computeOvernightZones([seg(46.8, -114.0, 475)])).toEqual([]);
    expect(computeOvernightZones([])).toEqual([]);
  });

  it("skips boundaries missing coordinates but still accumulates mileage", () => {
    const segments = [
      seg(null, null, 475), // unknown coords — skipped
      seg(44.0, -103.2, 375),
      seg(41.5, -93.6, 350), // final
    ];
    const zones = computeOvernightZones(segments);
    expect(zones).toHaveLength(1);
    // 475 + 375 accumulated through the second boundary.
    expect(zones[0]!.mileMarker).toBe(850);
  });
});
