import { and, eq, gte, lte } from "@gmacko/db";
import { importedPois, poiCache } from "@gmacko/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { tripProcedure } from "../auth/guards";

const CORRIDOR_RADIUS_MILES = 30;
const MILES_TO_DEGREES_LAT = 1 / 69;
const MILES_TO_DEGREES_LNG_AT_45 = 1 / 49;

export const corridorRouter = {
  searchImported: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        centerLat: z.number(),
        centerLng: z.number(),
        radiusMiles: z.number().positive().default(CORRIDOR_RADIUS_MILES),
        category: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      const latDelta = input.radiusMiles * MILES_TO_DEGREES_LAT;
      const lngDelta = input.radiusMiles * MILES_TO_DEGREES_LNG_AT_45;

      const conditions = [
        gte(importedPois.lat, (input.centerLat - latDelta).toString()),
        lte(importedPois.lat, (input.centerLat + latDelta).toString()),
        gte(importedPois.lng, (input.centerLng - lngDelta).toString()),
        lte(importedPois.lng, (input.centerLng + lngDelta).toString()),
      ];

      if (input.category) {
        conditions.push(eq(importedPois.category, input.category));
      }

      return ctx.db
        .select()
        .from(importedPois)
        .where(and(...conditions))
        .limit(input.limit);
    }),

  searchCached: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        centerLat: z.number(),
        centerLng: z.number(),
        radiusMiles: z.number().positive().default(CORRIDOR_RADIUS_MILES),
        category: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      const latDelta = input.radiusMiles * MILES_TO_DEGREES_LAT;
      const lngDelta = input.radiusMiles * MILES_TO_DEGREES_LNG_AT_45;

      const conditions = [
        gte(poiCache.lat, (input.centerLat - latDelta).toString()),
        lte(poiCache.lat, (input.centerLat + latDelta).toString()),
        gte(poiCache.lng, (input.centerLng - lngDelta).toString()),
        lte(poiCache.lng, (input.centerLng + lngDelta).toString()),
      ];

      if (input.category) {
        conditions.push(eq(poiCache.category, input.category));
      }

      return ctx.db
        .select()
        .from(poiCache)
        .where(and(...conditions))
        .limit(input.limit);
    }),
} satisfies TRPCRouterRecord;
