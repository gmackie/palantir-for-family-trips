/**
 * Service-alert operation shared by the `daymap` tRPC router and the CLI, so
 * agents and the app compute identical alerts. Takes a Drizzle db + params.
 */

import { and, eq, gte, inArray, isNull, lte, or } from "@sortey/db";
import { importedPois, tripSegments } from "@sortey/db/schema";

import {
  resolveCurrentPoint,
  type SegmentLike,
} from "../route-planner/journey-logic";
import {
  DEFAULT_RATES_PCT_PER_DAY,
  DEFAULT_RESOURCE_MODELS,
  matchServiceStops,
  predictServiceNeeds,
  type ResourceLevel,
  type ServiceAlert,
  type ServicePoi,
} from "./service";
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
    return { position, alerts: [] };
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
        gte(importedPois.lat, (position.lat - NEARBY_DEGREES).toString()),
        lte(importedPois.lat, (position.lat + NEARBY_DEGREES).toString()),
        gte(importedPois.lng, (position.lng - NEARBY_DEGREES).toString()),
        lte(importedPois.lng, (position.lng + NEARBY_DEGREES).toString()),
        p.workspaceId
          ? or(
              isNull(importedPois.workspaceId),
              eq(importedPois.workspaceId, p.workspaceId),
            )
          : isNull(importedPois.workspaceId),
      ),
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
  return { position, alerts: matchServiceStops(needs, pois, position) };
}
