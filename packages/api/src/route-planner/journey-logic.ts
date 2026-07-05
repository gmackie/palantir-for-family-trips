/**
 * Pure logic for journey logging — no db/trpc, so it's unit-testable. The
 * `journey` router loads rows and calls these.
 *
 * A "stop" is logged as a driving Segment whose destination is the place you
 * pulled into; consecutive stops chain (prev.destination → new stop). A pin is
 * dropped at the stop so it shows on the map with a typed icon.
 */

import type { PinType } from "@sortey/db/schema";

import { haversineMiles } from "../trips/driving-summary";

/** Kinds of stop a traveler logs; maps to a pin type + default label. */
export const STOP_KINDS = [
  "camp",
  "overnight",
  "rest",
  "scenic",
  "fuel",
  "water",
  "dump",
  "town",
  "custom",
] as const;
export type StopKind = (typeof STOP_KINDS)[number];

/** Map a stop kind to the pin icon type. Everything gets a visible pin. */
export function kindToPinType(kind: StopKind): PinType {
  switch (kind) {
    case "camp":
    case "overnight":
      return "campsite";
    case "rest":
      return "rest_area";
    case "scenic":
      return "scenic";
    case "fuel":
      return "fuel";
    case "water":
      return "water";
    case "dump":
      return "dump_station";
    default:
      return "custom";
  }
}

export interface SegmentLike {
  id: string;
  sortOrder: number;
  originLat: string | null;
  originLng: string | null;
  originName: string | null;
  destinationLat: string | null;
  destinationLng: string | null;
  destinationName: string | null;
}

export interface Point {
  lat: number;
  lng: number;
  name: string;
}

/** Next sortOrder to append (max + 1, or 0 for the first stop). */
export function nextSortOrder(segments: Array<{ sortOrder: number }>): number {
  return segments.reduce((max, s) => Math.max(max, s.sortOrder), -1) + 1;
}

/**
 * The point a newly-logged stop should route FROM: the destination of the
 * last (highest sortOrder) segment, or null when this is the first stop.
 */
export function resolvePrevPoint(segments: SegmentLike[]): Point | null {
  if (segments.length === 0) return null;
  const last = [...segments].sort((a, b) => b.sortOrder - a.sortOrder)[0]!;
  if (last.destinationLat == null || last.destinationLng == null) return null;
  return {
    lat: Number(last.destinationLat),
    lng: Number(last.destinationLng),
    name: last.destinationName ?? "Previous stop",
  };
}

/** Straight-line miles fallback when routing is unavailable. */
export function fallbackMiles(a: Point, b: Point): number {
  return Math.round(haversineMiles(a, b) * 10) / 10;
}

/**
 * Plan how to heal the chain after deleting the segment with `segmentId`:
 * which segment (if any) must be re-routed to originate from the deleted
 * segment's predecessor, so the journey stays connected.
 *
 * Returns the `next` segment to re-point and the `newOrigin` point, or null
 * when deleting the last segment (nothing downstream to heal).
 */
export function planHeal(
  segments: SegmentLike[],
  segmentId: string,
): { next: SegmentLike; newOrigin: Point | null } | null {
  const ordered = [...segments].sort((a, b) => a.sortOrder - b.sortOrder);
  const idx = ordered.findIndex((s) => s.id === segmentId);
  if (idx === -1) return null;
  const next = ordered[idx + 1];
  if (!next) return null; // deleting the last stop — nothing downstream
  const prev = ordered[idx - 1];
  const newOrigin: Point | null =
    prev && prev.destinationLat != null && prev.destinationLng != null
      ? {
          lat: Number(prev.destinationLat),
          lng: Number(prev.destinationLng),
          name: prev.destinationName ?? "Previous stop",
        }
      : null;
  return { next, newOrigin };
}
