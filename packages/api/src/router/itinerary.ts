import { and, asc, eq } from "@sortey/db";
import { itineraryEvents } from "@sortey/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { tripProcedure } from "../auth/guards";
import { sendPushToTripMembers } from "../notifications/send";
import { validateSegmentBelongsToTrip } from "../trips/segment-guard";

export const itineraryRouter = {
  list: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
      }),
    )
    .query(async ({ ctx }) => {
      return (await ctx.db
        .select()
        .from(itineraryEvents)
        .where(eq(itineraryEvents.tripId, ctx.tripId))
        .orderBy(
          asc(itineraryEvents.startsAt),
          asc(itineraryEvents.sortOrder),
        )) as Array<typeof itineraryEvents.$inferSelect>;
    }),

  create: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        segmentId: z.string().uuid().optional(),
        title: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        category: z
          .enum([
            "meal",
            "activity",
            "transport",
            "lodging",
            "free_time",
            "meeting_point",
            "other",
          ])
          .default("other"),
        location: z.string().max(300).optional(),
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime().optional(),
        allDay: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.segmentId) {
        await validateSegmentBelongsToTrip(ctx.db, input.segmentId, ctx.tripId);
      }

      const [created] = (await ctx.db
        .insert(itineraryEvents)
        .values({
          tripId: ctx.tripId,
          segmentId: input.segmentId ?? null,
          title: input.title,
          description: input.description ?? null,
          category: input.category,
          location: input.location ?? null,
          startsAt: new Date(input.startsAt),
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
          allDay: input.allDay,
          createdByUserId: ctx.session.user.id,
        })
        .returning()) as Array<typeof itineraryEvents.$inferSelect>;

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create event.",
        });
      }

      void sendPushToTripMembers(ctx.db, {
        tripId: ctx.tripId,
        excludeUserId: ctx.session.user.id,
        title: "New Event",
        body: created.title,
        data: { tripId: ctx.tripId, screen: "itinerary" },
      });

      return created;
    }),

  delete: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        eventId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [deleted] = (await ctx.db
        .delete(itineraryEvents)
        .where(
          and(
            eq(itineraryEvents.id, input.eventId),
            eq(itineraryEvents.tripId, ctx.tripId),
          ),
        )
        .returning()) as Array<typeof itineraryEvents.$inferSelect>;

      if (!deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Event not found.",
        });
      }

      return deleted;
    }),
} satisfies TRPCRouterRecord;
