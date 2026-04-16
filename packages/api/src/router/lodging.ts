import { and, asc, eq, sql } from "@gmacko/db";
import {
  groundTransportGroups,
  groundTransportMembers,
  lodgingGuests,
  lodgings,
  memberTransits,
  tripSegments,
} from "@gmacko/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { tripProcedure } from "../auth/guards";

const lodgingProviderSchema = z.enum([
  "airbnb",
  "vrbo",
  "hotel",
  "hostel",
  "other",
]);

const lodgingSourceTypeSchema = z.enum([
  "manual",
  "email_parsed",
  "api_imported",
  "link_parsed",
]);

const transitDirectionSchema = z.enum(["arrival", "departure"]);

const transitTypeSchema = z.enum(["flight", "train", "bus", "car", "other"]);

const trackingStatusSchema = z.enum([
  "scheduled",
  "en_route",
  "delayed",
  "arrived",
  "cancelled",
]);

const groundTransportTypeSchema = z.enum([
  "rental_car",
  "taxi",
  "rideshare",
  "shuttle",
  "public_transit",
]);

const coordinateSchema = z
  .union([z.string(), z.number()])
  .transform((v) => String(v));

const tripScopedInput = z.object({
  workspaceId: z.string().min(1),
  tripId: z.string().min(1),
});

async function validateSegmentBelongsToTrip(
  db: any,
  segmentId: string,
  tripId: string,
) {
  const [segment] = (await db
    .select({ id: tripSegments.id })
    .from(tripSegments)
    .where(
      and(eq(tripSegments.id, segmentId), eq(tripSegments.tripId, tripId)),
    )
    .limit(1)) as { id: string }[];

  if (!segment) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Segment does not belong to this trip.",
    });
  }
}

export const lodgingRouter = {
  // ── Lodging ──────────────────────────────────────────

  createLodging: tripProcedure()
    .input(
      tripScopedInput.extend({
        segmentId: z.string().min(1),
        provider: lodgingProviderSchema.optional(),
        propertyName: z.string().min(1).max(200),
        address: z.string().optional(),
        lat: coordinateSchema.optional(),
        lng: coordinateSchema.optional(),
        checkInAt: z.coerce.date(),
        checkOutAt: z.coerce.date(),
        checkInInstructions: z.string().optional(),
        confirmationNumber: z.string().max(100).optional(),
        bookingUrl: z.string().optional(),
        nightlyRateCents: z.number().int().optional(),
        totalCostCents: z.number().int().optional(),
        currency: z.string().max(8).default("USD"),
        hostName: z.string().max(120).optional(),
        hostPhone: z.string().max(30).optional(),
        notes: z.string().optional(),
        sourceType: lodgingSourceTypeSchema.default("manual"),
        sourceRaw: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await validateSegmentBelongsToTrip(ctx.db, input.segmentId, ctx.tripId);

      const [created] = (await ctx.db
        .insert(lodgings)
        .values({
          segmentId: input.segmentId,
          createdByUserId: ctx.session.user.id,
          provider: input.provider ?? null,
          propertyName: input.propertyName,
          address: input.address ?? null,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
          checkInAt: input.checkInAt,
          checkOutAt: input.checkOutAt,
          checkInInstructions: input.checkInInstructions ?? null,
          confirmationNumber: input.confirmationNumber ?? null,
          bookingUrl: input.bookingUrl ?? null,
          nightlyRateCents: input.nightlyRateCents ?? null,
          totalCostCents: input.totalCostCents ?? null,
          currency: input.currency,
          hostName: input.hostName ?? null,
          hostPhone: input.hostPhone ?? null,
          notes: input.notes ?? null,
          sourceType: input.sourceType,
          sourceRaw: input.sourceRaw ?? null,
        })
        .returning()) as (typeof lodgings.$inferSelect)[];

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create lodging.",
        });
      }

      return created;
    }),

  updateLodging: tripProcedure()
    .input(
      tripScopedInput.extend({
        lodgingId: z.string().min(1),
        provider: lodgingProviderSchema.optional(),
        propertyName: z.string().min(1).max(200).optional(),
        address: z.string().nullable().optional(),
        lat: coordinateSchema.nullable().optional(),
        lng: coordinateSchema.nullable().optional(),
        checkInAt: z.coerce.date().optional(),
        checkOutAt: z.coerce.date().optional(),
        checkInInstructions: z.string().nullable().optional(),
        confirmationNumber: z.string().max(100).nullable().optional(),
        bookingUrl: z.string().nullable().optional(),
        nightlyRateCents: z.number().int().nullable().optional(),
        totalCostCents: z.number().int().nullable().optional(),
        currency: z.string().max(8).optional(),
        hostName: z.string().max(120).nullable().optional(),
        hostPhone: z.string().max(30).nullable().optional(),
        notes: z.string().nullable().optional(),
        sourceType: lodgingSourceTypeSchema.optional(),
        sourceRaw: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { lodgingId, workspaceId, tripId, ...changes } = input;

      const [updated] = (await ctx.db
        .update(lodgings)
        .set(changes)
        .where(eq(lodgings.id, lodgingId))
        .returning()) as (typeof lodgings.$inferSelect)[];

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Lodging not found.",
        });
      }

      return updated;
    }),

  listForSegment: tripProcedure()
    .input(
      tripScopedInput.extend({
        segmentId: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      await validateSegmentBelongsToTrip(ctx.db, input.segmentId, ctx.tripId);

      const rows = (await ctx.db
        .select({
          id: lodgings.id,
          segmentId: lodgings.segmentId,
          provider: lodgings.provider,
          propertyName: lodgings.propertyName,
          address: lodgings.address,
          checkInAt: lodgings.checkInAt,
          checkOutAt: lodgings.checkOutAt,
          confirmationNumber: lodgings.confirmationNumber,
          totalCostCents: lodgings.totalCostCents,
          currency: lodgings.currency,
          notes: lodgings.notes,
          guestCount: sql<number>`(
            select count(*)::int from lodging_guest
            where lodging_guest.lodging_id = ${lodgings.id}
          )`,
        })
        .from(lodgings)
        .where(eq(lodgings.segmentId, input.segmentId))
        .orderBy(asc(lodgings.checkInAt))) as Array<{
        id: string;
        segmentId: string;
        provider: string | null;
        propertyName: string;
        address: string | null;
        checkInAt: Date;
        checkOutAt: Date;
        confirmationNumber: string | null;
        totalCostCents: number | null;
        currency: string;
        notes: string | null;
        guestCount: number;
      }>;

      return rows;
    }),

  setGuests: tripProcedure()
    .input(
      tripScopedInput.extend({
        lodgingId: z.string().min(1),
        userIds: z.array(z.string().min(1)),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // biome-ignore lint/suspicious/noExplicitAny: Drizzle tx type is complex
      await ctx.db.transaction(async (tx: any) => {
        await tx
          .delete(lodgingGuests)
          .where(eq(lodgingGuests.lodgingId, input.lodgingId));

        if (input.userIds.length > 0) {
          await tx.insert(lodgingGuests).values(
            input.userIds.map((userId) => ({
              lodgingId: input.lodgingId,
              userId,
            })),
          );
        }
      });

      return { success: true };
    }),

  deleteLodging: tripProcedure()
    .input(
      tripScopedInput.extend({
        lodgingId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Only organizer or creator can delete
      const [existing] = (await ctx.db
        .select({
          id: lodgings.id,
          createdByUserId: lodgings.createdByUserId,
        })
        .from(lodgings)
        .where(eq(lodgings.id, input.lodgingId))
        .limit(1)) as { id: string; createdByUserId: string | null }[];

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Lodging not found.",
        });
      }

      if (
        ctx.tripRole !== "organizer" &&
        existing.createdByUserId !== ctx.session.user.id
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the creator or an organizer can delete this lodging.",
        });
      }

      await ctx.db.delete(lodgings).where(eq(lodgings.id, input.lodgingId));

      return { success: true };
    }),

  // ── Member Transits (Arrivals / Departures) ──────────

  createTransit: tripProcedure()
    .input(
      tripScopedInput.extend({
        segmentId: z.string().min(1),
        userId: z.string().min(1),
        direction: transitDirectionSchema.optional(),
        transitType: transitTypeSchema.optional(),
        carrier: z.string().max(100).optional(),
        transitNumber: z.string().max(50).optional(),
        departureStation: z.string().max(200).optional(),
        arrivalStation: z.string().max(200).optional(),
        scheduledAt: z.coerce.date(),
        estimatedAt: z.coerce.date().optional(),
        actualAt: z.coerce.date().optional(),
        trackingStatus: trackingStatusSchema.default("scheduled"),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await validateSegmentBelongsToTrip(ctx.db, input.segmentId, ctx.tripId);

      // Non-organizers can only add transits for themselves
      if (
        ctx.tripRole !== "organizer" &&
        input.userId !== ctx.session.user.id
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Only organizers can add transits for other members.",
        });
      }

      const [created] = (await ctx.db
        .insert(memberTransits)
        .values({
          segmentId: input.segmentId,
          userId: input.userId,
          direction: input.direction ?? null,
          transitType: input.transitType ?? null,
          carrier: input.carrier ?? null,
          transitNumber: input.transitNumber ?? null,
          departureStation: input.departureStation ?? null,
          arrivalStation: input.arrivalStation ?? null,
          scheduledAt: input.scheduledAt,
          estimatedAt: input.estimatedAt ?? null,
          actualAt: input.actualAt ?? null,
          trackingStatus: input.trackingStatus,
          notes: input.notes ?? null,
        })
        .returning()) as (typeof memberTransits.$inferSelect)[];

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create transit.",
        });
      }

      return created;
    }),

  updateTransit: tripProcedure()
    .input(
      tripScopedInput.extend({
        transitId: z.string().min(1),
        direction: transitDirectionSchema.optional(),
        transitType: transitTypeSchema.optional(),
        carrier: z.string().max(100).nullable().optional(),
        transitNumber: z.string().max(50).nullable().optional(),
        departureStation: z.string().max(200).nullable().optional(),
        arrivalStation: z.string().max(200).nullable().optional(),
        scheduledAt: z.coerce.date().optional(),
        estimatedAt: z.coerce.date().nullable().optional(),
        actualAt: z.coerce.date().nullable().optional(),
        trackingStatus: trackingStatusSchema.optional(),
        notes: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { transitId, workspaceId, tripId, ...changes } = input;

      const [updated] = (await ctx.db
        .update(memberTransits)
        .set(changes)
        .where(eq(memberTransits.id, transitId))
        .returning()) as (typeof memberTransits.$inferSelect)[];

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Transit not found.",
        });
      }

      return updated;
    }),

  listTransitsForSegment: tripProcedure()
    .input(
      tripScopedInput.extend({
        segmentId: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      await validateSegmentBelongsToTrip(ctx.db, input.segmentId, ctx.tripId);

      const rows = (await ctx.db
        .select()
        .from(memberTransits)
        .where(eq(memberTransits.segmentId, input.segmentId))
        .orderBy(asc(memberTransits.scheduledAt))) as (typeof memberTransits.$inferSelect)[];

      return rows;
    }),

  // ── Ground Transport Groups ──────────────────────────

  createTransportGroup: tripProcedure()
    .input(
      tripScopedInput.extend({
        segmentId: z.string().min(1),
        transportType: groundTransportTypeSchema.optional(),
        label: z.string().min(1).max(200),
        fromDescription: z.string().optional(),
        toDescription: z.string().optional(),
        scheduledAt: z.coerce.date().optional(),
        costCents: z.number().int().optional(),
        currency: z.string().max(8).default("USD"),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await validateSegmentBelongsToTrip(ctx.db, input.segmentId, ctx.tripId);

      const [created] = (await ctx.db
        .insert(groundTransportGroups)
        .values({
          segmentId: input.segmentId,
          createdByUserId: ctx.session.user.id,
          transportType: input.transportType ?? null,
          label: input.label,
          fromDescription: input.fromDescription ?? null,
          toDescription: input.toDescription ?? null,
          scheduledAt: input.scheduledAt ?? null,
          costCents: input.costCents ?? null,
          currency: input.currency,
          notes: input.notes ?? null,
        })
        .returning()) as (typeof groundTransportGroups.$inferSelect)[];

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create transport group.",
        });
      }

      return created;
    }),

  joinTransportGroup: tripProcedure()
    .input(
      tripScopedInput.extend({
        groundTransportGroupId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(groundTransportMembers)
        .values({
          groundTransportGroupId: input.groundTransportGroupId,
          userId: ctx.session.user.id,
        })
        .onConflictDoNothing();

      return { success: true };
    }),

  leaveTransportGroup: tripProcedure()
    .input(
      tripScopedInput.extend({
        groundTransportGroupId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(groundTransportMembers)
        .where(
          and(
            eq(
              groundTransportMembers.groundTransportGroupId,
              input.groundTransportGroupId,
            ),
            eq(groundTransportMembers.userId, ctx.session.user.id),
          ),
        );

      return { success: true };
    }),

  listTransportGroups: tripProcedure()
    .input(
      tripScopedInput.extend({
        segmentId: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      await validateSegmentBelongsToTrip(ctx.db, input.segmentId, ctx.tripId);

      const groups = (await ctx.db
        .select()
        .from(groundTransportGroups)
        .where(eq(groundTransportGroups.segmentId, input.segmentId))
        .orderBy(asc(groundTransportGroups.scheduledAt))) as (typeof groundTransportGroups.$inferSelect)[];

      const members = (await ctx.db
        .select()
        .from(groundTransportMembers)) as (typeof groundTransportMembers.$inferSelect)[];

      const groupIds = new Set(groups.map((g) => g.id));

      return groups.map((group) => ({
        ...group,
        members: members
          .filter(
            (m) =>
              m.groundTransportGroupId === group.id &&
              groupIds.has(m.groundTransportGroupId),
          )
          .map((m) => ({ id: m.id, userId: m.userId })),
      }));
    }),
} satisfies TRPCRouterRecord;
