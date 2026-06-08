// Pure, dependency-free location-merge logic for the trip-locations hook.
//
// `useTripLocations` keeps a single per-user map of the latest known position,
// assembled from two sources that can overlap and arrive out of order:
//   - the `location.listMemberLocations` tRPC query (polled cold-start / fallback
//     source, re-run on every (re)connect so a dropped socket never strands the
//     map on a stale frame), and
//   - live `{ type: "location", ... }` WebSocket frames broadcast by the
//     `TripRoom` Durable Object (the same room chat uses; the DO relay is
//     payload-agnostic).
//
// Both can deliver a position for the same `userId`. `mergeLocations` reconciles
// them into one map keyed by `userId` where the newest `updatedAt` wins, and is
// written so the hook can call it incrementally — `mergeLocations(prev, event)`
// — on every frame. It is pure: inputs are never mutated and the output depends
// only on the arguments.

/**
 * A live location frame as broadcast by the server (`updateLocation` ->
 * `ctx.realtime.broadcast`) and mirrored in `RealtimeBroadcast`
 * (`packages/api/src/realtime-runtime.ts`). Over the wire `updatedAt` arrives as
 * an ISO string; in-process callers may hand back a `Date`, so we accept both.
 */
export interface LocationEvent {
  userId: string;
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
  updatedAt: string | number | Date;
}

/** Per-user latest position, keyed by `userId`. */
export type LocationState = Record<string, LocationEvent>;

/**
 * Coerce any accepted `updatedAt` representation to epoch millis for a
 * deterministic newest-wins comparison. Unparseable values sort as `0` (oldest)
 * so a single malformed timestamp can never throw or let a junk frame win.
 */
function toTime(value: string | number | Date): number {
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Merge a single location `event` into the per-user `prev` map, newest
 * `updatedAt` wins.
 *
 * Semantics:
 *  - **Keyed by `userId`.** Each user has at most one entry.
 *  - **Newest wins.** A new user is added. For a known user the event replaces
 *    the stored position only when its `updatedAt` is strictly newer; an older
 *    or equal-aged frame is ignored (so a late-arriving stale broadcast can
 *    never rewind a marker).
 *
 * Pure and deterministic: `prev` is never mutated. When the event is ignored the
 * SAME `prev` reference is returned, so callers can use referential identity to
 * skip a re-render.
 */
export function mergeLocations(
  prev: LocationState,
  event: LocationEvent,
): LocationState {
  const existing = prev[event.userId];
  if (existing && toTime(event.updatedAt) <= toTime(existing.updatedAt)) {
    return prev; // older-or-equal frame for a known user — ignore.
  }
  return { ...prev, [event.userId]: event };
}
