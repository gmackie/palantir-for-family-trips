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
 * Remaining fuel band along the planned route for map polyline coloring.
 *
 * - **safe** (green): plenty of range left before the next projected empty
 * - **caution** (amber): approaching empty — time to hunt Costco / fuel
 * - **empty** (red): at/past projected empty, and it STAYS red — running dry is
 *   the thing this coloring exists to warn about
 *
 * The accumulator resets only at the `refuelAtMiles` the caller supplies (the
 * predicted Fuel Zones from `computeFuelZones`). It does not reset at range
 * boundaries: assuming a fill-up happens exactly when the tank empties would
 * assume away the warning.
 */
export type FuelBand = "safe" | "caution" | "empty";

export const FUEL_BAND_COLORS: Record<FuelBand, string> = {
  safe: "#3FB950",
  caution: "#D29922",
  empty: "#F85149",
};

/** Fraction of tank range remaining at which we enter amber (default 25%). */
export const DEFAULT_CAUTION_FRACTION = 0.25;

export interface FuelColoredSegment {
  band: FuelBand;
  color: string;
  /** Inclusive start / inclusive end indices into the source points array. */
  fromIndex: number;
  toIndex: number;
  coordinates: LatLng[];
}

export function fuelBandAt(
  milesSinceFill: number,
  rangeMiles: number,
  cautionFraction: number = DEFAULT_CAUTION_FRACTION,
): FuelBand {
  if (!(rangeMiles > 0)) return "safe";
  const remaining = rangeMiles - milesSinceFill;
  if (remaining <= 0) return "empty";
  if (remaining <= rangeMiles * cautionFraction) return "caution";
  return "safe";
}

/**
 * Split a route polyline into colored segments by remaining fuel range.
 *
 * `milesSinceFill` offsets the start (miles already driven since the last
 * fill-up) and is NOT wrapped into one tank cycle — a van already past empty
 * reads as empty, not as full. `refuelAtMiles` are cumulative route miles at
 * which the tank is refilled; past the last one the route stays red.
 */
export function colorPolylineByFuelRange(
  points: LatLng[],
  rangeMiles: number,
  options?: {
    milesSinceFill?: number;
    cautionFraction?: number;
    /** Cumulative route miles at which the tank is refilled. */
    refuelAtMiles?: number[];
  },
): FuelColoredSegment[] {
  if (points.length < 2 || !(rangeMiles > 0)) return [];

  const cautionFraction = options?.cautionFraction ?? DEFAULT_CAUTION_FRACTION;
  let sinceLastFill = Math.max(options?.milesSinceFill ?? 0, 0);
  const refuels = [...(options?.refuelAtMiles ?? [])]
    .filter((m) => Number.isFinite(m) && m > 0)
    .sort((a, b) => a - b);
  let nextRefuel = 0;
  let cumulative = 0;

  const segments: FuelColoredSegment[] = [];
  let segStart = 0;
  let currentBand = fuelBandAt(sinceLastFill, rangeMiles, cautionFraction);

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const d = haversineMiles(prev, curr);
    cumulative += d;
    sinceLastFill += d;

    // Refill only where a Fuel Zone actually is.
    while (nextRefuel < refuels.length && cumulative >= refuels[nextRefuel]!) {
      sinceLastFill = 0;
      nextRefuel++;
    }

    const band = fuelBandAt(sinceLastFill, rangeMiles, cautionFraction);
    if (band !== currentBand) {
      segments.push({
        band: currentBand,
        color: FUEL_BAND_COLORS[currentBand],
        fromIndex: segStart,
        toIndex: i,
        coordinates: points.slice(segStart, i + 1),
      });
      segStart = i;
      currentBand = band;
    }
  }

  segments.push({
    band: currentBand,
    color: FUEL_BAND_COLORS[currentBand],
    fromIndex: segStart,
    toIndex: points.length - 1,
    coordinates: points.slice(segStart),
  });

  return segments.filter((s) => s.coordinates.length >= 2);
}

/** True when a POI name looks like a Costco (or Costco gas). */
export function isCostcoName(name: string | null | undefined): boolean {
  if (!name) return false;
  return /costco/i.test(name);
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
