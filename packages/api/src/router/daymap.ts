import { and, eq, gte, lte } from "@sortey/db";
import { importedPois, tripSegments } from "@sortey/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { tripProcedure } from "../auth/guards";
import {
  matchServiceStops,
  predictServiceNeeds,
  type ResourceLevel,
  type ServicePoi,
} from "../daymap/service";
import {
  resolvePrevPoint,
  type SegmentLike,
} from "../route-planner/journey-logic";

const SERVICE_CATEGORIES = ["dump_station", "water", "propane"];
const NEARBY_DEGREES = 1.5; // ~100mi search box around current position

export const daymapRouter = {
  /**
   * Predictive van-service alerts: "service before it becomes urgent". Given
   * current resource levels (manual now, DriftPort telemetry later), forecast
   * when each needs service and match to the nearest corridor POI ahead.
   * Fail-soft — returns empty alerts when there's no position or no levels.
   */
  serviceAlerts: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        levels: z
          .object({
            grey: z.number().min(0).max(100).optional(),
            black: z.number().min(0).max(100).optional(),
            fresh: z.number().min(0).max(100).optional(),
            propane: z.number().min(0).max(100).optional(),
          })
          .optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const segments = (await ctx.db
        .select({
          id: tripSegments.id,
          sortOrder: tripSegments.sortOrder,
          originLat: tripSegments.originLat,
          originLng: tripSegments.originLng,
          originName: tripSegments.originName,
          destinationLat: tripSegments.destinationLat,
          destinationLng: tripSegments.destinationLng,
          destinationName: tripSegments.destinationName,
        })
        .from(tripSegments)
        .where(eq(tripSegments.tripId, ctx.tripId))) as SegmentLike[];

      const position = resolvePrevPoint(segments);
      const levels: ResourceLevel[] = Object.entries(input.levels ?? {})
        .filter(([, v]) => v != null)
        .map(([resource, levelPct]) => ({
          resource,
          levelPct: levelPct as number,
        }));

      if (!position || levels.length === 0) {
        return { position, alerts: [] };
      }

      // Corridor POIs of the service categories near the current position.
      const rows = (await ctx.db
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
            gte(importedPois.lat, (position.lat - NEARBY_DEGREES).toString()),
            lte(importedPois.lat, (position.lat + NEARBY_DEGREES).toString()),
            gte(importedPois.lng, (position.lng - NEARBY_DEGREES).toString()),
            lte(importedPois.lng, (position.lng + NEARBY_DEGREES).toString()),
          ),
        )
        .limit(500)) as Array<{
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

      const needs = predictServiceNeeds(levels);
      const alerts = matchServiceStops(needs, pois, position);

      return { position, alerts };
    }),
} satisfies TRPCRouterRecord;
