/**
 * Side-trip detection — pure geometry against a planned route polyline.
 *
 * When the vehicle is > threshold miles from the nearest point on the planned
 * route (and not at a known POI/overnight), Driving Mode can prompt
 * "Side trip?" so the user can pause guidance without treating it as a
 * wrong turn.
 */

import { haversineMiles } from "../trips/driving-summary";

export interface LatLng {
  lat: number;
  lng: number;
}

/** Default: CONTEXT.md Side Trip threshold. */
export const SIDE_TRIP_THRESHOLD_MILES = 2;

/**
 * Distance from `point` to the closest sample on the polyline (miles).
 * Samples consecutive segment midpoints + vertices for a cheap approximation
 * (good enough for a 2 mi off-route prompt; not for survey accuracy).
 */
export function distanceToPolylineMiles(
  point: LatLng,
  polyline: LatLng[],
): number {
  if (polyline.length === 0) return Number.POSITIVE_INFINITY;
  if (polyline.length === 1) return haversineMiles(point, polyline[0]!);

  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polyline.length; i++) {
    const v = polyline[i]!;
    min = Math.min(min, haversineMiles(point, v));
    if (i > 0) {
      const a = polyline[i - 1]!;
      const b = v;
      // Sample the segment midpoint + 1/4 and 3/4 points.
      for (const t of [0.25, 0.5, 0.75]) {
        const sample = {
          lat: a.lat + (b.lat - a.lat) * t,
          lng: a.lng + (b.lng - a.lng) * t,
        };
        min = Math.min(min, haversineMiles(point, sample));
      }
    }
  }
  return min;
}

export interface SideTripAssessment {
  offRoute: boolean;
  milesFromRoute: number;
  thresholdMiles: number;
  /** True when assessment could not run (no polyline / no position). */
  unavailable: boolean;
  reason: "ok" | "no_position" | "no_route" | "off_route" | "on_route";
}

export function assessSideTrip(input: {
  position: LatLng | null | undefined;
  routePoints: LatLng[];
  thresholdMiles?: number;
}): SideTripAssessment {
  const threshold = input.thresholdMiles ?? SIDE_TRIP_THRESHOLD_MILES;

  if (!input.position) {
    return {
      offRoute: false,
      milesFromRoute: 0,
      thresholdMiles: threshold,
      unavailable: true,
      reason: "no_position",
    };
  }
  if (input.routePoints.length < 2) {
    return {
      offRoute: false,
      milesFromRoute: 0,
      thresholdMiles: threshold,
      unavailable: true,
      reason: "no_route",
    };
  }

  const miles = distanceToPolylineMiles(input.position, input.routePoints);
  const offRoute = miles > threshold;
  return {
    offRoute,
    milesFromRoute: Math.round(miles * 10) / 10,
    thresholdMiles: threshold,
    unavailable: false,
    reason: offRoute ? "off_route" : "on_route",
  };
}
