/**
 * GPS breadcrumb track — turns a series of recorded positions into the actual
 * path traveled and its stats (real distance, bounds, time span). Pure +
 * testable; the location router persists points and calls these. Complements
 * the planned segment mileage in the recap with *actually driven* distance.
 */

import { haversineMiles } from "../trips/driving-summary";

export interface TrackPoint {
  lat: number;
  lng: number;
  /** ISO-8601 timestamp. */
  recordedAt: string;
}

export interface TrackStats {
  points: number;
  /** Sum of great-circle hops between consecutive points, in miles. */
  actualMiles: number;
  firstAt: string | null;
  lastAt: string | null;
  bounds: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  } | null;
}

// Ignore GPS jitter: hops shorter than this don't add to distance (parked
// drift), and absurdly long ones are dropped as bad fixes.
const MIN_HOP_MILES = 0.02; // ~30 m
const MAX_HOP_MILES = 200; // a single hop over this is a bad fix, skip it

/** Order points by time, tolerating out-of-order client batches. */
function ordered(points: TrackPoint[]): TrackPoint[] {
  return [...points]
    .filter(
      (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && !!p.recordedAt,
    )
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
}

/** Compute distance + bounds + span from a breadcrumb series. */
export function buildTrackStats(points: TrackPoint[]): TrackStats {
  const pts = ordered(points);
  if (pts.length === 0) {
    return {
      points: 0,
      actualMiles: 0,
      firstAt: null,
      lastAt: null,
      bounds: null,
    };
  }

  let miles = 0;
  let minLat = pts[0]!.lat;
  let maxLat = pts[0]!.lat;
  let minLng = pts[0]!.lng;
  let maxLng = pts[0]!.lng;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
    if (i > 0) {
      const hop = haversineMiles(pts[i - 1]!, p);
      if (hop >= MIN_HOP_MILES && hop <= MAX_HOP_MILES) miles += hop;
    }
  }

  return {
    points: pts.length,
    actualMiles: Math.round(miles * 10) / 10,
    firstAt: pts[0]!.recordedAt,
    lastAt: pts[pts.length - 1]!.recordedAt,
    bounds: { minLat, maxLat, minLng, maxLng },
  };
}

/**
 * Downsample a path to at most `max` points for display (keeps first + last,
 * evenly strides the middle) — a full day of 5-second fixes is thousands of
 * points no map needs.
 */
export function downsamplePath<T>(points: T[], max = 500): T[] {
  if (points.length <= max) return points;
  const stride = (points.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    out.push(points[Math.round(i * stride)]!);
  }
  return out;
}
