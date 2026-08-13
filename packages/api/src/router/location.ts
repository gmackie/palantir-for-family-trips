import { and, eq, gt } from "@sortey/db";
import { memberLocations, tripMembers } from "@sortey/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { tripProcedure } from "../auth/guards";
import { downsamplePath } from "../route-planner/track";
import {
  getTrackPath,
  getTrackStats,
  recordBreadcrumbs,
} from "../route-planner/track-ops";

const tripScopedInput = z.object({
  workspaceId: z.string().min(1),
  tripId: z.string().min(1),
});

export const locationRouter = {
  updateLocation: tripProcedure()
    .input(
      tripScopedInput.extend({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        heading: z.number().nullable().optional(),
        speed: z.number().nullable().optional(),
        accuracy: z.number().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();

      const [row] = (await ctx.db
        .insert(memberLocations)
        .values({
          tripId: ctx.tripId,
          userId: ctx.session.user.id,
          lat: input.lat,
          lng: input.lng,
          heading: input.heading ?? null,
          speed: input.speed ?? null,
          accuracy: input.accuracy ?? null,
          sharingEnabled: true,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [memberLocations.tripId, memberLocations.userId],
          set: {
            lat: input.lat,
            lng: input.lng,
            heading: input.heading ?? null,
            speed: input.speed ?? null,
            accuracy: input.accuracy ?? null,
            sharingEnabled: true,
            updatedAt: now,
          },
        })
        .returning({
          id: memberLocations.id,
          updatedAt: memberLocations.updatedAt,
        })) as { id: string; updatedAt: Date }[];

      // Fan the new position out to connected WebSocket clients via the TripRoom
      // Durable Object. `ctx.realtime` is populated by the worker entry (Workers
      // runtime) and is `undefined`/`null` in unit tests, where this is a no-op.
      // Best-effort: a broadcast failure must never roll back or block the
      // already-persisted upsert.
      ctx.realtime?.broadcast(ctx.tripId, {
        type: "location",
        userId: ctx.session.user.id,
        lat: input.lat,
        lng: input.lng,
        heading: input.heading ?? null,
        speed: input.speed ?? null,
        updatedAt: row!.updatedAt.toISOString(),
      });

      return row!;
    }),

  setSharingEnabled: tripProcedure()
    .input(
      tripScopedInput.extend({
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.enabled) {
        await ctx.db
          .update(memberLocations)
          .set({ sharingEnabled: false })
          .where(
            and(
              eq(memberLocations.tripId, ctx.tripId),
              eq(memberLocations.userId, ctx.session.user.id),
            ),
          );
        return { sharingEnabled: false };
      }

      await ctx.db
        .insert(memberLocations)
        .values({
          tripId: ctx.tripId,
          userId: ctx.session.user.id,
          lat: 0,
          lng: 0,
          sharingEnabled: true,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [memberLocations.tripId, memberLocations.userId],
          set: { sharingEnabled: true },
        });

      return { sharingEnabled: true };
    }),

  getSharingStatus: tripProcedure()
    .input(tripScopedInput)
    .query(async ({ ctx }) => {
      const [row] = (await ctx.db
        .select({ sharingEnabled: memberLocations.sharingEnabled })
        .from(memberLocations)
        .where(
          and(
            eq(memberLocations.tripId, ctx.tripId),
            eq(memberLocations.userId, ctx.session.user.id),
          ),
        )
        .limit(1)) as { sharingEnabled: boolean }[];

      return { sharingEnabled: row?.sharingEnabled ?? false };
    }),

  listMemberLocations: tripProcedure()
    .input(tripScopedInput)
    .query(async ({ ctx }) => {
      const staleThreshold = new Date(Date.now() - 30 * 60 * 1000);

      const rows = (await ctx.db
        .select({
          userId: memberLocations.userId,
          lat: memberLocations.lat,
          lng: memberLocations.lng,
          heading: memberLocations.heading,
          speed: memberLocations.speed,
          updatedAt: memberLocations.updatedAt,
          displayName: tripMembers.displayName,
          colorHex: tripMembers.colorHex,
        })
        .from(memberLocations)
        .innerJoin(
          tripMembers,
          and(
            eq(tripMembers.tripId, memberLocations.tripId),
            eq(tripMembers.userId, memberLocations.userId),
          ),
        )
        .where(
          and(
            eq(memberLocations.tripId, ctx.tripId),
            eq(memberLocations.sharingEnabled, true),
            gt(memberLocations.updatedAt, staleThreshold),
          ),
        )) as Array<{
        userId: string;
        lat: number;
        lng: number;
        heading: number | null;
        speed: number | null;
        updatedAt: Date;
        displayName: string | null;
        colorHex: string | null;
      }>;

      return rows.map((r) => ({
        userId: r.userId,
        lat: r.lat,
        lng: r.lng,
        heading: r.heading,
        speed: r.speed,
        updatedAt: r.updatedAt,
        displayName: r.displayName,
        colorHex: r.colorHex,
      }));
    }),

  /**
   * Append GPS breadcrumbs (the append-only trail, distinct from live
   * presence). Clients batch fixes while driving; we store the actual path so
   * the recap can report *driven* miles and the map can draw the real route.
   */
  recordBreadcrumbs: tripProcedure()
    .input(
      tripScopedInput.extend({
        segmentId: z.string().uuid().nullable().optional(),
        points: z
          .array(
            z.object({
              lat: z.number().min(-90).max(90),
              lng: z.number().min(-180).max(180),
              speed: z.number().nullable().optional(),
              recordedAt: z.string().datetime().optional(),
            }),
          )
          .min(1)
          .max(1000),
      }),
    )
    .mutation(({ ctx, input }) =>
      recordBreadcrumbs(ctx.db, {
        tripId: ctx.tripId,
        segmentId: input.segmentId,
        points: input.points,
      }),
    ),

  /** Actual-path stats: driven miles, bounds, time span. */
  trackStats: tripProcedure()
    .input(tripScopedInput.extend({ since: z.string().datetime().optional() }))
    .query(({ ctx, input }) =>
      getTrackStats(ctx.db, ctx.tripId, { since: input.since }),
    ),

  /** The ordered breadcrumb path, downsampled for map display. */
  trackPath: tripProcedure()
    .input(
      tripScopedInput.extend({
        since: z.string().datetime().optional(),
        max: z.number().int().min(2).max(2000).default(500),
      }),
    )
    .query(async ({ ctx, input }) => {
      const path = await getTrackPath(ctx.db, ctx.tripId, {
        since: input.since,
      });
      return downsamplePath(path, input.max);
    }),
} satisfies TRPCRouterRecord;
