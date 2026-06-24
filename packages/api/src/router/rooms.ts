import { and, eq, inArray } from "@sortey/db";
import {
  lodgings,
  roomAssignments,
  roomOccupants,
  tripSegments,
} from "@sortey/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { tripProcedure } from "../auth/guards";

/** Verify a lodging belongs to the given trip (lodging → segment → trip). */
async function assertLodgingInTrip(
  // biome-ignore lint/suspicious/noExplicitAny: ctx.db type is internal to trpc
  db: any,
  lodgingId: string,
  tripId: string,
): Promise<void> {
  const [row] = (await db
    .select({ segmentId: lodgings.segmentId })
    .from(lodgings)
    .where(eq(lodgings.id, lodgingId))
    .limit(1)) as Array<{ segmentId: string }>;

  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Lodging not found." });
  }

  const [seg] = (await db
    .select({ id: tripSegments.id })
    .from(tripSegments)
    .where(
      and(eq(tripSegments.id, row.segmentId), eq(tripSegments.tripId, tripId)),
    )
    .limit(1)) as Array<{ id: string }>;

  if (!seg) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Lodging does not belong to this trip.",
    });
  }
}

/** Verify a room belongs to the given trip (room → lodging → segment → trip). */
async function assertRoomInTrip(
  // biome-ignore lint/suspicious/noExplicitAny: ctx.db type is internal to trpc
  db: any,
  roomId: string,
  tripId: string,
): Promise<{ lodgingId: string }> {
  const [room] = (await db
    .select({ id: roomAssignments.id, lodgingId: roomAssignments.lodgingId })
    .from(roomAssignments)
    .where(eq(roomAssignments.id, roomId))
    .limit(1)) as Array<{ id: string; lodgingId: string }>;

  if (!room) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Room not found." });
  }

  await assertLodgingInTrip(db, room.lodgingId, tripId);
  return { lodgingId: room.lodgingId };
}

export const roomsRouter = {
  /** List rooms for a lodging with their occupants. */
  listForLodging: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        lodgingId: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertLodgingInTrip(ctx.db, input.lodgingId, ctx.tripId);

      const rooms = (await ctx.db
        .select()
        .from(roomAssignments)
        .where(eq(roomAssignments.lodgingId, input.lodgingId))
        .orderBy(roomAssignments.sortOrder)) as Array<
        typeof roomAssignments.$inferSelect
      >;

      const roomIds = rooms.map((r) => r.id);
      const occupants =
        roomIds.length > 0
          ? ((await ctx.db
              .select()
              .from(roomOccupants)
              .where(
                inArray(roomOccupants.roomAssignmentId, roomIds),
              )) as Array<typeof roomOccupants.$inferSelect>)
          : [];

      return rooms.map((room) => ({
        ...room,
        occupants: occupants
          .filter((o) => o.roomAssignmentId === room.id)
          .map((o) => ({ userId: o.userId })),
      }));
    }),

  createRoom: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        lodgingId: z.string().min(1),
        roomLabel: z.string().min(1).max(120),
        sortOrder: z.number().int().min(0).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertLodgingInTrip(ctx.db, input.lodgingId, ctx.tripId);

      const [created] = (await ctx.db
        .insert(roomAssignments)
        .values({
          lodgingId: input.lodgingId,
          roomLabel: input.roomLabel,
          sortOrder: input.sortOrder ?? 0,
        })
        .returning()) as Array<typeof roomAssignments.$inferSelect>;

      return created!;
    }),

  deleteRoom: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        roomId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertRoomInTrip(ctx.db, input.roomId, ctx.tripId);
      await ctx.db
        .delete(roomAssignments)
        .where(eq(roomAssignments.id, input.roomId));
      return { ok: true };
    }),

  assignOccupant: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        roomId: z.string().min(1),
        userId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertRoomInTrip(ctx.db, input.roomId, ctx.tripId);
      // Idempotent: the unique(room, user) constraint backs onConflictDoNothing.
      await ctx.db
        .insert(roomOccupants)
        .values({ roomAssignmentId: input.roomId, userId: input.userId })
        .onConflictDoNothing();
      return { ok: true };
    }),

  removeOccupant: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        roomId: z.string().min(1),
        userId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertRoomInTrip(ctx.db, input.roomId, ctx.tripId);
      await ctx.db
        .delete(roomOccupants)
        .where(
          and(
            eq(roomOccupants.roomAssignmentId, input.roomId),
            eq(roomOccupants.userId, input.userId),
          ),
        );
      return { ok: true };
    }),
} satisfies TRPCRouterRecord;
