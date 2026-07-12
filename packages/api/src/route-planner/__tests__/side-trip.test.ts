import { describe, expect, it } from "vitest";

import {
  assessSideTrip,
  distanceToPolylineMiles,
  SIDE_TRIP_THRESHOLD_MILES,
} from "../side-trip";

// Rough LA → Pomona corridor (eastbound)
const ROUTE = [
  { lat: 34.0522, lng: -118.2437 },
  { lat: 34.055, lng: -118.1 },
  { lat: 34.06, lng: -117.9 },
  { lat: 34.0551, lng: -117.75 },
];

describe("distanceToPolylineMiles", () => {
  it("is near zero on a vertex", () => {
    const d = distanceToPolylineMiles(ROUTE[0]!, ROUTE);
    expect(d).toBeLessThan(0.05);
  });

  it("is small near the corridor midpoint", () => {
    const mid = { lat: 34.057, lng: -118.0 };
    const d = distanceToPolylineMiles(mid, ROUTE);
    expect(d).toBeLessThan(2);
  });

  it("is large far from the route", () => {
    // ~50+ mi north of the corridor
    const d = distanceToPolylineMiles({ lat: 34.8, lng: -118.0 }, ROUTE);
    expect(d).toBeGreaterThan(SIDE_TRIP_THRESHOLD_MILES);
  });
});

describe("assessSideTrip", () => {
  it("marks unavailable without position", () => {
    const a = assessSideTrip({ position: null, routePoints: ROUTE });
    expect(a.unavailable).toBe(true);
    expect(a.reason).toBe("no_position");
    expect(a.offRoute).toBe(false);
  });

  it("marks unavailable without route", () => {
    const a = assessSideTrip({
      position: ROUTE[0]!,
      routePoints: [],
    });
    expect(a.unavailable).toBe(true);
    expect(a.reason).toBe("no_route");
  });

  it("detects on-route position", () => {
    const a = assessSideTrip({
      position: ROUTE[1]!,
      routePoints: ROUTE,
    });
    expect(a.unavailable).toBe(false);
    expect(a.offRoute).toBe(false);
    expect(a.reason).toBe("on_route");
  });

  it("detects off-route position beyond 2 mi", () => {
    const a = assessSideTrip({
      position: { lat: 34.8, lng: -118.0 },
      routePoints: ROUTE,
      thresholdMiles: 2,
    });
    expect(a.offRoute).toBe(true);
    expect(a.reason).toBe("off_route");
    expect(a.milesFromRoute).toBeGreaterThan(2);
  });
});
