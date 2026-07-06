import { and, eq, gte, isNull, lte, or } from "@sortey/db";
import { importIoverlanderCsv } from "@sortey/db/ioverlander";
import { importedPois, poiCache } from "@sortey/db/schema";
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
        // Shared (OSM) POIs OR this workspace's private uploads (iOverlander) —
        // never another workspace's non-redistributable data.
        or(
          isNull(importedPois.workspaceId),
          eq(importedPois.workspaceId, input.workspaceId),
        ),
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

  /**
   * Import a user's own iOverlander CSV export, scoped to their workspace.
   *
   * LICENSING: iOverlander data can't be redistributed, so each user uploads
   * their OWN export — the rows are stamped with `input.workspaceId` (validated
   * by `tripProcedure`) and de-duped on (source, externalId), so re-uploading is
   * idempotent and no workspace ever ingests another's data. The CSV text is
   * passed in-process by the `/api/poi/ioverlander` upload route (no HTTP body
   * limit); parsing/scoping/insert are shared with the CLI via
   * `@sortey/db/ioverlander`.
   */
  importIoverlander: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        csv: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      importIoverlanderCsv(ctx.db, {
        text: input.csv,
        workspaceId: input.workspaceId,
      }),
    ),
} satisfies TRPCRouterRecord;
