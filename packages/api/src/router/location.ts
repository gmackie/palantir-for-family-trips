import { and, eq, gt } from "@gmacko/db";
import { memberLocations, tripMembers } from "@gmacko/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { tripProcedure } from "../auth/guards";

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
          lat: String(input.lat),
          lng: String(input.lng),
          heading: input.heading != null ? String(input.heading) : null,
          speed: input.speed != null ? String(input.speed) : null,
          accuracy: input.accuracy != null ? String(input.accuracy) : null,
          sharingEnabled: true,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [memberLocations.tripId, memberLocations.userId],
          set: {
            lat: String(input.lat),
            lng: String(input.lng),
            heading: input.heading != null ? String(input.heading) : null,
            speed: input.speed != null ? String(input.speed) : null,
            accuracy: input.accuracy != null ? String(input.accuracy) : null,
            sharingEnabled: true,
            updatedAt: now,
          },
        })
        .returning({
          id: memberLocations.id,
          updatedAt: memberLocations.updatedAt,
        })) as { id: string; updatedAt: Date }[];

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
          lat: "0",
          lng: "0",
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
        lat: string;
        lng: string;
        heading: string | null;
        speed: string | null;
        updatedAt: Date;
        displayName: string | null;
        colorHex: string | null;
      }>;

      return rows.map((r) => ({
        userId: r.userId,
        lat: Number(r.lat),
        lng: Number(r.lng),
        heading: r.heading != null ? Number(r.heading) : null,
        speed: r.speed != null ? Number(r.speed) : null,
        updatedAt: r.updatedAt,
        displayName: r.displayName,
        colorHex: r.colorHex,
      }));
    }),
} satisfies TRPCRouterRecord;
