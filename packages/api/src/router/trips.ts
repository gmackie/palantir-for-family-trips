import { asc, desc, eq } from "@gmacko/db";
import {
  segmentMembers,
  tripMembers,
  tripSegments,
  trips,
} from "@gmacko/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { tripProcedure, workspaceProcedure } from "../auth/guards";

const tripDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const coordinateSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value));

const tripSummaryShape = {
  id: trips.id,
  workspaceId: trips.workspaceId,
  name: trips.name,
  createdByUserId: trips.createdByUserId,
  status: trips.status,
  groupMode: trips.groupMode,
  claimMode: trips.claimMode,
  destinationName: trips.destinationName,
  destinationLat: trips.destinationLat,
  destinationLng: trips.destinationLng,
  defaultZoom: trips.defaultZoom,
  startDate: trips.startDate,
  endDate: trips.endDate,
  tz: trips.tz,
  createdAt: trips.createdAt,
  updatedAt: trips.updatedAt,
} as const;

export type TripSummary = {
  id: string;
  workspaceId: string;
  name: string;
  createdByUserId: string;
  status: "planning" | "confirmed" | "active" | "completed";
  groupMode: boolean;
  claimMode: "organizer" | "tap";
  destinationName: string | null;
  destinationLat: string | null;
  destinationLng: string | null;
  defaultZoom: number;
  startDate: string | null;
  endDate: string | null;
  tz: string;
  createdAt: Date;
  updatedAt: Date | null;
};

export type TripMemberSummary = {
  id: string;
  tripId: string;
  userId: string;
  role: "organizer" | "member";
};

export type TripSegmentSummary = {
  id: string;
  tripId: string;
  name: string;
  destinationName: string | null;
  destinationLat: string | null;
  destinationLng: string | null;
  defaultZoom: number;
  startDate: string | null;
  endDate: string | null;
  tz: string;
  sortOrder: number;
};

export type SegmentMemberSummary = {
  id: string;
  segmentId: string;
  userId: string;
};

export interface TripStore {
  createTrip(input: {
    workspaceId: string;
    createdByUserId: string;
    name: string;
    destinationName?: string;
    destinationLat?: string;
    destinationLng?: string;
    startDate?: string;
    endDate?: string;
    tz?: string;
    groupMode?: boolean;
  }): Promise<TripSummary>;
  createTripMember(input: {
    tripId: string;
    userId: string;
    role: "organizer" | "member";
  }): Promise<TripMemberSummary>;
  createTripSegment(input: {
    tripId: string;
    name: string;
    destinationName?: string;
    destinationLat?: string;
    destinationLng?: string;
    startDate?: string;
    endDate?: string;
    tz?: string;
    sortOrder: number;
  }): Promise<TripSegmentSummary>;
  createSegmentMember(input: {
    segmentId: string;
    userId: string;
  }): Promise<SegmentMemberSummary>;
  listWorkspaceTrips(input: {
    userId: string;
    workspaceId: string;
  }): Promise<TripSummary[]>;
  getTrip(input: {
    workspaceId: string;
    tripId: string;
  }): Promise<TripSummary | null>;
}

export async function createTripRecord(
  store: TripStore,
  input: {
    workspaceId: string;
    createdByUserId: string;
    name: string;
    destinationName?: string;
    destinationLat?: string;
    destinationLng?: string;
    startDate?: string;
    endDate?: string;
    tz?: string;
    groupMode?: boolean;
  },
) {
  const trip = await store.createTrip(input);
  const member = await store.createTripMember({
    tripId: trip.id,
    userId: input.createdByUserId,
    role: "organizer",
  });
  const segment = await store.createTripSegment({
    tripId: trip.id,
    name: input.destinationName ?? input.name,
    destinationName: input.destinationName,
    destinationLat: input.destinationLat,
    destinationLng: input.destinationLng,
    startDate: input.startDate,
    endDate: input.endDate,
    tz: input.tz,
    sortOrder: 0,
  });
  const segmentMember = await store.createSegmentMember({
    segmentId: segment.id,
    userId: input.createdByUserId,
  });

  return {
    trip,
    member,
    segment,
    segmentMember,
  };
}

export async function listWorkspaceTrips(
  store: TripStore,
  input: {
    userId: string;
    workspaceId: string;
  },
) {
  return store.listWorkspaceTrips(input);
}

function createTripStore(db: any): TripStore {
  return {
    createTrip: async (input) => {
      const [createdTrip] = (await db
        .insert(trips)
        .values({
          workspaceId: input.workspaceId,
          name: input.name,
          createdByUserId: input.createdByUserId,
          groupMode: input.groupMode ?? false,
          destinationName: input.destinationName ?? null,
          destinationLat: input.destinationLat ?? null,
          destinationLng: input.destinationLng ?? null,
          startDate: input.startDate ?? null,
          endDate: input.endDate ?? null,
          tz: input.tz ?? "UTC",
        })
        .returning(tripSummaryShape)) as TripSummary[];

      if (!createdTrip) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create trip.",
        });
      }

      return createdTrip;
    },
    createTripMember: async (input) => {
      const [createdMember] = (await db
        .insert(tripMembers)
        .values(input)
        .returning({
          id: tripMembers.id,
          tripId: tripMembers.tripId,
          userId: tripMembers.userId,
          role: tripMembers.role,
        })) as TripMemberSummary[];

      if (!createdMember) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to add trip member.",
        });
      }

      return createdMember;
    },
    createTripSegment: async (input) => {
      const [createdSegment] = (await db
        .insert(tripSegments)
        .values({
          tripId: input.tripId,
          name: input.name,
          destinationName: input.destinationName ?? null,
          destinationLat: input.destinationLat ?? null,
          destinationLng: input.destinationLng ?? null,
          startDate: input.startDate ?? null,
          endDate: input.endDate ?? null,
          tz: input.tz ?? "UTC",
          sortOrder: input.sortOrder,
        })
        .returning({
          id: tripSegments.id,
          tripId: tripSegments.tripId,
          name: tripSegments.name,
          destinationName: tripSegments.destinationName,
          destinationLat: tripSegments.destinationLat,
          destinationLng: tripSegments.destinationLng,
          defaultZoom: tripSegments.defaultZoom,
          startDate: tripSegments.startDate,
          endDate: tripSegments.endDate,
          tz: tripSegments.tz,
          sortOrder: tripSegments.sortOrder,
        })) as TripSegmentSummary[];

      if (!createdSegment) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create trip segment.",
        });
      }

      return createdSegment;
    },
    createSegmentMember: async (input) => {
      const [createdSegmentMember] = (await db
        .insert(segmentMembers)
        .values(input)
        .returning({
          id: segmentMembers.id,
          segmentId: segmentMembers.segmentId,
          userId: segmentMembers.userId,
        })) as SegmentMemberSummary[];

      if (!createdSegmentMember) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to add segment member.",
        });
      }

      return createdSegmentMember;
    },
    listWorkspaceTrips: async ({ userId, workspaceId }) => {
      const memberships = (await db
        .select({
          tripId: tripMembers.tripId,
        })
        .from(tripMembers)
        .where(eq(tripMembers.userId, userId))
        .limit(Number.MAX_SAFE_INTEGER)) as Array<{ tripId: string }>;

      const visibleTripIds = new Set(
        memberships.map((membership) => membership.tripId),
      );
      const rows = (await db
        .select(tripSummaryShape)
        .from(trips)
        .where(eq(trips.workspaceId, workspaceId))
        .orderBy(desc(trips.createdAt), asc(trips.id))) as TripSummary[];

      return rows.filter((trip) => visibleTripIds.has(trip.id));
    },
    getTrip: async ({ workspaceId, tripId }) => {
      const tripsInWorkspace = (await db
        .select(tripSummaryShape)
        .from(trips)
        .where(eq(trips.workspaceId, workspaceId))
        .limit(Number.MAX_SAFE_INTEGER)) as TripSummary[];

      return tripsInWorkspace.find((trip) => trip.id === tripId) ?? null;
    },
  };
}

export const tripsRouter = {
  create: workspaceProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        name: z.string().min(2).max(160),
        destinationName: z.string().min(1).max(160).optional(),
        destinationLat: coordinateSchema.optional(),
        destinationLng: coordinateSchema.optional(),
        startDate: tripDateSchema.optional(),
        endDate: tripDateSchema.optional(),
        tz: z.string().min(1).max(100).default("UTC"),
        groupMode: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      return createTripRecord(createTripStore(ctx.db), {
        workspaceId: ctx.workspaceId,
        createdByUserId: ctx.session.user.id,
        name: input.name,
        destinationName: input.destinationName,
        destinationLat: input.destinationLat,
        destinationLng: input.destinationLng,
        startDate: input.startDate,
        endDate: input.endDate,
        tz: input.tz,
        groupMode: input.groupMode,
      });
    }),

  list: workspaceProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
      }),
    )
    .query(({ ctx }) =>
      listWorkspaceTrips(createTripStore(ctx.db), {
        userId: ctx.session.user.id,
        workspaceId: ctx.workspaceId,
      }),
    ),

  get: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
      }),
    )
    .query(async ({ ctx }) => {
      const trip = await createTripStore(ctx.db).getTrip({
        workspaceId: ctx.workspaceId,
        tripId: ctx.tripId,
      });

      if (!trip) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Trip not found.",
        });
      }

      return trip;
    }),
} satisfies TRPCRouterRecord;
