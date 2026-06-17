import { and, asc, desc, eq, sql } from "@sortey/db";
import {
  photoReactions,
  tripMembers,
  tripPhotos,
  tripSegments,
} from "@sortey/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { tripProcedure } from "../auth/guards";
import { sendPushToTripMembers } from "../notifications/send";

export const photosRouter = {
  upload: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        storageKey: z.string().min(1),
        caption: z.string().max(500).optional(),
        lat: z.number().optional(),
        lng: z.number().optional(),
        takenAt: z.string().datetime().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let segmentId: string | null = null;

      if (input.takenAt) {
        const takenDate = new Date(input.takenAt).toISOString().slice(0, 10);
        const segments = await ctx.db
          .select({ id: tripSegments.id })
          .from(tripSegments)
          .where(
            and(
              eq(tripSegments.tripId, ctx.tripId),
              sql`${tripSegments.startDate} <= ${takenDate}`,
              sql`${tripSegments.endDate} >= ${takenDate}`,
            ),
          )
          .orderBy(asc(tripSegments.sortOrder))
          .limit(1);
        segmentId = segments[0]?.id ?? null;
      }

      const [created] = (await ctx.db
        .insert(tripPhotos)
        .values({
          tripId: ctx.tripId,
          segmentId,
          userId: ctx.session.user.id,
          storageKey: input.storageKey,
          caption: input.caption ?? null,
          lat: input.lat != null ? String(input.lat) : null,
          lng: input.lng != null ? String(input.lng) : null,
          takenAt: input.takenAt ? new Date(input.takenAt) : null,
        })
        .returning()) as Array<typeof tripPhotos.$inferSelect>;

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to save photo.",
        });
      }

      void sendPushToTripMembers(ctx.db, {
        tripId: ctx.tripId,
        excludeUserId: ctx.session.user.id,
        title: "New Photo",
        body: input.caption ?? "A new photo was shared",
        data: { tripId: ctx.tripId, screen: "photos" },
      });

      return created;
    }),

  list: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        segmentId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(tripPhotos.tripId, ctx.tripId)];
      if (input.segmentId) {
        conditions.push(eq(tripPhotos.segmentId, input.segmentId));
      }

      const photos = await ctx.db
        .select({
          id: tripPhotos.id,
          userId: tripPhotos.userId,
          storageKey: tripPhotos.storageKey,
          caption: tripPhotos.caption,
          lat: tripPhotos.lat,
          lng: tripPhotos.lng,
          takenAt: tripPhotos.takenAt,
          uploadedAt: tripPhotos.uploadedAt,
          segmentId: tripPhotos.segmentId,
          displayName: tripMembers.displayName,
          colorHex: tripMembers.colorHex,
        })
        .from(tripPhotos)
        .innerJoin(
          tripMembers,
          and(
            eq(tripMembers.userId, tripPhotos.userId),
            eq(tripMembers.tripId, ctx.tripId),
          ),
        )
        .where(and(...conditions))
        .orderBy(desc(tripPhotos.takenAt ?? tripPhotos.uploadedAt));

      const photoIds = photos.map((p) => p.id);
      if (photoIds.length === 0) return [];

      const reactions = await ctx.db
        .select({
          photoId: photoReactions.photoId,
          reaction: photoReactions.reaction,
          count: sql<number>`count(*)::int`,
        })
        .from(photoReactions)
        .where(
          sql`${photoReactions.photoId} IN (${sql.join(
            photoIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        )
        .groupBy(photoReactions.photoId, photoReactions.reaction);

      const myReactions = await ctx.db
        .select({
          photoId: photoReactions.photoId,
          reaction: photoReactions.reaction,
        })
        .from(photoReactions)
        .where(
          and(
            eq(photoReactions.userId, ctx.session.user.id),
            sql`${photoReactions.photoId} IN (${sql.join(
              photoIds.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          ),
        );

      const reactionMap: Record<string, Record<string, number>> = {};
      for (const r of reactions) {
        if (!reactionMap[r.photoId]) reactionMap[r.photoId] = {};
        reactionMap[r.photoId]![r.reaction] = r.count;
      }

      const myReactionMap: Record<string, string> = {};
      for (const r of myReactions) {
        myReactionMap[r.photoId] = r.reaction;
      }

      return photos.map((p) => ({
        ...p,
        reactions: reactionMap[p.id] ?? {},
        myReaction: myReactionMap[p.id] ?? null,
      }));
    }),

  react: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        photoId: z.string().uuid(),
        reaction: z.enum(["heart", "fire", "laugh", "wow", "sad"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [photo] = await ctx.db
        .select({ id: tripPhotos.id })
        .from(tripPhotos)
        .where(
          and(
            eq(tripPhotos.id, input.photoId),
            eq(tripPhotos.tripId, ctx.tripId),
          ),
        )
        .limit(1);

      if (!photo) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Photo not found." });
      }

      const existing = await ctx.db
        .select({ id: photoReactions.id, reaction: photoReactions.reaction })
        .from(photoReactions)
        .where(
          and(
            eq(photoReactions.photoId, input.photoId),
            eq(photoReactions.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      if (existing[0]?.reaction === input.reaction) {
        await ctx.db
          .delete(photoReactions)
          .where(eq(photoReactions.id, existing[0].id));
        return { toggled: "off" };
      }

      await ctx.db
        .insert(photoReactions)
        .values({
          photoId: input.photoId,
          userId: ctx.session.user.id,
          reaction: input.reaction,
        })
        .onConflictDoUpdate({
          target: [photoReactions.photoId, photoReactions.userId],
          set: { reaction: input.reaction },
        });

      return { toggled: "on" };
    }),

  delete: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        photoId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(tripPhotos)
        .where(
          and(
            eq(tripPhotos.id, input.photoId),
            eq(tripPhotos.userId, ctx.session.user.id),
          ),
        );
      return { deleted: true };
    }),
} satisfies TRPCRouterRecord;
