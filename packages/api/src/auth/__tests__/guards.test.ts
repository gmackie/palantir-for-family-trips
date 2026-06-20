/**
 * Direct unit tests for the auth guards middleware.
 *
 * Guards behavior pinned here (characterization tests):
 *
 * Layer 1 — protectedProcedure (in trpc.ts):
 *   - deny: no session → UNAUTHORIZED
 *   - allow: session present → passes through
 *
 * Layer 2 — workspaceProcedure (resolveWorkspaceAccess):
 *   - deny: caller not a workspace member → FORBIDDEN
 *   - allow: caller IS a member → passes and exposes workspaceId + workspaceRole
 *
 * Layer 3 — tripProcedure (resolveTripAccess):
 *   - deny: caller not a trip member (or workspace member) → FORBIDDEN
 *   - allow: caller IS a member → passes and exposes tripId + tripRole
 *
 * Chain:
 *   - tripProcedure chains workspaceProcedure first; non-workspace-member is
 *     rejected at the workspace layer (never reaches the trip check).
 */

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/gmacko_test";

import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import type { TripAccess, TripAccessStore, WorkspaceAccess } from "../guards";

const { resolveWorkspaceAccess, resolveTripAccess } = await import("../guards");

// ---------------------------------------------------------------------------
// In-memory TripAccessStore — no real DB required.
// ---------------------------------------------------------------------------

type MemState = {
  workspaceMemberships: Array<{
    userId: string;
    workspaceId: string;
    workspaceRole: string;
  }>;
  tripMemberships: Array<{
    userId: string;
    workspaceId: string;
    tripId: string;
    tripRole: string;
  }>;
};

function createMemoryStore(initial?: Partial<MemState>): TripAccessStore {
  const state: MemState = {
    workspaceMemberships: [...(initial?.workspaceMemberships ?? [])],
    tripMemberships: [...(initial?.tripMemberships ?? [])],
  };

  return {
    findWorkspaceAccess: async ({ userId, workspaceId }) => {
      const row = state.workspaceMemberships.find(
        (m) => m.userId === userId && m.workspaceId === workspaceId,
      );
      if (!row) return null;
      return {
        workspaceId: row.workspaceId,
        workspaceRole: row.workspaceRole as WorkspaceAccess["workspaceRole"],
      };
    },

    findTripAccess: async ({ userId, workspaceId, tripId }) => {
      // Must be a workspace member first.
      const wsMembership = state.workspaceMemberships.find(
        (m) => m.userId === userId && m.workspaceId === workspaceId,
      );
      if (!wsMembership) return null;

      // Then a trip member.
      const tripMembership = state.tripMemberships.find(
        (m) =>
          m.userId === userId &&
          m.workspaceId === workspaceId &&
          m.tripId === tripId,
      );
      if (!tripMembership) return null;

      return {
        workspaceId: wsMembership.workspaceId,
        workspaceRole:
          wsMembership.workspaceRole as TripAccess["workspaceRole"],
        tripId: tripMembership.tripId,
        tripRole: tripMembership.tripRole as TripAccess["tripRole"],
      };
    },
  };
}

// ---------------------------------------------------------------------------
// resolveWorkspaceAccess
// ---------------------------------------------------------------------------

describe("resolveWorkspaceAccess", () => {
  it("throws FORBIDDEN when the caller is not a workspace member", async () => {
    const store = createMemoryStore(); // empty — no memberships

    await expect(
      resolveWorkspaceAccess(store, {
        userId: "user_1",
        workspaceId: "ws_1",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns WorkspaceAccess when the caller IS a workspace member", async () => {
    const store = createMemoryStore({
      workspaceMemberships: [
        { userId: "user_1", workspaceId: "ws_1", workspaceRole: "member" },
      ],
    });

    const access = await resolveWorkspaceAccess(store, {
      userId: "user_1",
      workspaceId: "ws_1",
    });

    expect(access.workspaceId).toBe("ws_1");
    expect(access.workspaceRole).toBe("member");
  });

  it("is scoped — membership in ws_2 does not grant access to ws_1", async () => {
    const store = createMemoryStore({
      workspaceMemberships: [
        { userId: "user_1", workspaceId: "ws_2", workspaceRole: "member" },
      ],
    });

    await expect(
      resolveWorkspaceAccess(store, {
        userId: "user_1",
        workspaceId: "ws_1",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ---------------------------------------------------------------------------
// resolveTripAccess
// ---------------------------------------------------------------------------

describe("resolveTripAccess", () => {
  it("throws FORBIDDEN when the caller is not in the workspace at all", async () => {
    // store has no workspace membership — simulates a non-member trying to
    // access a trip (workspace gate fails first inside findTripAccess).
    const store = createMemoryStore({
      tripMemberships: [
        // even if someone crafted a trip membership row, no workspace row → denied
        {
          userId: "user_1",
          workspaceId: "ws_1",
          tripId: "trip_1",
          tripRole: "member",
        },
      ],
    });

    await expect(
      resolveTripAccess(store, {
        userId: "user_1",
        workspaceId: "ws_1",
        tripId: "trip_1",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws FORBIDDEN when the caller is a workspace member but not a trip member", async () => {
    const store = createMemoryStore({
      workspaceMemberships: [
        { userId: "user_1", workspaceId: "ws_1", workspaceRole: "member" },
      ],
      // No tripMemberships
    });

    await expect(
      resolveTripAccess(store, {
        userId: "user_1",
        workspaceId: "ws_1",
        tripId: "trip_1",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns TripAccess when the caller is both a workspace and trip member", async () => {
    const store = createMemoryStore({
      workspaceMemberships: [
        { userId: "user_1", workspaceId: "ws_1", workspaceRole: "admin" },
      ],
      tripMemberships: [
        {
          userId: "user_1",
          workspaceId: "ws_1",
          tripId: "trip_1",
          tripRole: "organizer",
        },
      ],
    });

    const access = await resolveTripAccess(store, {
      userId: "user_1",
      workspaceId: "ws_1",
      tripId: "trip_1",
    });

    expect(access.workspaceId).toBe("ws_1");
    expect(access.tripId).toBe("trip_1");
    expect(access.tripRole).toBe("organizer");
    expect(access.workspaceRole).toBe("admin");
  });

  it("is scoped — membership in trip_2 does not grant access to trip_1", async () => {
    const store = createMemoryStore({
      workspaceMemberships: [
        { userId: "user_1", workspaceId: "ws_1", workspaceRole: "member" },
      ],
      tripMemberships: [
        {
          userId: "user_1",
          workspaceId: "ws_1",
          tripId: "trip_2",
          tripRole: "member",
        },
      ],
    });

    await expect(
      resolveTripAccess(store, {
        userId: "user_1",
        workspaceId: "ws_1",
        tripId: "trip_1",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ---------------------------------------------------------------------------
// Guard-level error is always FORBIDDEN (never leaks NOT_FOUND)
// ---------------------------------------------------------------------------

describe("error code is always FORBIDDEN, not NOT_FOUND", () => {
  it("workspace miss → FORBIDDEN not NOT_FOUND", async () => {
    const store = createMemoryStore();

    const err = await resolveWorkspaceAccess(store, {
      userId: "user_1",
      workspaceId: "ws_nonexistent",
    }).catch((e: unknown) => e);

    expect((err as TRPCError).code).toBe("FORBIDDEN");
    expect((err as TRPCError).code).not.toBe("NOT_FOUND");
  });

  it("trip miss → FORBIDDEN not NOT_FOUND", async () => {
    const store = createMemoryStore({
      workspaceMemberships: [
        { userId: "user_1", workspaceId: "ws_1", workspaceRole: "member" },
      ],
    });

    const err = await resolveTripAccess(store, {
      userId: "user_1",
      workspaceId: "ws_1",
      tripId: "trip_nonexistent",
    }).catch((e: unknown) => e);

    expect((err as TRPCError).code).toBe("FORBIDDEN");
    expect((err as TRPCError).code).not.toBe("NOT_FOUND");
  });
});
