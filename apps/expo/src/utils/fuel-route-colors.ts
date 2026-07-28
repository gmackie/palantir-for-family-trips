/**
 * Client-side fuel-range route coloring (mirrors packages/api route-planner/zones).
 * Kept local so the Expo bundle does not pull the full API package.
 */

export type FuelBand = "safe" | "caution" | "empty";

export const FUEL_BAND_COLORS: Record<FuelBand, string> = {
  safe: "#3FB950",
  caution: "#D29922",
  empty: "#F85149",
};

export const DEFAULT_CAUTION_FRACTION = 0.25;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface FuelColoredSegment {
  band: FuelBand;
  color: string;
  coordinates: Array<{ latitude: number; longitude: number }>;
}

function haversineMiles(a: LatLng, b: LatLng): number {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sLat = Math.sin(dLat / 2);
  const sLng = Math.sin(dLng / 2);
  const h =
    sLat * sLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sLng *
      sLng;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
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

export function colorPolylineByFuelRange(
  points: LatLng[],
  rangeMiles: number,
  options?: { milesSinceFill?: number; cautionFraction?: number },
): FuelColoredSegment[] {
  if (points.length < 2 || !(rangeMiles > 0)) return [];

  const cautionFraction = options?.cautionFraction ?? DEFAULT_CAUTION_FRACTION;
  let sinceLastFill = Math.max(options?.milesSinceFill ?? 0, 0) % rangeMiles;

  const segments: FuelColoredSegment[] = [];
  let segStart = 0;
  let currentBand = fuelBandAt(sinceLastFill, rangeMiles, cautionFraction);

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    sinceLastFill += haversineMiles(prev, curr);
    while (sinceLastFill >= rangeMiles) sinceLastFill -= rangeMiles;

    const band = fuelBandAt(sinceLastFill, rangeMiles, cautionFraction);
    if (band !== currentBand) {
      segments.push({
        band: currentBand,
        color: FUEL_BAND_COLORS[currentBand],
        coordinates: points.slice(segStart, i + 1).map((p) => ({
          latitude: p.lat,
          longitude: p.lng,
        })),
      });
      segStart = i;
      currentBand = band;
    }
  }

  segments.push({
    band: currentBand,
    color: FUEL_BAND_COLORS[currentBand],
    coordinates: points.slice(segStart).map((p) => ({
      latitude: p.lat,
      longitude: p.lng,
    })),
  });

  return segments.filter((s) => s.coordinates.length >= 2);
}

export function isCostcoName(name: string | null | undefined): boolean {
  if (!name) return false;
  return /costco/i.test(name);
}
