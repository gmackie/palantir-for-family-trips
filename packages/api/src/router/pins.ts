import { and, asc, eq, sql } from "@gmacko/db";
import {
  pinAttendees,
  pins,
  tripMembers,
  tripSegments,
} from "@gmacko/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { tripProcedure } from "../auth/guards";

const pinTypeSchema = z.enum([
  "lodging",
  "activity",
  "meal",
  "transit",
  "drinks",
  "tickets",
  "custom",
]);

/** Lock TTL in milliseconds (15 seconds). */
const LOCK_TTL_MS = 15_000;

export const pinsRouter = {
  /**
   * List pins for a trip, optionally filtered by segmentId and/or type.
   * Includes attendee counts.
   */
  list: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        segmentId: z.string().min(1).optional(),
        type: pinTypeSchema.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(pins.tripId, ctx.tripId)];
      if (input.segmentId) {
        conditions.push(eq(pins.segmentId, input.segmentId));
      }
      if (input.type) {
        conditions.push(eq(pins.type, input.type));
      }

      const rows = (await ctx.db
        .select()
        .from(pins)
        .where(and(...conditions))
        .orderBy(asc(pins.startsAt), asc(pins.createdAt))) as Array<
        typeof pins.$inferSelect
      >;

      // Batch-load attendee counts
      const pinIds = rows.map((r) => r.id);
      const attendeeCounts = new Map<string, number>();

      if (pinIds.length > 0) {
        for (const pin of rows) {
          const countResult = (await ctx.db
            .select({ count: sql<number>`count(*)::int` })
            .from(pinAttendees)
            .where(eq(pinAttendees.pinId, pin.id))) as Array<{
            count: number;
          }>;
          attendeeCounts.set(pin.id, countResult[0]?.count ?? 0);
        }
      }

      return rows.map((pin) => ({
        ...pin,
        attendeeCount: attendeeCounts.get(pin.id) ?? 0,
      }));
    }),

  /**
   * Create a new pin on the map.
   */
  create: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        segmentId: z.string().min(1),
        title: z.string().min(1).max(200),
        type: pinTypeSchema,
        lat: z.string(),
        lng: z.string(),
        startsAt: z.string().datetime().optional(),
        endsAt: z.string().datetime().optional(),
        notes: z.string().max(2000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify segment belongs to trip
      const [segment] = (await ctx.db
        .select({ id: tripSegments.id })
        .from(tripSegments)
        .where(
          and(
            eq(tripSegments.id, input.segmentId),
            eq(tripSegments.tripId, ctx.tripId),
          ),
        )
        .limit(1)) as Array<{ id: string }>;

      if (!segment) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Segment does not belong to this trip.",
        });
      }

      const [created] = (await ctx.db
        .insert(pins)
        .values({
          tripId: ctx.tripId,
          segmentId: input.segmentId,
          type: input.type,
          title: input.title,
          lat: input.lat,
          lng: input.lng,
          startsAt: input.startsAt ? new Date(input.startsAt) : null,
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
          notes: input.notes ?? null,
          createdByUserId: ctx.session.user.id,
        })
        .returning()) as Array<typeof pins.$inferSelect>;

      return created!;
    }),

  /**
   * Update a pin. Rejects if edit-locked by another user whose lock hasn't expired.
   */
  update: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        pinId: z.string().min(1),
        title: z.string().min(1).max(200).optional(),
        type: pinTypeSchema.optional(),
        lat: z.string().optional(),
        lng: z.string().optional(),
        startsAt: z.string().datetime().nullish(),
        endsAt: z.string().datetime().nullish(),
        notes: z.string().max(2000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = (await ctx.db
        .select()
        .from(pins)
        .where(and(eq(pins.id, input.pinId), eq(pins.tripId, ctx.tripId)))
        .limit(1)) as Array<typeof pins.$inferSelect>;

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pin not found." });
      }

      // Check edit lock
      if (
        existing.editLockedByUserId &&
        existing.editLockedByUserId !== ctx.session.user.id &&
        existing.editLockedUntil &&
        new Date(existing.editLockedUntil).getTime() > Date.now()
      ) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Pin is currently being edited by another user.",
        });
      }

      const updates: Record<string, unknown> = {};
      if (input.title !== undefined) updates.title = input.title;
      if (input.type !== undefined) updates.type = input.type;
      if (input.lat !== undefined) updates.lat = input.lat;
      if (input.lng !== undefined) updates.lng = input.lng;
      if (input.startsAt !== undefined)
        updates.startsAt = input.startsAt ? new Date(input.startsAt) : null;
      if (input.endsAt !== undefined)
        updates.endsAt = input.endsAt ? new Date(input.endsAt) : null;
      if (input.notes !== undefined) updates.notes = input.notes ?? null;

      if (Object.keys(updates).length === 0) {
        return existing;
      }

      const [updated] = (await ctx.db
        .update(pins)
        .set(updates)
        .where(eq(pins.id, input.pinId))
        .returning()) as Array<typeof pins.$inferSelect>;

      return updated!;
    }),

  /**
   * Delete a pin. Only organizer or creator may delete.
   */
  delete: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        pinId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = (await ctx.db
        .select()
        .from(pins)
        .where(and(eq(pins.id, input.pinId), eq(pins.tripId, ctx.tripId)))
        .limit(1)) as Array<typeof pins.$inferSelect>;

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pin not found." });
      }

      if (
        ctx.tripRole !== "organizer" &&
        existing.createdByUserId !== ctx.session.user.id
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the creator or a trip organizer can delete this pin.",
        });
      }

      await ctx.db.delete(pins).where(eq(pins.id, input.pinId));

      return { deleted: true };
    }),

  /**
   * Replace attendees for a pin (transactional).
   */
  setAttendees: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        pinId: z.string().min(1),
        userIds: z.array(z.string().min(1)),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify pin belongs to trip
      const [existing] = (await ctx.db
        .select({ id: pins.id })
        .from(pins)
        .where(and(eq(pins.id, input.pinId), eq(pins.tripId, ctx.tripId)))
        .limit(1)) as Array<{ id: string }>;

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pin not found." });
      }

      // Verify all userIds are trip members
      if (input.userIds.length > 0) {
        const members = (await ctx.db
          .select({ userId: tripMembers.userId })
          .from(tripMembers)
          .where(eq(tripMembers.tripId, ctx.tripId))) as Array<{
          userId: string;
        }>;
        const memberIds = new Set(members.map((m) => m.userId));
        for (const uid of input.userIds) {
          if (!memberIds.has(uid)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `User ${uid} is not a member of this trip.`,
            });
          }
        }
      }

      // Replace: delete all, then insert
      await ctx.db
        .delete(pinAttendees)
        .where(eq(pinAttendees.pinId, input.pinId));

      if (input.userIds.length > 0) {
        await ctx.db.insert(pinAttendees).values(
          input.userIds.map((userId) => ({
            pinId: input.pinId,
            userId,
          })),
        );
      }

      return { pinId: input.pinId, attendeeCount: input.userIds.length };
    }),

  /**
   * Acquire an edit lock on a pin. Steals if the existing lock is expired.
   */
  acquireEditLock: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        pinId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = (await ctx.db
        .select()
        .from(pins)
        .where(and(eq(pins.id, input.pinId), eq(pins.tripId, ctx.tripId)))
        .limit(1)) as Array<typeof pins.$inferSelect>;

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pin not found." });
      }

      // If locked by someone else and not expired, reject
      if (
        existing.editLockedByUserId &&
        existing.editLockedByUserId !== ctx.session.user.id &&
        existing.editLockedUntil &&
        new Date(existing.editLockedUntil).getTime() > Date.now()
      ) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Pin is currently locked by another user.",
        });
      }

      const lockUntil = new Date(Date.now() + LOCK_TTL_MS);

      const [updated] = (await ctx.db
        .update(pins)
        .set({
          editLockedByUserId: ctx.session.user.id,
          editLockedUntil: lockUntil,
        })
        .where(eq(pins.id, input.pinId))
        .returning()) as Array<typeof pins.$inferSelect>;

      return updated!;
    }),

  /**
   * Release an edit lock. Only clears if held by the current user.
   */
  releaseEditLock: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        pinId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = (await ctx.db
        .select()
        .from(pins)
        .where(and(eq(pins.id, input.pinId), eq(pins.tripId, ctx.tripId)))
        .limit(1)) as Array<typeof pins.$inferSelect>;

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pin not found." });
      }

      if (existing.editLockedByUserId !== ctx.session.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not hold the lock on this pin.",
        });
      }

      const [updated] = (await ctx.db
        .update(pins)
        .set({
          editLockedByUserId: null,
          editLockedUntil: null,
        })
        .where(eq(pins.id, input.pinId))
        .returning()) as Array<typeof pins.$inferSelect>;

      return updated!;
    }),

  /**
   * List pins sorted by startsAt for Gantt/timeline rendering, with attendee lists.
   */
  listForTimeline: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
      }),
    )
    .query(async ({ ctx }) => {
      const rows = (await ctx.db
        .select()
        .from(pins)
        .where(eq(pins.tripId, ctx.tripId))
        .orderBy(asc(pins.startsAt), asc(pins.createdAt))) as Array<
        typeof pins.$inferSelect
      >;

      // Load attendees for each pin
      const result = [];
      for (const pin of rows) {
        const attendees = (await ctx.db
          .select({ userId: pinAttendees.userId })
          .from(pinAttendees)
          .where(eq(pinAttendees.pinId, pin.id))) as Array<{
          userId: string;
        }>;
        result.push({
          ...pin,
          attendees: attendees.map((a) => a.userId),
        });
      }

      return result;
    }),
} satisfies TRPCRouterRecord;
