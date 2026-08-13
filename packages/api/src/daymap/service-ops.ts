/**
 * Service-alert operation shared by the `daymap` tRPC router and the CLI, so
 * agents and the app compute identical alerts. Takes a Drizzle db + params.
 */

import { decode } from "@googlemaps/polyline-codec";
import { and, eq, gte, inArray, isNull, lte, or, sql } from "@sortey/db";
import { importedPois, tripSegments } from "@sortey/db/schema";

import {
  resolveCurrentPoint,
  type SegmentLike,
} from "../route-planner/journey-logic";
import { haversineMiles } from "../trips/driving-summary";
import {
  DEFAULT_RATES_PCT_PER_DAY,
  DEFAULT_RESOURCE_MODELS,
  matchServiceStops,
  predictServiceNeeds,
  type ResourceLevel,
  type ServiceAlert,
  type ServiceNeed,
  type ServicePoi,
} from "./service";
import {
  placePoisOnRoute,
  planServiceRun,
  type ServiceRunStop,
} from "./service-run";
import { resolveVanState } from "./vanstate-ops";

const SERVICE_CATEGORIES = ["dump_station", "water", "propane"];
const NEARBY_DEGREES = 1.5; // ~100mi box around current position

export interface ServiceLevels {
  grey?: number;
  black?: number;
  fresh?: number;
  propane?: number;
  fuel?: number;
}

export interface ServiceAlertsResult {
  position: { lat: number; lng: number; name: string } | null;
  alerts: ServiceAlert[];
  /** Clustered plan over the route ahead; empty without route geometry. */
  run: { stops: ServiceRunStop[]; unserved: ServiceNeed[] };
}

// biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
export async function computeServiceAlerts(
  db: any,
  p: { tripId: string; workspaceId?: string; levels?: ServiceLevels },
): Promise<ServiceAlertsResult> {
  const segments = (await db
    .select({
      id: tripSegments.id,
      sortOrder: tripSegments.sortOrder,
      originLat: tripSegments.originLat,
      originLng: tripSegments.originLng,
      originName: tripSegments.originName,
      destinationLat: tripSegments.destinationLat,
      destinationLng: tripSegments.destinationLng,
      destinationName: tripSegments.destinationName,
      startDate: tripSegments.startDate,
      routePolyline: tripSegments.routePolyline,
    })
    .from(tripSegments)
    .where(eq(tripSegments.tripId, p.tripId))) as SegmentLike[];

  const today = new Date().toISOString().slice(0, 10);
  const position = resolveCurrentPoint(segments, today);

  // Levels + rates: explicit `levels` win (e.g. a what-if); otherwise use the
  // trip's persisted VanState — latest reading per resource + rates learned
  // from this van's real history (falls back to defaults when history is thin).
  const vanState = p.levels ? null : await resolveVanState(db, p.tripId);
  const levelsObj = p.levels ?? vanState?.levels ?? {};
  const rates = vanState?.rates ?? DEFAULT_RATES_PCT_PER_DAY;
  const levels: ResourceLevel[] = Object.entries(levelsObj)
    .filter(([, v]) => v != null)
    .map(([resource, levelPct]) => ({
      resource,
      levelPct: levelPct as number,
    }));

  if (!position || levels.length === 0) {
    return { position, alerts: [], run: { stops: [], unserved: [] } };
  }

  const rows = (await db
    .select({
      id: importedPois.id,
      name: importedPois.name,
      category: importedPois.category,
      lat: importedPois.lat,
      lng: importedPois.lng,
    })
    .from(importedPois)
    .where(
      and(
        inArray(importedPois.category, SERVICE_CATEGORIES),
        gte(importedPois.lat, position.lat - NEARBY_DEGREES),
        lte(importedPois.lat, position.lat + NEARBY_DEGREES),
        gte(importedPois.lng, position.lng - NEARBY_DEGREES),
        lte(importedPois.lng, position.lng + NEARBY_DEGREES),
        p.workspaceId
          ? or(
              isNull(importedPois.workspaceId),
              eq(importedPois.workspaceId, p.workspaceId),
            )
          : isNull(importedPois.workspaceId),
      ),
    )
    // Order by a cheap Manhattan proxy so the cap drops the FARTHEST rows.
    // Without it Postgres returns an arbitrary 1,000 of however many sit in
    // the box — 2,194 in the Bay Area alone — and the nearest dump station
    // can simply be absent. The user is then told "none on your route", which
    // is the one answer this feature must never give wrongly.
    .orderBy(
      sql`abs(${importedPois.lat} - ${position.lat}) + abs(${importedPois.lng} - ${position.lng})`,
    )
    .limit(1000)) as Array<{
    id: string;
    name: string;
    category: string;
    lat: string;
    lng: string;
  }>;

  const pois: ServicePoi[] = rows
    .filter((r) => SERVICE_CATEGORIES.includes(r.category))
    .map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      lat: Number(r.lat),
      lng: Number(r.lng),
    }));

  const needs = predictServiceNeeds(levels, DEFAULT_RESOURCE_MODELS, rates);

  // Clustered plan over the route ahead. `alerts` stays as-is — nearest stop
  // per need — because a single urgent need still wants a single answer; the
  // run is what you do when several converge. A trip without route geometry
  // gets alerts and no run rather than a run built on straight lines.
  const route: Array<{ lat: number; lng: number }> = [];
  for (const segment of [...segments].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  )) {
    const encoded = (segment as { routePolyline?: string | null })
      .routePolyline;
    if (!encoded) continue;
    for (const [lat, lng] of decode(encoded, 5)) {
      const last = route.at(-1);
      if (last && last.lat === lat && last.lng === lng) continue;
      route.push({ lat, lng });
    }
  }

  let run: { stops: ServiceRunStop[]; unserved: typeof needs } = {
    stops: [],
    unserved: [],
  };
  if (route.length >= 2) {
    // Everything from the current position onward: a dump behind you is not
    // a plan, however near it is.
    const fromRouteMile = routeMileNearest(route, position);
    run = planServiceRun({
      needs,
      pois: placePoisOnRoute({ pois, route, fromRouteMile }),
    });
  }

  return { position, alerts: matchServiceStops(needs, pois, position), run };
}

/** Cumulative route miles at the polyline point closest to `point`. */
function routeMileNearest(
  route: Array<{ lat: number; lng: number }>,
  point: { lat: number; lng: number },
): number {
  let cumulative = 0;
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < route.length; i++) {
    if (i > 0) cumulative += haversineMiles(route[i - 1]!, route[i]!);
    const distance = haversineMiles(route[i]!, point);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = cumulative;
    }
  }
  return best;
}
