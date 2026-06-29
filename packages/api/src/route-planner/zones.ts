/**
 * Route-intelligence zone computation.
 *
 * Pure functions that turn a planned route + van fuel model into the
 * **Fuel Zones** and **Overnight Zones** that the road-trip UI already knows
 * how to render (`route-gradient-map.tsx`, `triptik-strip.tsx`). Kept free of
 * db/trpc so they are unit-testable in isolation.
 *
 * Vocabulary (see CONTEXT.md):
 * - Fuel Zone: a predicted area along the route where the van will need fuel,
 *   based on MPG x tank x threshold (remaining range gets low). An *area with
 *   options*, not a specific station.
 * - Overnight Zone: a ~30mi radius near a driving day's end (the segment
 *   boundary the auto-splitter placed at ~sunset). The user picks the spot.
 */

import { haversineMiles } from "../trips/driving-summary";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface FuelZone {
  lat: number;
  lng: number;
  /** Cumulative miles from the route start. */
  mileMarker: number;
}

export interface OvernightZone {
  lat: number;
  lng: number;
  radiusMiles: number;
  /** Cumulative miles from the route start at this driving-day boundary. */
  mileMarker: number;
}

/** A segment boundary as needed for overnight-zone placement. */
export interface ZoneSegment {
  destinationLat: number | null;
  destinationLng: number | null;
  /** Driving distance of this segment, in miles, if known. */
  distanceMiles: number | null;
}

/** Fraction of tank range at which we flag a Fuel Zone (refuel before empty). */
export const DEFAULT_FUEL_THRESHOLD = 0.8;

/** Radius of an Overnight Zone — the area of overnight options to choose from. */
export const OVERNIGHT_ZONE_RADIUS_MILES = 30;

/**
 * Usable range between fill-ups: MPG x tank, derated by a safety threshold so a
 * Fuel Zone appears before the tank is actually empty. Returns 0 when the van
 * model is incomplete (caller then yields no fuel zones).
 */
export function fuelRangeMiles(
  mpg: number | null | undefined,
  tankGallons: number | null | undefined,
  threshold: number = DEFAULT_FUEL_THRESHOLD,
): number {
  if (mpg == null || tankGallons == null) return 0;
  if (!(mpg > 0) || !(tankGallons > 0)) return 0;
  return mpg * tankGallons * threshold;
}

/**
 * Walk the route polyline, placing a Fuel Zone every `rangeMiles` of travel.
 * The first zone lands ~one tank-range in (tank starts full); the accumulator
 * resets at each zone. Returns [] if the range or polyline is unusable.
 */
export function computeFuelZones(
  points: LatLng[],
  rangeMiles: number,
): FuelZone[] {
  if (!(rangeMiles > 0) || points.length < 2) return [];

  const zones: FuelZone[] = [];
  let cumulative = 0;
  let sinceLastFill = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const d = haversineMiles(prev, curr);
    cumulative += d;
    sinceLastFill += d;
    if (sinceLastFill >= rangeMiles) {
      zones.push({
        lat: curr.lat,
        lng: curr.lng,
        mileMarker: Math.round(cumulative),
      });
      sinceLastFill = 0;
    }
  }

  return zones;
}

/**
 * Place an Overnight Zone at every driving-day boundary — i.e. the destination
 * of each segment except the final one (whose destination is the trip's
 * arrival, not an overnight). Segments must be in travel order. Boundaries
 * missing coordinates are skipped; mile markers accumulate known segment
 * distances.
 */
export function computeOvernightZones(
  segments: ZoneSegment[],
  radiusMiles: number = OVERNIGHT_ZONE_RADIUS_MILES,
): OvernightZone[] {
  if (segments.length < 2) return [];

  const zones: OvernightZone[] = [];
  let cumulative = 0;

  // Every boundary except the last segment's destination.
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    cumulative += seg.distanceMiles ?? 0;
    if (seg.destinationLat == null || seg.destinationLng == null) continue;
    zones.push({
      lat: seg.destinationLat,
      lng: seg.destinationLng,
      radiusMiles,
      mileMarker: Math.round(cumulative),
    });
  }

  return zones;
}
