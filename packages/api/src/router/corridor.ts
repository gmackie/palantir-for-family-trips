import { and, eq, gte, inArray, isNull, lte, or } from "@sortey/db";
import { AMENITY_GROUPS, importIoverlanderCsv } from "@sortey/db/ioverlander";
import { importedPois, poiCache } from "@sortey/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { tripProcedure } from "../auth/guards";
import { rankPoisNear } from "../route-planner/poi-suggest";

const CORRIDOR_RADIUS_MILES = 30;
const MILES_TO_DEGREES_LAT = 1 / 69;
const MILES_TO_DEGREES_LNG_AT_45 = 1 / 49;

export const corridorRouter = {
  /** Amenity group → category lists (sleep, parking, service, fuel, food, road). */
  amenityGroups: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
      }),
    )
    .query(() => AMENITY_GROUPS),

  searchImported: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        centerLat: z.number(),
        centerLng: z.number(),
        radiusMiles: z.number().positive().default(CORRIDOR_RADIUS_MILES),
        category: z.string().optional(),
        /** Multi-select categories (takes precedence over single category). */
        categories: z.array(z.string()).max(20).optional(),
        /** Amenity group shortcut: sleep | parking | service | fuel | food | road */
        group: z
          .enum(["sleep", "parking", "service", "fuel", "food", "road"])
          .optional(),
        limit: z.number().int().min(1).max(200).default(100),
        /** When true, sort by distance and attach milesAway. */
        rankByDistance: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      const groupCats = input.group
        ? [...AMENITY_GROUPS[input.group]]
        : undefined;
      const categories =
        input.categories && input.categories.length > 0
          ? input.categories
          : groupCats
            ? groupCats
            : input.category
              ? [input.category]
              : undefined;

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

      if (categories && categories.length === 1) {
        conditions.push(eq(importedPois.category, categories[0]!));
      } else if (categories && categories.length > 1) {
        conditions.push(inArray(importedPois.category, categories));
      }

      const rows = (await ctx.db
        .select()
        .from(importedPois)
        .where(and(...conditions))
        .limit(
          input.rankByDistance ? Math.min(500, input.limit * 4) : input.limit,
        )) as Array<{
        id: string;
        source: string;
        externalId: string;
        name: string;
        category: string;
        lat: string;
        lng: string;
        data: unknown;
        workspaceId: string | null;
        importedAt: Date;
      }>;

      if (!input.rankByDistance) {
        return rows;
      }

      const ranked = rankPoisNear(
        { lat: input.centerLat, lng: input.centerLng },
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          category: r.category,
          lat: Number(r.lat),
          lng: Number(r.lng),
          source: r.source,
        })),
        {
          maxMiles: input.radiusMiles,
          limit: input.limit,
          preferSleep: input.group === "sleep",
          categories,
        },
      );
      const byId = new Map(rows.map((r) => [r.id, r]));
      return ranked
        .map((p) => {
          const row = byId.get(p.id);
          if (!row) return null;
          return {
            ...row,
            milesAway: p.milesAway,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r != null);
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
