import { and, eq } from "@gmacko/db";
import {
  type TripMemberRole,
  tripMembers,
  trips,
  type WorkspaceRole,
  workspaceMembership,
} from "@gmacko/db/schema";
import { TRPCError } from "@trpc/server";

import { protectedProcedure } from "../trpc";

type ScopedInput = Record<string, unknown> | null | undefined;

export type WorkspaceAccess = {
  workspaceId: string;
  workspaceRole: WorkspaceRole;
};

export type TripAccess = WorkspaceAccess & {
  tripId: string;
  tripRole: TripMemberRole;
};

export interface TripAccessStore {
  findWorkspaceAccess(input: {
    userId: string;
    workspaceId: string;
  }): Promise<WorkspaceAccess | null>;
  findTripAccess(input: {
    userId: string;
    workspaceId: string;
    tripId: string;
  }): Promise<TripAccess | null>;
}

function readScopedId(input: unknown, key: string): string {
  // tRPC middleware receives raw input. With superjson transformer,
  // the actual values may be nested under a `json` key.
  const obj = input as ScopedInput;
  const directValue = obj?.[key];
  const jsonWrappedValue = (obj?.json as ScopedInput)?.[key];
  const value = typeof directValue === "string" ? directValue : typeof jsonWrappedValue === "string" ? jsonWrappedValue : undefined;

  if (typeof value !== "string" || value.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Missing ${key}. Debug: type=${typeof input}, keys=${input && typeof input === "object" ? Object.keys(input as object).join(",") : "none"}, raw=${JSON.stringify(input)?.slice(0, 300)}`,
      message: `Missing ${key}`,
    });
  }

  return value;
}

function createTripAccessStore(db: any): TripAccessStore {
  return {
    findWorkspaceAccess: async ({ userId, workspaceId }) => {
      const [membership] = (await db
        .select({
          workspaceId: workspaceMembership.workspaceId,
          workspaceRole: workspaceMembership.role,
        })
        .from(workspaceMembership)
        .where(
          and(
            eq(workspaceMembership.userId, userId),
            eq(workspaceMembership.workspaceId, workspaceId),
          ),
        )
        .limit(1)) as WorkspaceAccess[];

      return membership ?? null;
    },
    findTripAccess: async ({ userId, workspaceId, tripId }) => {
      const [membership] = (await db
        .select({
          workspaceId: workspaceMembership.workspaceId,
          workspaceRole: workspaceMembership.role,
        })
        .from(workspaceMembership)
        .where(
          and(
            eq(workspaceMembership.userId, userId),
            eq(workspaceMembership.workspaceId, workspaceId),
          ),
        )
        .limit(1)) as WorkspaceAccess[];

      if (!membership) {
        return null;
      }

      const [trip] = (await db
        .select({
          tripId: trips.id,
        })
        .from(trips)
        .where(and(eq(trips.id, tripId), eq(trips.workspaceId, workspaceId)))
        .limit(1)) as { tripId: string }[];

      if (!trip) {
        return null;
      }

      const [tripMember] = (await db
        .select({
          tripRole: tripMembers.role,
        })
        .from(tripMembers)
        .where(
          and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId)),
        )
        .limit(1)) as { tripRole: TripMemberRole }[];

      if (!tripMember) {
        return null;
      }

      return {
        tripId: trip.tripId,
        tripRole: tripMember.tripRole,
        workspaceId: membership.workspaceId,
        workspaceRole: membership.workspaceRole,
      };
    },
  };
}

export async function resolveWorkspaceAccess(
  store: TripAccessStore,
  input: {
    userId: string;
    workspaceId: string;
  },
): Promise<WorkspaceAccess> {
  const access = await store.findWorkspaceAccess(input);

  if (!access) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not belong to this workspace.",
    });
  }

  return access;
}

export async function resolveTripAccess(
  store: TripAccessStore,
  input: {
    userId: string;
    workspaceId: string;
    tripId: string;
  },
): Promise<TripAccess> {
  const access = await store.findTripAccess(input);

  if (!access) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not belong to this trip.",
    });
  }

  return access;
}

export function workspaceProcedure(workspaceIdKey = "workspaceId") {
  return protectedProcedure.use(async ({ ctx, input, next }) => {
    const access = await resolveWorkspaceAccess(createTripAccessStore(ctx.db), {
      userId: ctx.session.user.id,
      workspaceId: readScopedId(input, workspaceIdKey),
    });

    return next({
      ctx: {
        ...ctx,
        workspaceId: access.workspaceId,
        workspaceRole: access.workspaceRole,
      },
    });
  });
}

export function tripProcedure(
  options: { tripIdKey?: string; workspaceIdKey?: string } = {},
) {
  const { tripIdKey = "tripId", workspaceIdKey = "workspaceId" } = options;

  return workspaceProcedure(workspaceIdKey).use(
    async ({ ctx, input, next }) => {
      const access = await resolveTripAccess(createTripAccessStore(ctx.db), {
        userId: ctx.session.user.id,
        workspaceId: ctx.workspaceId,
        tripId: readScopedId(input, tripIdKey),
      });

      return next({
        ctx: {
          ...ctx,
          tripId: access.tripId,
          tripRole: access.tripRole,
        },
      });
    },
  );
}
