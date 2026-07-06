/**
 * Trip anchors — fixed commitments (a conference, a reservation, a family
 * visit) the route must honor. Pure + testable: pick the next upcoming anchor
 * and compute pacing (days left, miles away, miles/day needed) so the day-map
 * can warn "Open Sauce in 2 days, 340 mi away — average 170 mi/day".
 */

import { haversineMiles } from "../trips/driving-summary";

export interface AnchorLike {
  id: string;
  title: string;
  kind: string;
  placeName: string | null;
  lat: number | null;
  lng: number | null;
  startDate: string; // YYYY-MM-DD
  endDate: string | null;
}

export interface AnchorPacing {
  anchor: AnchorLike;
  /** Whole days from `today` to the anchor's startDate (0 = today, <0 = past). */
  daysUntil: number;
  /** Straight-line miles from the reference point, if both have coords. */
  milesAway: number | null;
  /** Miles/day needed to arrive on time (milesAway / max(daysUntil,1)). */
  milesPerDay: number | null;
  /** True when it's close in time but still far away. */
  behind: boolean;
}

function dayDiff(from: string, to: string): number {
  const d = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  return Number.isFinite(d) ? Math.round(d) : 0;
}

/** The soonest anchor whose end (or start) is still today or later. */
export function nextAnchor(
  anchors: AnchorLike[],
  today: string,
): AnchorLike | null {
  const upcoming = anchors
    .filter((a) => (a.endDate ?? a.startDate) >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  return upcoming[0] ?? null;
}

/** Miles/day considered "a hard push" for a van day. */
const HARD_PUSH_MPD = 300;

/**
 * Pace to an anchor from a reference point. `behind` trips when the required
 * miles/day exceeds a hard-push threshold (you're cutting it close).
 */
export function anchorPacing(
  anchor: AnchorLike,
  from: { lat: number; lng: number } | null,
  today: string,
): AnchorPacing {
  const daysUntil = dayDiff(today, anchor.startDate);
  const milesAway =
    from && anchor.lat != null && anchor.lng != null
      ? Math.round(haversineMiles(from, { lat: anchor.lat, lng: anchor.lng }))
      : null;
  const milesPerDay =
    milesAway != null ? Math.round(milesAway / Math.max(daysUntil, 1)) : null;
  const behind =
    milesPerDay != null && daysUntil >= 0 && milesPerDay > HARD_PUSH_MPD;
  return { anchor, daysUntil, milesAway, milesPerDay, behind };
}
