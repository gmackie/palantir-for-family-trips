import { describe, expect, it } from "vitest";

import {
  colorPolylineByFuelRange,
  computeFuelZones,
  computeOvernightZones,
  DEFAULT_FUEL_THRESHOLD,
  fuelBandAt,
  fuelRangeMiles,
  isCostcoName,
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

describe("fuelBandAt / colorPolylineByFuelRange", () => {
  it("classifies safe → caution → empty by remaining range", () => {
    expect(fuelBandAt(0, 200)).toBe("safe");
    expect(fuelBandAt(100, 200)).toBe("safe");
    expect(fuelBandAt(160, 200)).toBe("caution"); // 40 mi left = 20%
    expect(fuelBandAt(200, 200)).toBe("empty");
    expect(fuelBandAt(250, 200)).toBe("empty");
  });

  it("colors a long eastbound route safe → caution → empty", () => {
    // ~690 miles, range 200, no refuel points supplied: the route drains once
    // and then stays empty. It must NOT silently refill at the range boundary.
    const points = eastwardLine(-100, 11, 1);
    const segs = colorPolylineByFuelRange(points, 200);
    // ~69-mile sample spacing can step straight over the caution window, so
    // assert the shape rather than every band: starts safe, ends empty, and
    // severity only ever increases without refuel points.
    expect(segs[0]!.band).toBe("safe");
    expect(segs.at(-1)!.band).toBe("empty");
    const rank = { safe: 0, caution: 1, empty: 2 } as const;
    for (let i = 1; i < segs.length; i++) {
      expect(rank[segs[i]!.band]).toBeGreaterThan(rank[segs[i - 1]!.band]);
    }
    for (const s of segs) {
      expect(s.coordinates.length).toBeGreaterThanOrEqual(2);
      expect(s.color).toMatch(/^#/);
    }
  });

  it("returns [] without a usable range or polyline", () => {
    expect(colorPolylineByFuelRange(eastwardLine(-100, 5, 1), 0)).toEqual([]);
    expect(colorPolylineByFuelRange([], 200)).toEqual([]);
  });

  it("classifies exact band boundaries (remaining 0 → empty, remaining == caution cutoff → caution)", () => {
    // remaining exactly 0 → empty (<= comparison).
    expect(fuelBandAt(200, 200)).toBe("empty");
    // remaining exactly rangeMiles * cautionFraction (200 * 0.25 = 50) → caution.
    expect(fuelBandAt(150, 200)).toBe("caution");
    // One mile shy of the cutoff (remaining 51) is still safe.
    expect(fuelBandAt(149, 200)).toBe("safe");
  });

  it("treats a nonpositive or NaN range as safe (no van model → no alarm)", () => {
    expect(fuelBandAt(50, 0)).toBe("safe");
    expect(fuelBandAt(50, -100)).toBe("safe");
    expect(fuelBandAt(50, Number.NaN)).toBe("safe");
  });

  it("honors a custom cautionFraction in fuelBandAt", () => {
    // 50% fraction: remaining exactly 100 of 200 → caution; 101 → safe.
    expect(fuelBandAt(100, 200, 0.5)).toBe("caution");
    expect(fuelBandAt(99, 200, 0.5)).toBe("safe");
    // Same miles under the default 25% fraction would still be safe.
    expect(fuelBandAt(100, 200)).toBe("safe");
  });

  it("returns [] for a single-point polyline", () => {
    expect(colorPolylineByFuelRange([{ lat: 0, lng: 0 }], 200)).toEqual([]);
  });

  it("starts mid-band when milesSinceFill offsets the tank", () => {
    // ~276 mi route, range 200, already 160 mi since fill → remaining 40
    // (20% of range) → opens in caution and runs dry. It does not return to
    // safe: nothing refuels it.
    const points = eastwardLine(-100, 5, 1);
    const segs = colorPolylineByFuelRange(points, 200, { milesSinceFill: 160 });
    expect(segs.map((s) => s.band)).toEqual(["caution", "empty"]);
  });

  it("does NOT wrap milesSinceFill into the current tank cycle", () => {
    const points = eastwardLine(-100, 5, 1);
    // 560 miles on a 200-mile tank is a van that ran dry 360 miles ago. The
    // old modulo read that as 160 and painted the route green.
    const past = colorPolylineByFuelRange(points, 200, { milesSinceFill: 560 });
    expect(past.map((s) => s.band)).toEqual(["empty"]);

    const within = colorPolylineByFuelRange(points, 200, {
      milesSinceFill: 160,
    });
    expect(within[0]!.band).toBe("caution");
  });

  it("cycles through refuel points, then goes empty past the last one", () => {
    // ~2073 mi at range 150. Fuel Zones every 150 mi cover the first 900 mi;
    // beyond the last one the tank drains for real and the route ends red.
    const points = eastwardLine(-120, 31, 1);
    const refuelAtMiles = [150, 300, 450, 600, 750, 900];
    const segs = colorPolylineByFuelRange(points, 150, { refuelAtMiles });
    expect(segs.length).toBeGreaterThanOrEqual(4);
    expect(segs.some((s) => s.band === "safe")).toBe(true);
    expect(segs.at(-1)!.band).toBe("empty");
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i]!.band).not.toBe(segs[i - 1]!.band);
    }
  });

  it("refuel points keep a route green that would otherwise run dry", () => {
    const points = eastwardLine(-100, 11, 1);
    const dry = colorPolylineByFuelRange(points, 200);
    expect(dry.some((s) => s.band === "empty")).toBe(true);

    // A Fuel Zone before empty resets the tank; the route never goes red.
    const topped = colorPolylineByFuelRange(points, 200, {
      refuelAtMiles: [150, 300, 450, 600],
    });
    expect(topped.some((s) => s.band === "empty")).toBe(false);
  });

  it("adjacent segments share the split coordinate", () => {
    const points = eastwardLine(-100, 11, 1);
    const segs = colorPolylineByFuelRange(points, 200);
    expect(segs.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < segs.length; i++) {
      const prev = segs[i - 1]!;
      const curr = segs[i]!;
      expect(prev.toIndex).toBe(curr.fromIndex);
      expect(prev.coordinates[prev.coordinates.length - 1]).toEqual(
        curr.coordinates[0],
      );
    }
  });

  it("honors a custom cautionFraction in polyline coloring", () => {
    // ~276 mi at range 300: with the default 25% fraction, caution begins at
    // 225 mi — only the final point crosses it, so its 1-coord tail segment is
    // filtered and the whole polyline stays safe. A 90% fraction flips to
    // caution after just 30 mi.
    const points = eastwardLine(-100, 5, 1);
    const defaults = colorPolylineByFuelRange(points, 300);
    const eager = colorPolylineByFuelRange(points, 300, {
      cautionFraction: 0.9,
    });
    expect(defaults.map((s) => s.band)).toEqual(["safe"]);
    expect(eager.map((s) => s.band)).toEqual(["safe", "caution"]);
  });
});

describe("isCostcoName", () => {
  it("detects Costco stations case-insensitively", () => {
    expect(isCostcoName("Costco Gasoline")).toBe(true);
    expect(isCostcoName("costco #123")).toBe(true);
    expect(isCostcoName("Shell")).toBe(false);
    expect(isCostcoName(null)).toBe(false);
  });
});
