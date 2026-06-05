import { describe, expect, it } from "vitest";
import type { TripStore } from "../trips";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/gmacko_test";

const {
  getOrCreateShareLink,
  regenerateShareLink,
  setShareLinkEnabled,
  joinTripByShareToken,
  getShareLinkPreview,
} = await import("../trips");

type TripStatus = "planning" | "confirmed" | "active" | "completed";
type ClaimMode = "organizer" | "tap";

type TripRecord = {
  id: string;
  workspaceId: string;
  name: string;
  createdByUserId: string;
  status: TripStatus;
  tripMode: "destination" | "roadtrip";
  groupMode: boolean;
  claimMode: ClaimMode;
  destinationName: string | null;
  destinationLat: string | null;
  destinationLng: string | null;
  defaultZoom: number;
  startDate: string | null;
  endDate: string | null;
  tz: string;
  shareInviteToken: string | null;
  shareInviteEnabled: boolean;
  shareInviteCreatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date | null;
};

function makeTrip(overrides: Partial<TripRecord> = {}): TripRecord {
  return {
    id: "trip_1",
    workspaceId: "workspace_1",
    name: "Italy Summer",
    createdByUserId: "user_1",
    status: "planning",
    tripMode: "destination",
    groupMode: false,
    claimMode: "organizer",
    destinationName: "Milan",
    destinationLat: null,
    destinationLng: null,
    defaultZoom: 13,
    startDate: null,
    endDate: null,
    tz: "Europe/Rome",
    shareInviteToken: null,
    shareInviteEnabled: true,
    shareInviteCreatedAt: null,
    createdAt: new Date("2026-04-10T00:00:00.000Z"),
    updatedAt: null,
    ...overrides,
  };
}

type WorkspaceMembershipRecord = {
  workspaceId: string;
  userId: string;
  role: "owner" | "admin" | "member";
};

type TripMemberRecord = {
  tripId: string;
  userId: string;
  role: "organizer" | "member";
};

function createShareStore(input?: {
  trips?: TripRecord[];
  workspaceMemberships?: WorkspaceMembershipRecord[];
  tripMembers?: TripMemberRecord[];
}) {
  const state = {
    trips: [...(input?.trips ?? [])],
    workspaceMemberships: [...(input?.workspaceMemberships ?? [])],
    tripMembers: [...(input?.tripMembers ?? [])],
  };

  const store: Pick<
    TripStore,
    | "getShareInfo"
    | "setShareToken"
    | "forceSetShareToken"
    | "setShareEnabled"
    | "findTripByShareToken"
    | "ensureWorkspaceMember"
    | "addTripMemberIfMissing"
    | "getSharePreview"
  > = {
    getShareInfo: async ({ tripId }: { tripId: string }) => {
      const trip = state.trips.find((entry) => entry.id === tripId) ?? null;
      if (!trip) {
        return null;
      }
      return {
        token: trip.shareInviteToken,
        enabled: trip.shareInviteEnabled,
      };
    },
    setShareToken: async ({
      tripId,
      token,
    }: {
      tripId: string;
      token: string;
    }) => {
      const index = state.trips.findIndex((entry) => entry.id === tripId);
      if (index === -1) {
        return { token, enabled: true };
      }
      // Idempotent: only set the token when it is still null (mirrors the
      // production "WHERE shareInviteToken IS NULL" guard).
      if (state.trips[index]!.shareInviteToken === null) {
        state.trips[index] = {
          ...state.trips[index]!,
          shareInviteToken: token,
          shareInviteEnabled: true,
          shareInviteCreatedAt: new Date("2026-04-16T08:00:00.000Z"),
        };
      }
      const current = state.trips[index]!;
      return {
        token: current.shareInviteToken ?? token,
        enabled: current.shareInviteEnabled,
      };
    },
    forceSetShareToken: async ({
      tripId,
      token,
    }: {
      tripId: string;
      token: string;
    }) => {
      const index = state.trips.findIndex((entry) => entry.id === tripId);
      if (index === -1) {
        return { token, enabled: true };
      }
      // Unconditional rotation: overwrite any existing token and re-enable.
      state.trips[index] = {
        ...state.trips[index]!,
        shareInviteToken: token,
        shareInviteEnabled: true,
        shareInviteCreatedAt: new Date("2026-04-16T08:00:00.000Z"),
      };
      return { token, enabled: true };
    },
    setShareEnabled: async ({
      tripId,
      enabled,
    }: {
      tripId: string;
      enabled: boolean;
    }) => {
      const index = state.trips.findIndex((entry) => entry.id === tripId);
      if (index === -1) {
        return { enabled };
      }
      state.trips[index] = {
        ...state.trips[index]!,
        shareInviteEnabled: enabled,
      };
      return { enabled };
    },
    findTripByShareToken: async ({ token }: { token: string }) => {
      const trip = state.trips.find(
        (entry) =>
          entry.shareInviteToken !== null && entry.shareInviteToken === token,
      );
      if (!trip) {
        return null;
      }
      return {
        tripId: trip.id,
        workspaceId: trip.workspaceId,
        enabled: trip.shareInviteEnabled,
        status: trip.status,
      };
    },
    ensureWorkspaceMember: async ({
      workspaceId,
      userId,
    }: {
      workspaceId: string;
      userId: string;
    }) => {
      // Idempotent: insert only if missing.
      const exists = state.workspaceMemberships.some(
        (m) => m.workspaceId === workspaceId && m.userId === userId,
      );
      if (!exists) {
        state.workspaceMemberships.push({
          workspaceId,
          userId,
          role: "member",
        });
      }
    },
    addTripMemberIfMissing: async ({
      tripId,
      userId,
    }: {
      tripId: string;
      userId: string;
    }) => {
      // Idempotent: onConflictDoNothing on (tripId, userId).
      const exists = state.tripMembers.some(
        (m) => m.tripId === tripId && m.userId === userId,
      );
      if (!exists) {
        state.tripMembers.push({ tripId, userId, role: "member" });
      }
    },
    getSharePreview: async ({ token }: { token: string }) => {
      const trip = state.trips.find(
        (entry) =>
          entry.shareInviteToken !== null && entry.shareInviteToken === token,
      );
      if (!trip) {
        return null;
      }
      return {
        tripId: trip.id,
        tripName: trip.name,
        destinationName: trip.destinationName,
        startDate: trip.startDate,
        endDate: trip.endDate,
        enabled: trip.shareInviteEnabled,
      };
    },
  };

  return { state, store: store as TripStore };
}

describe("getOrCreateShareLink", () => {
  it("generates and returns a stable share token with the right url shape", async () => {
    const { state, store } = createShareStore({ trips: [makeTrip()] });

    const first = await getOrCreateShareLink(store, {
      tripId: "trip_1",
      tripRole: "organizer",
    });

    expect(first.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(first.url).toBe(`https://sortey.app/join/${first.token}`);
    expect(first.enabled).toBe(true);
    expect(state.trips[0]?.shareInviteToken).toBe(first.token);

    const second = await getOrCreateShareLink(store, {
      tripId: "trip_1",
      tripRole: "organizer",
    });

    // stable, not regenerated
    expect(second.token).toBe(first.token);
    expect(second.url).toBe(first.url);
  });

  it("preserves a disabled flag when returning an existing token", async () => {
    const { store } = createShareStore({
      trips: [
        makeTrip({
          shareInviteToken: "existing-token",
          shareInviteEnabled: false,
        }),
      ],
    });

    const result = await getOrCreateShareLink(store, {
      tripId: "trip_1",
      tripRole: "organizer",
    });

    expect(result.token).toBe("existing-token");
    expect(result.enabled).toBe(false);
    expect(result.url).toBe("https://sortey.app/join/existing-token");
  });

  it("generates a token AND returns enabled:true when the existing row has a null token but enabled=false", async () => {
    const { state, store } = createShareStore({
      trips: [
        makeTrip({
          shareInviteToken: null,
          shareInviteEnabled: false,
        }),
      ],
    });

    const result = await getOrCreateShareLink(store, {
      tripId: "trip_1",
      tripRole: "organizer",
    });

    // A fresh share link was minted...
    expect(result.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(state.trips[0]?.shareInviteToken).toBe(result.token);
    // ...and generating it re-enables the link (the re-enable contract).
    expect(result.enabled).toBe(true);
    expect(result.url).toBe(`https://sortey.app/join/${result.token}`);
  });

  it("rejects non-organizers", async () => {
    const { store } = createShareStore({ trips: [makeTrip()] });

    await expect(
      getOrCreateShareLink(store, {
        tripId: "trip_1",
        tripRole: "member",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("regenerateShareLink", () => {
  it("rotates to a DIFFERENT token than the current share link", async () => {
    const { state, store } = createShareStore({ trips: [makeTrip()] });

    const first = await getOrCreateShareLink(store, {
      tripId: "trip_1",
      tripRole: "organizer",
    });

    const rotated = await regenerateShareLink(store, {
      tripId: "trip_1",
      tripRole: "organizer",
    });

    expect(rotated.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(rotated.token).not.toBe(first.token);
    expect(rotated.url).toBe(`https://sortey.app/join/${rotated.token}`);
    expect(rotated.enabled).toBe(true);
    // The new token is persisted (old links die).
    expect(state.trips[0]?.shareInviteToken).toBe(rotated.token);
  });

  it("re-enables a disabled link when regenerating", async () => {
    const { state, store } = createShareStore({
      trips: [
        makeTrip({
          shareInviteToken: "old-token",
          shareInviteEnabled: false,
        }),
      ],
    });

    const rotated = await regenerateShareLink(store, {
      tripId: "trip_1",
      tripRole: "organizer",
    });

    expect(rotated.token).not.toBe("old-token");
    expect(rotated.enabled).toBe(true);
    expect(state.trips[0]?.shareInviteEnabled).toBe(true);
    expect(state.trips[0]?.shareInviteToken).toBe(rotated.token);
  });

  it("rejects non-organizers", async () => {
    const { store } = createShareStore({ trips: [makeTrip()] });

    await expect(
      regenerateShareLink(store, {
        tripId: "trip_1",
        tripRole: "member",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("setShareLinkEnabled", () => {
  it("toggles the enabled flag off", async () => {
    const { state, store } = createShareStore({
      trips: [makeTrip({ shareInviteToken: "tok", shareInviteEnabled: true })],
    });

    const result = await setShareLinkEnabled(store, {
      tripId: "trip_1",
      tripRole: "organizer",
      enabled: false,
    });

    expect(result.enabled).toBe(false);
    expect(state.trips[0]?.shareInviteEnabled).toBe(false);
  });

  it("toggles the enabled flag back on", async () => {
    const { state, store } = createShareStore({
      trips: [makeTrip({ shareInviteToken: "tok", shareInviteEnabled: false })],
    });

    const result = await setShareLinkEnabled(store, {
      tripId: "trip_1",
      tripRole: "organizer",
      enabled: true,
    });

    expect(result.enabled).toBe(true);
    expect(state.trips[0]?.shareInviteEnabled).toBe(true);
  });

  it("rejects non-organizers", async () => {
    const { store } = createShareStore({ trips: [makeTrip()] });

    await expect(
      setShareLinkEnabled(store, {
        tripId: "trip_1",
        tripRole: "member",
        enabled: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("joinTripByShareToken", () => {
  it("adds workspace + trip membership for a new joiner (happy path)", async () => {
    const { state, store } = createShareStore({
      trips: [
        makeTrip({
          shareInviteToken: "live-token",
          shareInviteEnabled: true,
          status: "active",
        }),
      ],
    });

    const result = await joinTripByShareToken(store, {
      token: "live-token",
      userId: "stranger_1",
    });

    expect(result).toEqual({
      tripId: "trip_1",
      workspaceId: "workspace_1",
    });
    expect(
      state.workspaceMemberships.some(
        (m) => m.workspaceId === "workspace_1" && m.userId === "stranger_1",
      ),
    ).toBe(true);
    expect(
      state.tripMembers.some(
        (m) => m.tripId === "trip_1" && m.userId === "stranger_1",
      ),
    ).toBe(true);
  });

  it("is idempotent for an already-member (no duplicate, no throw)", async () => {
    const { state, store } = createShareStore({
      trips: [
        makeTrip({
          shareInviteToken: "live-token",
          shareInviteEnabled: true,
          status: "active",
        }),
      ],
      workspaceMemberships: [
        { workspaceId: "workspace_1", userId: "stranger_1", role: "member" },
      ],
      tripMembers: [{ tripId: "trip_1", userId: "stranger_1", role: "member" }],
    });

    const result = await joinTripByShareToken(store, {
      token: "live-token",
      userId: "stranger_1",
    });

    expect(result).toEqual({
      tripId: "trip_1",
      workspaceId: "workspace_1",
    });
    // No duplicates were created.
    expect(
      state.workspaceMemberships.filter((m) => m.userId === "stranger_1"),
    ).toHaveLength(1);
    expect(
      state.tripMembers.filter((m) => m.userId === "stranger_1"),
    ).toHaveLength(1);
  });

  it("rejects a disabled token", async () => {
    const { store } = createShareStore({
      trips: [
        makeTrip({
          shareInviteToken: "disabled-token",
          shareInviteEnabled: false,
          status: "active",
        }),
      ],
    });

    await expect(
      joinTripByShareToken(store, {
        token: "disabled-token",
        userId: "stranger_1",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects an unknown token", async () => {
    const { store } = createShareStore({
      trips: [
        makeTrip({
          shareInviteToken: "live-token",
          shareInviteEnabled: true,
          status: "active",
        }),
      ],
    });

    await expect(
      joinTripByShareToken(store, {
        token: "nope",
        userId: "stranger_1",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a completed trip", async () => {
    const { store } = createShareStore({
      trips: [
        makeTrip({
          shareInviteToken: "live-token",
          shareInviteEnabled: true,
          status: "completed",
        }),
      ],
    });

    await expect(
      joinTripByShareToken(store, {
        token: "live-token",
        userId: "stranger_1",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("getShareLinkPreview", () => {
  it("returns an active preview for a valid + enabled token (no secrets)", async () => {
    const { store } = createShareStore({
      trips: [
        makeTrip({
          shareInviteToken: "live-token",
          shareInviteEnabled: true,
          destinationName: "Milan",
          startDate: "2026-07-01",
          endDate: "2026-07-10",
        }),
      ],
    });

    const preview = await getShareLinkPreview(store, { token: "live-token" });

    expect(preview).toEqual({
      status: "active",
      tripId: "trip_1",
      tripName: "Italy Summer",
      destinationName: "Milan",
      startDate: "2026-07-01",
      endDate: "2026-07-10",
    });
    // Never leak the token or any secret.
    expect(JSON.stringify(preview)).not.toContain("live-token");
  });

  it("returns disabled for a disabled token", async () => {
    const { store } = createShareStore({
      trips: [
        makeTrip({
          shareInviteToken: "disabled-token",
          shareInviteEnabled: false,
        }),
      ],
    });

    const preview = await getShareLinkPreview(store, {
      token: "disabled-token",
    });

    expect(preview).toEqual({ status: "disabled" });
  });

  it("returns not_found for an unknown token", async () => {
    const { store } = createShareStore({
      trips: [
        makeTrip({
          shareInviteToken: "live-token",
          shareInviteEnabled: true,
        }),
      ],
    });

    const preview = await getShareLinkPreview(store, { token: "nope" });

    expect(preview).toEqual({ status: "not_found" });
  });
});
