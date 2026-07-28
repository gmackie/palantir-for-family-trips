/**
 * Pure helpers for active-trip default navigation (no SecureStore / RN deps).
 */

export const ACTIVE_TRIP_STATUSES = new Set(["en_route", "active", "paused"]);

export type TripListItem = {
  id: string;
  status: string;
  tripMode?: string | null;
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  name?: string | null;
};

export function isActiveTripStatus(status: string | null | undefined): boolean {
  return status != null && ACTIVE_TRIP_STATUSES.has(status);
}

/**
 * Prefer an in-progress trip (en_route / active / paused), then last-opened
 * if still in that list, else the soonest-starting non-completed trip.
 */
export function pickDefaultTrip(
  trips: TripListItem[],
  lastTripId?: string | null,
): TripListItem | null {
  if (trips.length === 0) return null;

  const active = trips.filter((t) => isActiveTripStatus(t.status));
  if (active.length === 1) return active[0]!;
  if (active.length > 1) {
    const enRoute = active.find((t) => t.status === "en_route");
    if (enRoute) return enRoute;
    return [...active].sort((a, b) => {
      const aT = a.startDate ? new Date(a.startDate).getTime() : 0;
      const bT = b.startDate ? new Date(b.startDate).getTime() : 0;
      return bT - aT;
    })[0]!;
  }

  if (lastTripId) {
    const last = trips.find((t) => t.id === lastTripId);
    if (last && last.status !== "completed") return last;
  }

  const open = trips.filter((t) => t.status !== "completed");
  if (open.length === 0) return trips[0] ?? null;

  return [...open].sort((a, b) => {
    const aT = a.startDate
      ? new Date(a.startDate).getTime()
      : Number.MAX_SAFE_INTEGER;
    const bT = b.startDate
      ? new Date(b.startDate).getTime()
      : Number.MAX_SAFE_INTEGER;
    return aT - bT;
  })[0]!;
}

/**
 * Landing route for an active road trip:
 * - moving → Drive
 * - stopped / unknown → Today Command
 */
export function defaultRouteForTrip(
  trip: TripListItem,
  motion: "moving" | "stopped" | "unknown" = "unknown",
): { pathname: string; params: { tripId: string } } {
  const road =
    trip.tripMode === "roadtrip" ||
    trip.tripMode === "road_trip" ||
    trip.tripMode == null;

  if (road && isActiveTripStatus(trip.status)) {
    if (motion === "moving") {
      return {
        pathname: "/trip/[tripId]/drive",
        params: { tripId: trip.id },
      };
    }
    return {
      pathname: "/trip/[tripId]/today",
      params: { tripId: trip.id },
    };
  }

  return {
    pathname: "/trip/[tripId]",
    params: { tripId: trip.id },
  };
}
