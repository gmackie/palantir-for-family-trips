import { randomBytes } from "node:crypto";

import { and, asc, desc, eq, isNull } from "@gmacko/db";
import {
  segmentMembers,
  tripInvites,
  tripMembers,
  tripSegments,
  trips,
  workspaceMembership,
} from "@gmacko/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { protectedProcedure, publicProcedure } from "../trpc";
import { tripProcedure, workspaceProcedure } from "../auth/guards";

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

function generateInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

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
  updateTrip(input: {
    workspaceId: string;
    tripId: string;
    name?: string;
    destinationName?: string;
    startDate?: string;
    endDate?: string;
    tz?: string;
    groupMode?: boolean;
    claimMode?: "organizer" | "tap";
  }): Promise<TripSummary | null>;
}

function requireOrganizerTripRole(tripRole: "organizer" | "member") {
  if (tripRole !== "organizer") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only organizers can update trip settings.",
    });
  }
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

export async function updateTripRecord(
  store: TripStore,
  input: {
    workspaceId: string;
    tripId: string;
    tripRole: "organizer" | "member";
    name?: string;
    destinationName?: string;
    startDate?: string;
    endDate?: string;
    tz?: string;
    groupMode?: boolean;
    claimMode?: "organizer" | "tap";
  },
) {
  requireOrganizerTripRole(input.tripRole);

  const updated = await store.updateTrip(input);

  if (!updated) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Trip not found.",
    });
  }

  return updated;
}

export function setTripGroupMode(
  store: TripStore,
  input: {
    workspaceId: string;
    tripId: string;
    tripRole: "organizer" | "member";
    groupMode: boolean;
  },
) {
  return updateTripRecord(store, input);
}

export function setTripClaimMode(
  store: TripStore,
  input: {
    workspaceId: string;
    tripId: string;
    tripRole: "organizer" | "member";
    claimMode: "organizer" | "tap";
  },
) {
  return updateTripRecord(store, input);
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
    updateTrip: async ({ workspaceId, tripId, ...changes }) => {
      const [updatedTrip] = (await db
        .update(trips)
        .set(changes)
        .where(eq(trips.id, tripId))
        .returning(tripSummaryShape)) as TripSummary[];

      if (!updatedTrip || updatedTrip.workspaceId !== workspaceId) {
        return null;
      }

      return updatedTrip;
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

  update: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        name: z.string().min(1).max(160),
        destinationName: z.string().min(1).max(160),
        startDate: tripDateSchema.optional(),
        endDate: tripDateSchema.optional(),
        tz: z.string().min(1).max(100).default("UTC"),
      }),
    )
    .mutation(({ ctx, input }) =>
      updateTripRecord(createTripStore(ctx.db), {
        workspaceId: ctx.workspaceId,
        tripId: ctx.tripId,
        tripRole: ctx.tripRole,
        name: input.name,
        destinationName: input.destinationName,
        startDate: input.startDate,
        endDate: input.endDate,
        tz: input.tz,
      }),
    ),

  setGroupMode: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        groupMode: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) =>
      setTripGroupMode(createTripStore(ctx.db), {
        workspaceId: ctx.workspaceId,
        tripId: ctx.tripId,
        tripRole: ctx.tripRole,
        groupMode: input.groupMode,
      }),
    ),

  setClaimMode: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        claimMode: z.enum(["organizer", "tap"]),
      }),
    )
    .mutation(({ ctx, input }) =>
      setTripClaimMode(createTripStore(ctx.db), {
        workspaceId: ctx.workspaceId,
        tripId: ctx.tripId,
        tripRole: ctx.tripRole,
        claimMode: input.claimMode,
      }),
    ),

  createInvite: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        email: z.string().email().toLowerCase(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireOrganizerTripRole(ctx.tripRole);

      const token = generateInviteToken();
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

      const [created] = (await ctx.db
        .insert(tripInvites)
        .values({
          tripId: ctx.tripId,
          email: input.email,
          token,
          invitedByUserId: ctx.session.user.id,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: [tripInvites.tripId, tripInvites.email],
          set: {
            token,
            expiresAt,
            invitedByUserId: ctx.session.user.id,
            acceptedAt: null,
          },
        })
        .returning({
          id: tripInvites.id,
          tripId: tripInvites.tripId,
          email: tripInvites.email,
          token: tripInvites.token,
          expiresAt: tripInvites.expiresAt,
        })) as Array<{
        id: string;
        tripId: string;
        email: string;
        token: string;
        expiresAt: Date;
      }>;

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create trip invite.",
        });
      }

      return created;
    }),

  listInvites: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
      }),
    )
    .query(async ({ ctx }) => {
      requireOrganizerTripRole(ctx.tripRole);

      const rows = (await ctx.db
        .select({
          id: tripInvites.id,
          email: tripInvites.email,
          expiresAt: tripInvites.expiresAt,
          acceptedAt: tripInvites.acceptedAt,
          createdAt: tripInvites.createdAt,
        })
        .from(tripInvites)
        .where(eq(tripInvites.tripId, ctx.tripId))
        .orderBy(desc(tripInvites.createdAt))) as Array<{
        id: string;
        email: string;
        expiresAt: Date;
        acceptedAt: Date | null;
        createdAt: Date;
      }>;

      return rows;
    }),

  getInviteByToken: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [invite] = (await ctx.db
        .select({
          id: tripInvites.id,
          tripId: tripInvites.tripId,
          email: tripInvites.email,
          expiresAt: tripInvites.expiresAt,
          acceptedAt: tripInvites.acceptedAt,
          tripName: trips.name,
          workspaceId: trips.workspaceId,
        })
        .from(tripInvites)
        .innerJoin(trips, eq(trips.id, tripInvites.tripId))
        .where(eq(tripInvites.token, input.token))
        .limit(1)) as Array<{
        id: string;
        tripId: string;
        email: string;
        expiresAt: Date;
        acceptedAt: Date | null;
        tripName: string;
        workspaceId: string;
      }>;

      if (!invite) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invite not found.",
        });
      }

      if (invite.acceptedAt) {
        return {
          status: "already_accepted" as const,
          email: invite.email,
          tripId: invite.tripId,
          tripName: invite.tripName,
        };
      }

      if (invite.expiresAt < new Date()) {
        return {
          status: "expired" as const,
          email: invite.email,
          tripId: invite.tripId,
          tripName: invite.tripName,
        };
      }

      return {
        status: "valid" as const,
        email: invite.email,
        tripId: invite.tripId,
        tripName: invite.tripName,
      };
    }),

  listSegments: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
      }),
    )
    .query(async ({ ctx }) => {
      const rows = (await ctx.db
        .select({
          id: tripSegments.id,
          tripId: tripSegments.tripId,
          name: tripSegments.name,
          sortOrder: tripSegments.sortOrder,
        })
        .from(tripSegments)
        .where(eq(tripSegments.tripId, ctx.tripId))
        .orderBy(asc(tripSegments.sortOrder))) as Array<{
        id: string;
        tripId: string;
        name: string;
        sortOrder: number;
      }>;

      return rows;
    }),

  acceptInvite: protectedProcedure
    .input(
      z.object({
        token: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // The current user must match the invite email. This prevents someone
      // with a link from accepting on behalf of a different signed-in user.
      const [invite] = (await ctx.db
        .select({
          id: tripInvites.id,
          tripId: tripInvites.tripId,
          email: tripInvites.email,
          expiresAt: tripInvites.expiresAt,
          acceptedAt: tripInvites.acceptedAt,
          workspaceId: trips.workspaceId,
        })
        .from(tripInvites)
        .innerJoin(trips, eq(trips.id, tripInvites.tripId))
        .where(eq(tripInvites.token, input.token))
        .limit(1)) as Array<{
        id: string;
        tripId: string;
        email: string;
        expiresAt: Date;
        acceptedAt: Date | null;
        workspaceId: string;
      }>;

      if (!invite) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invite not found.",
        });
      }

      if (invite.acceptedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invite has already been accepted.",
        });
      }

      if (invite.expiresAt < new Date()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invite has expired.",
        });
      }

      const sessionEmail = ctx.session.user.email.toLowerCase();
      if (sessionEmail !== invite.email.toLowerCase()) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "This invite was sent to a different email than the one you're signed in with.",
        });
      }

      // Transactionally provision workspace membership (if missing),
      // create the trip membership, and mark the invite accepted.
      // biome-ignore lint/suspicious/noExplicitAny: Drizzle tx type is complex
      await ctx.db.transaction(async (tx: any) => {
        const existingWorkspaceMember = await tx.query.workspaceMembership.findFirst({
          where: and(
            eq(workspaceMembership.userId, ctx.session.user.id),
            eq(workspaceMembership.workspaceId, invite.workspaceId),
          ),
        });

        if (!existingWorkspaceMember) {
          await tx.insert(workspaceMembership).values({
            workspaceId: invite.workspaceId,
            userId: ctx.session.user.id,
            role: "member",
          });
        }

        const existingTripMember = await tx.query.tripMembers?.findFirst?.({
          where: and(
            eq(tripMembers.userId, ctx.session.user.id),
            eq(tripMembers.tripId, invite.tripId),
          ),
        });

        if (!existingTripMember) {
          await tx.insert(tripMembers).values({
            tripId: invite.tripId,
            userId: ctx.session.user.id,
            role: "member",
          });
        }

        await tx
          .update(tripInvites)
          .set({ acceptedAt: new Date() })
          .where(
            and(eq(tripInvites.id, invite.id), isNull(tripInvites.acceptedAt)),
          );
      });

      return {
        tripId: invite.tripId,
        workspaceId: invite.workspaceId,
      };
    }),
} satisfies TRPCRouterRecord;
