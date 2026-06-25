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

export type RoomRow = typeof roomAssignments.$inferSelect;
export type RoomOccupantRow = typeof roomOccupants.$inferSelect;

export type RoomWithOccupants = RoomRow & {
  occupants: Array<{ userId: string }>;
};

export interface RoomStore {
  /** The segment a lodging hangs off of (lodging → segment), or null if the lodging is gone. */
  getLodgingSegment(lodgingId: string): Promise<{ segmentId: string } | null>;
  /** True when the segment exists AND belongs to `tripId` (segment → trip). */
  segmentBelongsToTrip(input: {
    segmentId: string;
    tripId: string;
  }): Promise<boolean>;
  /** The lodging a room hangs off of (room → lodging), or null if the room is gone. */
  getRoomLodging(roomId: string): Promise<{ lodgingId: string } | null>;
  listRoomsForLodging(lodgingId: string): Promise<RoomRow[]>;
  listOccupants(roomIds: string[]): Promise<RoomOccupantRow[]>;
  insertRoom(input: {
    lodgingId: string;
    roomLabel: string;
    sortOrder: number;
  }): Promise<RoomRow>;
  deleteRoom(roomId: string): Promise<void>;
  /** Idempotent: assigning the same (room, user) twice does not duplicate. */
  insertOccupant(roomId: string, userId: string): Promise<void>;
  removeOccupant(roomId: string, userId: string): Promise<void>;
}

// ── Authorization guards (store-backed, DB-agnostic) ─────────────────────────

/** Verify a lodging belongs to the given trip (lodging → segment → trip). */
export async function assertLodgingInTrip(
  store: RoomStore,
  lodgingId: string,
  tripId: string,
): Promise<void> {
  const lodging = await store.getLodgingSegment(lodgingId);
  if (!lodging) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Lodging not found." });
  }

  const belongs = await store.segmentBelongsToTrip({
    segmentId: lodging.segmentId,
    tripId,
  });
  if (!belongs) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Lodging does not belong to this trip.",
    });
  }
}

/** Verify a room belongs to the given trip (room → lodging → segment → trip). */
export async function assertRoomInTrip(
  store: RoomStore,
  roomId: string,
  tripId: string,
): Promise<{ lodgingId: string }> {
  const room = await store.getRoomLodging(roomId);
  if (!room) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Room not found." });
  }

  await assertLodgingInTrip(store, room.lodgingId, tripId);
  return { lodgingId: room.lodgingId };
}

// ── Orchestration (store-backed, DB-agnostic) ────────────────────────────────

/** List a lodging's rooms with their occupants grouped, ordered by sortOrder. */
export async function listRoomsWithOccupants(
  store: RoomStore,
  input: { tripId: string; lodgingId: string },
): Promise<RoomWithOccupants[]> {
  await assertLodgingInTrip(store, input.lodgingId, input.tripId);

  const rooms = [...(await store.listRoomsForLodging(input.lodgingId))].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );

  const roomIds = rooms.map((r) => r.id);
  const occupants =
    roomIds.length > 0 ? await store.listOccupants(roomIds) : [];

  return rooms.map((room) => ({
    ...room,
    occupants: occupants
      .filter((o) => o.roomAssignmentId === room.id)
      .map((o) => ({ userId: o.userId })),
  }));
}

export async function createRoom(
  store: RoomStore,
  input: {
    tripId: string;
    lodgingId: string;
    roomLabel: string;
    sortOrder?: number;
  },
): Promise<RoomRow> {
  await assertLodgingInTrip(store, input.lodgingId, input.tripId);

  return store.insertRoom({
    lodgingId: input.lodgingId,
    roomLabel: input.roomLabel,
    sortOrder: input.sortOrder ?? 0,
  });
}

export async function deleteRoom(
  store: RoomStore,
  input: { tripId: string; roomId: string },
): Promise<{ ok: true }> {
  await assertRoomInTrip(store, input.roomId, input.tripId);
  await store.deleteRoom(input.roomId);
  return { ok: true };
}

export async function assignOccupant(
  store: RoomStore,
  input: { tripId: string; roomId: string; userId: string },
): Promise<{ ok: true }> {
  await assertRoomInTrip(store, input.roomId, input.tripId);
  // Idempotent: the unique(room, user) constraint backs onConflictDoNothing.
  await store.insertOccupant(input.roomId, input.userId);
  return { ok: true };
}

export async function removeOccupant(
  store: RoomStore,
  input: { tripId: string; roomId: string; userId: string },
): Promise<{ ok: true }> {
  await assertRoomInTrip(store, input.roomId, input.tripId);
  await store.removeOccupant(input.roomId, input.userId);
  return { ok: true };
}

// ── Real DB-backed store ─────────────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: Drizzle db type is complex
function createRoomStore(db: any): RoomStore {
  return {
    getLodgingSegment: async (lodgingId) => {
      const [row] = (await db
        .select({ segmentId: lodgings.segmentId })
        .from(lodgings)
        .where(eq(lodgings.id, lodgingId))
        .limit(1)) as Array<{ segmentId: string }>;
      return row ?? null;
    },
    segmentBelongsToTrip: async ({ segmentId, tripId }) => {
      const [seg] = (await db
        .select({ id: tripSegments.id })
        .from(tripSegments)
        .where(
          and(eq(tripSegments.id, segmentId), eq(tripSegments.tripId, tripId)),
        )
        .limit(1)) as Array<{ id: string }>;
      return seg != null;
    },
    getRoomLodging: async (roomId) => {
      const [room] = (await db
        .select({ lodgingId: roomAssignments.lodgingId })
        .from(roomAssignments)
        .where(eq(roomAssignments.id, roomId))
        .limit(1)) as Array<{ lodgingId: string }>;
      return room ?? null;
    },
    listRoomsForLodging: async (lodgingId) =>
      (await db
        .select()
        .from(roomAssignments)
        .where(eq(roomAssignments.lodgingId, lodgingId))
        .orderBy(roomAssignments.sortOrder)) as RoomRow[],
    listOccupants: async (roomIds) =>
      (await db
        .select()
        .from(roomOccupants)
        .where(
          inArray(roomOccupants.roomAssignmentId, roomIds),
        )) as RoomOccupantRow[],
    insertRoom: async ({ lodgingId, roomLabel, sortOrder }) => {
      const [created] = (await db
        .insert(roomAssignments)
        .values({ lodgingId, roomLabel, sortOrder })
        .returning()) as RoomRow[];
      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create room.",
        });
      }
      return created;
    },
    deleteRoom: async (roomId) => {
      await db.delete(roomAssignments).where(eq(roomAssignments.id, roomId));
    },
    insertOccupant: async (roomId, userId) => {
      await db
        .insert(roomOccupants)
        .values({ roomAssignmentId: roomId, userId })
        .onConflictDoNothing();
    },
    removeOccupant: async (roomId, userId) => {
      await db
        .delete(roomOccupants)
        .where(
          and(
            eq(roomOccupants.roomAssignmentId, roomId),
            eq(roomOccupants.userId, userId),
          ),
        );
    },
  };
}

// ── tRPC router ──────────────────────────────────────────────────────────────

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
    .query(({ ctx, input }) =>
      listRoomsWithOccupants(createRoomStore(ctx.db), {
        tripId: ctx.tripId,
        lodgingId: input.lodgingId,
      }),
    ),

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
    .mutation(({ ctx, input }) =>
      createRoom(createRoomStore(ctx.db), {
        tripId: ctx.tripId,
        lodgingId: input.lodgingId,
        roomLabel: input.roomLabel,
        sortOrder: input.sortOrder,
      }),
    ),

  deleteRoom: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        roomId: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      deleteRoom(createRoomStore(ctx.db), {
        tripId: ctx.tripId,
        roomId: input.roomId,
      }),
    ),

  assignOccupant: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        roomId: z.string().min(1),
        userId: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      assignOccupant(createRoomStore(ctx.db), {
        tripId: ctx.tripId,
        roomId: input.roomId,
        userId: input.userId,
      }),
    ),

  removeOccupant: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        roomId: z.string().min(1),
        userId: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      removeOccupant(createRoomStore(ctx.db), {
        tripId: ctx.tripId,
        roomId: input.roomId,
        userId: input.userId,
      }),
    ),
} satisfies TRPCRouterRecord;
