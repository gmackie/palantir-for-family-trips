import { haversineMiles } from "../trips/driving-summary";
import type { ServiceNeed, ServicePoi } from "./service";

/**
 * Service-run clustering — DayMap Feature A, step 3.
 *
 * `matchServiceStops` answers "where is the nearest dump", one need at a time.
 * That is the wrong shape for a travel day: pulling off four separate times for
 * water, dump, propane, and groceries costs more than the detour ever saves.
 * This bundles converging needs into one stop, and — unlike nearest-by-
 * straight-line — it only considers POIs that are still **ahead** on the route.
 * A dump station forty miles behind you is not a plan.
 */

export interface RoutePoint {
  lat: number;
  lng: number;
}

/** A POI placed along the route: how far in, and how far off it. */
export interface RouteMatchedPoi extends ServicePoi {
  /** Cumulative route miles at the nearest point of the polyline. */
  routeMile: number;
  /** Detour distance from the route to the POI. */
  milesOffRoute: number;
}

export interface ServiceRunStop {
  /** Where the run happens — the anchor POI. */
  poi: RouteMatchedPoi;
  /** Everything servable at or beside this stop. */
  needs: ServiceNeed[];
  /** Other POIs within the cluster radius that cover the rest. */
  alsoAt: RouteMatchedPoi[];
  /** Soonest need in the bundle, in days. */
  daysUntilFirstNeed: number;
}

/** Needs converging within this many miles are worth one pull-off. */
export const DEFAULT_CLUSTER_RADIUS_MILES = 5;
/** Beyond this a "corridor" POI is really a side trip. */
export const DEFAULT_MAX_OFF_ROUTE_MILES = 15;

/**
 * Place POIs along the route: cumulative mile of the closest polyline point,
 * and the detour to reach it. Points behind `fromRouteMile` are dropped — the
 * whole failure mode of nearest-by-distance is recommending a stop you have
 * already driven past.
 */
export function placePoisOnRoute(params: {
  pois: ServicePoi[];
  route: RoutePoint[];
  fromRouteMile?: number;
  maxOffRouteMiles?: number;
}): RouteMatchedPoi[] {
  const { pois, route } = params;
  if (route.length < 2) return [];
  const fromMile = params.fromRouteMile ?? 0;
  const maxOff = params.maxOffRouteMiles ?? DEFAULT_MAX_OFF_ROUTE_MILES;

  // Cumulative mileage at each polyline vertex, computed once.
  const cumulative: number[] = [0];
  for (let i = 1; i < route.length; i++) {
    cumulative.push(
      cumulative[i - 1]! + haversineMiles(route[i - 1]!, route[i]!),
    );
  }

  const placed: RouteMatchedPoi[] = [];
  for (const poi of pois) {
    let bestMile = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < route.length; i++) {
      const distance = haversineMiles(route[i]!, poi);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestMile = cumulative[i]!;
      }
    }
    if (bestDistance > maxOff) continue;
    if (bestMile < fromMile) continue;
    placed.push({
      ...poi,
      routeMile: Math.round(bestMile * 10) / 10,
      milesOffRoute: Math.round(bestDistance * 10) / 10,
    });
  }
  return placed.sort((a, b) => a.routeMile - b.routeMile);
}

/**
 * Bundle needs into as few stops as possible, earliest on the route first.
 *
 * Greedy by route position rather than by urgency: the traveller drives the
 * route in order, so the first servable cluster they reach is the one they
 * should take. A need with no POI ahead of them is returned in `unserved`
 * rather than silently dropped — "there is nowhere to dump on this leg" is
 * information, and hiding it is how someone ends up with a full tank and no
 * options.
 */
export function planServiceRun(params: {
  needs: ServiceNeed[];
  pois: RouteMatchedPoi[];
  clusterRadiusMiles?: number;
}): { stops: ServiceRunStop[]; unserved: ServiceNeed[] } {
  const radius = params.clusterRadiusMiles ?? DEFAULT_CLUSTER_RADIUS_MILES;
  const remaining = [...params.needs];
  const stops: ServiceRunStop[] = [];

  // Earliest-on-route first: that is the order they will be driven past.
  const byMile = [...params.pois].sort((a, b) => a.routeMile - b.routeMile);

  for (const anchor of byMile) {
    if (remaining.length === 0) break;

    const nearby = byMile.filter(
      (poi) => Math.abs(poi.routeMile - anchor.routeMile) <= radius,
    );
    const categories = new Set(nearby.map((poi) => poi.category));
    const served = remaining.filter((need) =>
      categories.has(need.serviceCategory),
    );
    // Only worth a stop if this cluster covers something, and the anchor
    // itself must be one of the things being serviced.
    if (served.length === 0) continue;
    if (!served.some((need) => need.serviceCategory === anchor.category)) {
      continue;
    }

    for (const need of served) {
      remaining.splice(remaining.indexOf(need), 1);
    }
    stops.push({
      poi: anchor,
      needs: served.sort((a, b) => a.daysUntil - b.daysUntil),
      alsoAt: nearby.filter((poi) => poi.id !== anchor.id),
      daysUntilFirstNeed: Math.min(...served.map((need) => need.daysUntil)),
    });
  }

  return { stops, unserved: remaining };
}
