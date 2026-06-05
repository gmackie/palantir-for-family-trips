import { randomBytes } from "node:crypto";

import { and, asc, desc, eq, isNull, sql } from "@sortey/db";
import type { TripStatus } from "@sortey/db/schema";
import {
  segmentMembers,
  tripInvites,
  tripMembers,
  tripSegments,
  tripStatusEnum,
  trips,
  workspaceMembership,
} from "@sortey/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { tripProcedure, workspaceProcedure } from "../auth/guards";
import { sendPushToTripMembers } from "../notifications/send";
import { protectedProcedure, publicProcedure } from "../trpc";

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
  tripMode: trips.tripMode,
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
  status:
    | "planning"
    | "confirmed"
    | "active"
    | "en_route"
    | "paused"
    | "completed";
  tripMode: "destination" | "roadtrip";
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
    tripMode?: "destination" | "roadtrip";
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
    status?:
      | "planning"
      | "confirmed"
      | "active"
      | "en_route"
      | "paused"
      | "completed";
  }): Promise<TripSummary | null>;
  getShareInfo(input: {
    tripId: string;
  }): Promise<{ token: string | null; enabled: boolean } | null>;
  setShareToken(input: {
    tripId: string;
    token: string;
  }): Promise<{ token: string; enabled: boolean }>;
  forceSetShareToken(input: {
    tripId: string;
    token: string;
  }): Promise<{ token: string; enabled: boolean }>;
  setShareEnabled(input: {
    tripId: string;
    enabled: boolean;
  }): Promise<{ enabled: boolean }>;
  findTripByShareToken(input: { token: string }): Promise<{
    tripId: string;
    workspaceId: string;
    enabled: boolean;
    status: TripStatus;
  } | null>;
  // Idempotently ensures BOTH the workspace 'member' row and the trip 'member'
  // row. Consolidated into one method so the production impl can wrap both
  // writes in a single DB transaction (no partial-membership state on crash).
  joinTripMembership(input: {
    workspaceId: string;
    tripId: string;
    userId: string;
  }): Promise<void>;
  getSharePreview(input: { token: string }): Promise<{
    tripId: string;
    tripName: string;
    destinationName: string | null;
    destinationLat: string | null;
    destinationLng: string | null;
    startDate: string | null;
    endDate: string | null;
    enabled: boolean;
    tripStatus: TripStatus;
  } | null>;
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
    tripMode?: "destination" | "roadtrip";
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
    status?:
      | "planning"
      | "confirmed"
      | "active"
      | "en_route"
      | "paused"
      | "completed";
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

const SHARE_BASE_URL = "https://sortey.app/join";

function shareUrl(token: string): string {
  return `${SHARE_BASE_URL}/${token}`;
}

export async function getOrCreateShareLink(
  store: TripStore,
  input: {
    tripId: string;
    tripRole: "organizer" | "member";
  },
): Promise<{ token: string; url: string; enabled: boolean }> {
  requireOrganizerTripRole(input.tripRole);

  const info = await store.getShareInfo({ tripId: input.tripId });

  if (!info) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Trip not found.",
    });
  }

  let token = info.token;
  let enabled = info.enabled;

  if (!token) {
    // setShareToken is idempotent: concurrent first-callers converge on the
    // single winning token, and it returns the now-current authoritative
    // { token, enabled } (minting a fresh link re-enables it).
    const result = await store.setShareToken({
      tripId: input.tripId,
      token: generateInviteToken(),
    });
    token = result.token;
    enabled = result.enabled;
  }

  return { token, url: shareUrl(token), enabled };
}

export async function regenerateShareLink(
  store: TripStore,
  input: {
    tripId: string;
    tripRole: "organizer" | "member";
  },
): Promise<{ token: string; url: string; enabled: boolean }> {
  requireOrganizerTripRole(input.tripRole);

  // Unconditionally rotate the token (old links die) and re-enable the link.
  const result = await store.forceSetShareToken({
    tripId: input.tripId,
    token: generateInviteToken(),
  });

  return { token: result.token, url: shareUrl(result.token), enabled: true };
}

export async function setShareLinkEnabled(
  store: TripStore,
  input: {
    tripId: string;
    tripRole: "organizer" | "member";
    enabled: boolean;
  },
): Promise<{ enabled: boolean }> {
  requireOrganizerTripRole(input.tripRole);

  return store.setShareEnabled({
    tripId: input.tripId,
    enabled: input.enabled,
  });
}

export type ShareLinkPreview =
  | {
      status: "active";
      tripId: string;
      tripName: string;
      destinationName: string | null;
      destinationLat: string | null;
      destinationLng: string | null;
      startDate: string | null;
      endDate: string | null;
    }
  | { status: "ended" }
  | { status: "disabled" }
  | { status: "not_found" };

// SECURITY: protectedProcedure (NOT tripProcedure) backs this — the joiner is
// not yet a member, the share token IS the authorization. We deliberately do
// NOT check the caller's email (unlike acceptInvite): anyone holding a live,
// enabled link may join. Keep this function DB/IO-free except via `store`.
export async function joinTripByShareToken(
  store: TripStore,
  input: {
    token: string;
    userId: string;
  },
): Promise<{ tripId: string; workspaceId: string }> {
  const trip = await store.findTripByShareToken({ token: input.token });

  if (!trip) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This invite link is no longer active.",
    });
  }

  if (!trip.enabled) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This invite link has been disabled.",
    });
  }

  if (trip.status === "completed") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This trip has already ended.",
    });
  }

  // Both membership writes happen atomically (and idempotently) inside the
  // store, so a crash can't leave a workspace member without a trip member.
  await store.joinTripMembership({
    workspaceId: trip.workspaceId,
    tripId: trip.tripId,
    userId: input.userId,
  });

  return { tripId: trip.tripId, workspaceId: trip.workspaceId };
}

export async function getShareLinkPreview(
  store: TripStore,
  input: { token: string },
): Promise<ShareLinkPreview> {
  const preview = await store.getSharePreview({ token: input.token });

  if (!preview) {
    return { status: "not_found" };
  }

  if (!preview.enabled) {
    return { status: "disabled" };
  }

  // A completed trip can't be joined (join rejects it with BAD_REQUEST), so
  // surface it as "ended" rather than dangling an "active" preview.
  if (preview.tripStatus === "completed") {
    return { status: "ended" };
  }

  // NEVER return the token or any secret — only public-safe display fields.
  return {
    status: "active",
    tripId: preview.tripId,
    tripName: preview.tripName,
    destinationName: preview.destinationName,
    destinationLat: preview.destinationLat,
    destinationLng: preview.destinationLng,
    startDate: preview.startDate,
    endDate: preview.endDate,
  };
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
          tripMode: input.tripMode ?? "destination",
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
    getShareInfo: async ({ tripId }) => {
      const [row] = (await db
        .select({
          token: trips.shareInviteToken,
          enabled: trips.shareInviteEnabled,
        })
        .from(trips)
        .where(eq(trips.id, tripId))
        .limit(1)) as Array<{ token: string | null; enabled: boolean }>;

      return row ?? null;
    },
    setShareToken: async ({ tripId, token }) => {
      // Idempotent: only set the token when it is still null, so concurrent
      // first-callers converge on a single winning token (last-writer-wins is
      // avoided). Then re-select to return the now-current authoritative state.
      await db
        .update(trips)
        .set({
          shareInviteToken: token,
          shareInviteEnabled: true,
          shareInviteCreatedAt: new Date(),
        })
        .where(and(eq(trips.id, tripId), isNull(trips.shareInviteToken)));

      const [row] = (await db
        .select({
          token: trips.shareInviteToken,
          enabled: trips.shareInviteEnabled,
        })
        .from(trips)
        .where(eq(trips.id, tripId))
        .limit(1)) as Array<{ token: string | null; enabled: boolean }>;

      return { token: row?.token ?? token, enabled: row?.enabled ?? true };
    },
    forceSetShareToken: async ({ tripId, token }) => {
      // Unconditional rotation: overwrite any existing token (old links die)
      // and re-enable the link.
      const [row] = (await db
        .update(trips)
        .set({
          shareInviteToken: token,
          shareInviteEnabled: true,
          shareInviteCreatedAt: new Date(),
        })
        .where(eq(trips.id, tripId))
        .returning({
          token: trips.shareInviteToken,
          enabled: trips.shareInviteEnabled,
        })) as Array<{ token: string | null; enabled: boolean }>;

      return { token: row?.token ?? token, enabled: row?.enabled ?? true };
    },
    setShareEnabled: async ({ tripId, enabled }) => {
      const [row] = (await db
        .update(trips)
        .set({ shareInviteEnabled: enabled })
        .where(eq(trips.id, tripId))
        .returning({
          enabled: trips.shareInviteEnabled,
        })) as Array<{ enabled: boolean }>;

      return { enabled: row?.enabled ?? enabled };
    },
    findTripByShareToken: async ({ token }) => {
      const [row] = (await db
        .select({
          tripId: trips.id,
          workspaceId: trips.workspaceId,
          enabled: trips.shareInviteEnabled,
          status: trips.status,
        })
        .from(trips)
        .where(eq(trips.shareInviteToken, token))
        .limit(1)) as Array<{
        tripId: string;
        workspaceId: string;
        enabled: boolean;
        status: TripStatus;
      }>;

      return row ?? null;
    },
    joinTripMembership: async ({ workspaceId, tripId, userId }) => {
      // Atomic + idempotent: both membership rows are written in a single
      // transaction, so a crash can't leave a workspace member without the
      // matching trip member. onConflictDoNothing leans on the existing unique
      // constraints, making re-joining a safe no-op.
      // biome-ignore lint/suspicious/noExplicitAny: Drizzle tx type is complex
      await db.transaction(async (tx: any) => {
        await tx
          .insert(workspaceMembership)
          .values({ workspaceId, userId, role: "member" })
          .onConflictDoNothing({
            target: [
              workspaceMembership.workspaceId,
              workspaceMembership.userId,
            ],
          });
        await tx
          .insert(tripMembers)
          .values({ tripId, userId, role: "member" })
          .onConflictDoNothing({
            target: [tripMembers.tripId, tripMembers.userId],
          });
      });
    },
    getSharePreview: async ({ token }) => {
      const [row] = (await db
        .select({
          tripId: trips.id,
          tripName: trips.name,
          destinationName: trips.destinationName,
          destinationLat: trips.destinationLat,
          destinationLng: trips.destinationLng,
          startDate: trips.startDate,
          endDate: trips.endDate,
          enabled: trips.shareInviteEnabled,
          tripStatus: trips.status,
        })
        .from(trips)
        .where(eq(trips.shareInviteToken, token))
        .limit(1)) as Array<{
        tripId: string;
        tripName: string;
        destinationName: string | null;
        destinationLat: string | null;
        destinationLng: string | null;
        startDate: string | null;
        endDate: string | null;
        enabled: boolean;
        tripStatus: TripStatus;
      }>;

      return row ?? null;
    },
  };
}

export const tripsRouter = {
  create: workspaceProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        name: z.string().min(2).max(160),
        tripMode: z.enum(["destination", "roadtrip"]).default("destination"),
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
        tripMode: input.tripMode,
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

  setStatus: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        status: z.enum(tripStatusEnum),
      }),
    )
    .mutation(({ ctx, input }) =>
      updateTripRecord(createTripStore(ctx.db), {
        workspaceId: ctx.workspaceId,
        tripId: ctx.tripId,
        tripRole: ctx.tripRole,
        status: input.status,
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

  getShareLink: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
      }),
    )
    .query(({ ctx }) =>
      getOrCreateShareLink(createTripStore(ctx.db), {
        tripId: ctx.tripId,
        tripRole: ctx.tripRole,
      }),
    ),

  regenerateShareLink: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
      }),
    )
    .mutation(({ ctx }) =>
      regenerateShareLink(createTripStore(ctx.db), {
        tripId: ctx.tripId,
        tripRole: ctx.tripRole,
      }),
    ),

  setShareLinkEnabled: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        enabled: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) =>
      setShareLinkEnabled(createTripStore(ctx.db), {
        tripId: ctx.tripId,
        tripRole: ctx.tripRole,
        enabled: input.enabled,
      }),
    ),

  // SECURITY: protectedProcedure, NOT tripProcedure — the joiner is not yet a
  // member, so the share token itself is the authorization. The single
  // deliberate exception to the trip-membership gate.
  joinByShareToken: protectedProcedure
    .input(
      z.object({
        token: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // TODO(ratelimit): this is an unauthenticated-token entry point — wrap
      // with a per-IP / per-user rate limiter once a shared util exists.
      const result = await joinTripByShareToken(createTripStore(ctx.db), {
        token: input.token,
        userId: ctx.session.user.id,
      });

      void sendPushToTripMembers(ctx.db, {
        tripId: result.tripId,
        excludeUserId: ctx.session.user.id,
        title: "New Member",
        body: `${ctx.session.user.name ?? ctx.session.user.email ?? "Someone"} joined the trip`,
        data: { tripId: result.tripId, screen: "members" },
      });

      return result;
    }),

  // Public, unauthenticated — backs the /join/[token] OG preview card. Returns
  // only public-safe display fields; NEVER the token or any secret.
  getShareLinkPreview: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
      }),
    )
    .query(({ ctx, input }) =>
      getShareLinkPreview(createTripStore(ctx.db), { token: input.token }),
    ),

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

  delete: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx }) => {
      requireOrganizerTripRole(ctx.tripRole);
      await ctx.db.delete(trips).where(eq(trips.id, ctx.tripId));
      return { deleted: true };
    }),

  listSegments: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
      }),
    )
    .query(async ({ ctx }) => {
      const userId = ctx.session.user.id;
      const rows = await ctx.db
        .select({
          id: tripSegments.id,
          tripId: tripSegments.tripId,
          name: tripSegments.name,
          sortOrder: tripSegments.sortOrder,
          destinationName: tripSegments.destinationName,
          destinationLat: tripSegments.destinationLat,
          destinationLng: tripSegments.destinationLng,
          originName: tripSegments.originName,
          originLat: tripSegments.originLat,
          originLng: tripSegments.originLng,
          routePolyline: tripSegments.routePolyline,
          distanceMiles: tripSegments.distanceMiles,
          durationMinutes: tripSegments.durationMinutes,
          startDate: tripSegments.startDate,
          endDate: tripSegments.endDate,
          memberCount: sql<number>`(SELECT count(*) FROM segment_member WHERE segment_id = ${tripSegments.id})::int`,
          isMember: sql<boolean>`EXISTS(SELECT 1 FROM segment_member WHERE segment_id = ${tripSegments.id} AND user_id = ${userId})`,
        })
        .from(tripSegments)
        .where(eq(tripSegments.tripId, ctx.tripId))
        .orderBy(asc(tripSegments.sortOrder));

      return rows.filter((r) => r.isMember || r.memberCount === 0);
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
        const existingWorkspaceMember =
          await tx.query.workspaceMembership.findFirst({
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

      void sendPushToTripMembers(ctx.db, {
        tripId: invite.tripId,
        excludeUserId: ctx.session.user.id,
        title: "New Member",
        body: `${ctx.session.user.name ?? ctx.session.user.email ?? "Someone"} joined the trip`,
        data: { tripId: invite.tripId, screen: "members" },
      });

      return {
        tripId: invite.tripId,
        workspaceId: invite.workspaceId,
      };
    }),
  listMembers: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
      }),
    )
    .query(async ({ ctx }) => {
      const members = (await ctx.db
        .select({
          userId: tripMembers.userId,
          displayName: tripMembers.displayName,
          role: tripMembers.role,
          colorHex: tripMembers.colorHex,
        })
        .from(tripMembers)
        .where(eq(tripMembers.tripId, ctx.tripId))
        .orderBy(asc(tripMembers.joinedAt))) as Array<{
        userId: string;
        displayName: string | null;
        role: string;
        colorHex: string | null;
      }>;

      return members;
    }),

  updateMyProfile: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        displayName: z.string().min(1).max(120).optional(),
        venmoHandle: z.string().max(80).optional(),
        colorHex: z.string().max(16).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const updates: Record<string, unknown> = {};
      if (input.displayName !== undefined)
        updates.displayName = input.displayName;
      if (input.venmoHandle !== undefined)
        updates.venmoHandle = input.venmoHandle;
      if (input.colorHex !== undefined) updates.colorHex = input.colorHex;

      if (Object.keys(updates).length === 0) return null;

      const [updated] = (await ctx.db
        .update(tripMembers)
        .set(updates)
        .where(
          and(
            eq(tripMembers.tripId, ctx.tripId),
            eq(tripMembers.userId, ctx.session.user.id),
          ),
        )
        .returning()) as Array<typeof tripMembers.$inferSelect>;

      return updated ?? null;
    }),

  createSegment: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        name: z.string().min(1).max(160),
        destinationName: z.string().max(160).optional(),
        startDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        endDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select({
          maxSort: sql<number>`coalesce(max(${tripSegments.sortOrder}), -1)`,
        })
        .from(tripSegments)
        .where(eq(tripSegments.tripId, ctx.tripId));
      const nextSort = (existing[0]?.maxSort ?? -1) + 1;

      const [created] = (await ctx.db
        .insert(tripSegments)
        .values({
          tripId: ctx.tripId,
          name: input.name,
          destinationName: input.destinationName ?? null,
          startDate: input.startDate ?? null,
          endDate: input.endDate ?? null,
          sortOrder: nextSort,
        })
        .returning()) as Array<typeof tripSegments.$inferSelect>;

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create segment.",
        });
      }

      await ctx.db.insert(segmentMembers).values({
        segmentId: created.id,
        userId: ctx.session.user.id,
      });

      return created;
    }),

  listSegmentMembers: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        segmentId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const members = (await ctx.db
        .select({
          userId: segmentMembers.userId,
          displayName: tripMembers.displayName,
          colorHex: tripMembers.colorHex,
        })
        .from(segmentMembers)
        .innerJoin(
          tripMembers,
          and(
            eq(tripMembers.userId, segmentMembers.userId),
            eq(tripMembers.tripId, ctx.tripId),
          ),
        )
        .where(eq(segmentMembers.segmentId, input.segmentId))) as Array<{
        userId: string;
        displayName: string | null;
        colorHex: string | null;
      }>;
      return members;
    }),

  joinSegment: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        segmentId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [seg] = await ctx.db
        .select({ id: tripSegments.id })
        .from(tripSegments)
        .where(
          and(
            eq(tripSegments.id, input.segmentId),
            eq(tripSegments.tripId, ctx.tripId),
          ),
        )
        .limit(1);
      if (!seg) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Segment not found.",
        });
      }

      await ctx.db
        .insert(segmentMembers)
        .values({ segmentId: input.segmentId, userId: ctx.session.user.id })
        .onConflictDoNothing();

      return { joined: true };
    }),

  leaveSegment: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        segmentId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(segmentMembers)
        .where(
          and(
            eq(segmentMembers.segmentId, input.segmentId),
            eq(segmentMembers.userId, ctx.session.user.id),
          ),
        );
      return { left: true };
    }),

  addToSegment: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        segmentId: z.string().uuid(),
        userId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [isTripMember] = await ctx.db
        .select({ userId: tripMembers.userId })
        .from(tripMembers)
        .where(
          and(
            eq(tripMembers.tripId, ctx.tripId),
            eq(tripMembers.userId, input.userId),
          ),
        )
        .limit(1);
      if (!isTripMember) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User is not a member of this trip.",
        });
      }

      await ctx.db
        .insert(segmentMembers)
        .values({ segmentId: input.segmentId, userId: input.userId })
        .onConflictDoNothing();

      return { added: true };
    }),
} satisfies TRPCRouterRecord;
