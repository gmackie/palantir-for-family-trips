import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { TripAccessStore } from "../../auth/guards";
import type { TripStore } from "../trips";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/gmacko_test";

const { resolveTripAccess, resolveWorkspaceAccess } = await import(
  "../../auth/guards"
);
const {
  createTripRecord,
  listWorkspaceTrips,
  setTripClaimMode,
  setTripGroupMode,
  updateTripRecord,
} = await import("../trips");

type WorkspaceRole = "owner" | "admin" | "member";
type TripRole = "organizer" | "member";
type TripStatus = "planning" | "confirmed" | "active" | "completed";
type ClaimMode = "organizer" | "tap";

type WorkspaceMembershipRecord = {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
};

type TripRecord = {
  id: string;
  workspaceId: string;
  name: string;
  createdByUserId: string;
  status: TripStatus;
  groupMode: boolean;
  claimMode: ClaimMode;
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

type TripMemberRecord = {
  id: string;
  tripId: string;
  userId: string;
  role: TripRole;
  displayName: string | null;
  colorHex: string | null;
  venmoHandle: string | null;
  joinedAt: Date;
};

type TripSegmentRecord = {
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
  createdAt: Date;
  updatedAt: Date | null;
};

type SegmentMemberRecord = {
  id: string;
  segmentId: string;
  userId: string;
};

function createAccessStore(input?: {
  workspaceMemberships?: WorkspaceMembershipRecord[];
  trips?: TripRecord[];
  tripMembers?: TripMemberRecord[];
}) {
  const state = {
    workspaceMemberships: [...(input?.workspaceMemberships ?? [])],
    trips: [...(input?.trips ?? [])],
    tripMembers: [...(input?.tripMembers ?? [])],
  };

  const store: TripAccessStore = {
    findWorkspaceAccess: async ({
      userId,
      workspaceId,
    }: {
      userId: string;
      workspaceId: string;
    }) => {
      const membership =
        state.workspaceMemberships.find(
          (entry) =>
            entry.userId === userId && entry.workspaceId === workspaceId,
        ) ?? null;

      return membership
        ? {
            workspaceId: membership.workspaceId,
            workspaceRole: membership.role,
          }
        : null;
    },
    findTripAccess: async ({
      userId,
      workspaceId,
      tripId,
    }: {
      userId: string;
      workspaceId: string;
      tripId: string;
    }) => {
      const trip =
        state.trips.find(
          (entry) => entry.id === tripId && entry.workspaceId === workspaceId,
        ) ?? null;
      const member =
        state.tripMembers.find(
          (entry) => entry.tripId === tripId && entry.userId === userId,
        ) ?? null;
      const workspaceMembership =
        state.workspaceMemberships.find(
          (entry) =>
            entry.userId === userId && entry.workspaceId === workspaceId,
        ) ?? null;

      if (!trip || !member || !workspaceMembership) {
        return null;
      }

      return {
        tripId: trip.id,
        tripRole: member.role,
        workspaceId,
        workspaceRole: workspaceMembership.role,
      };
    },
  };

  return { state, store };
}

function createTripStore(input?: {
  trips?: TripRecord[];
  tripMembers?: TripMemberRecord[];
  tripSegments?: TripSegmentRecord[];
  segmentMembers?: SegmentMemberRecord[];
}) {
  const state = {
    trips: [...(input?.trips ?? [])],
    tripMembers: [...(input?.tripMembers ?? [])],
    tripSegments: [...(input?.tripSegments ?? [])],
    segmentMembers: [...(input?.segmentMembers ?? [])],
  };

  const store: TripStore = {
    createTrip: async (input: {
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
    }) => {
      const trip: TripRecord = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        name: input.name,
        createdByUserId: input.createdByUserId,
        status: "planning",
        groupMode: input.groupMode ?? false,
        claimMode: "organizer",
        destinationName: input.destinationName ?? null,
        destinationLat: input.destinationLat ?? null,
        destinationLng: input.destinationLng ?? null,
        defaultZoom: 13,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        tz: input.tz ?? "UTC",
        createdAt: new Date("2026-04-15T12:00:00.000Z"),
        updatedAt: null,
      };

      state.trips.push(trip);
      return trip;
    },
    createTripMember: async (input: {
      tripId: string;
      userId: string;
      role: "organizer" | "member";
    }) => {
      const member: TripMemberRecord = {
        id: randomUUID(),
        tripId: input.tripId,
        userId: input.userId,
        role: input.role,
        displayName: null,
        colorHex: null,
        venmoHandle: null,
        joinedAt: new Date("2026-04-15T12:00:00.000Z"),
      };

      state.tripMembers.push(member);
      return member;
    },
    createTripSegment: async (input: {
      tripId: string;
      name: string;
      destinationName?: string;
      destinationLat?: string;
      destinationLng?: string;
      startDate?: string;
      endDate?: string;
      tz?: string;
      sortOrder: number;
    }) => {
      const segment: TripSegmentRecord = {
        id: randomUUID(),
        tripId: input.tripId,
        name: input.name,
        destinationName: input.destinationName ?? null,
        destinationLat: input.destinationLat ?? null,
        destinationLng: input.destinationLng ?? null,
        defaultZoom: 13,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        tz: input.tz ?? "UTC",
        sortOrder: input.sortOrder,
        createdAt: new Date("2026-04-15T12:00:00.000Z"),
        updatedAt: null,
      };

      state.tripSegments.push(segment);
      return segment;
    },
    createSegmentMember: async (input: {
      segmentId: string;
      userId: string;
    }) => {
      const segmentMember: SegmentMemberRecord = {
        id: randomUUID(),
        segmentId: input.segmentId,
        userId: input.userId,
      };

      state.segmentMembers.push(segmentMember);
      return segmentMember;
    },
    listWorkspaceTrips: async ({
      userId,
      workspaceId,
    }: {
      userId: string;
      workspaceId: string;
    }) =>
      state.trips
        .filter((trip) => trip.workspaceId === workspaceId)
        .filter((trip) =>
          state.tripMembers.some(
            (member) => member.tripId === trip.id && member.userId === userId,
          ),
        )
        .sort(
          (left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime() ||
            left.id.localeCompare(right.id),
        ),
    getTrip: async ({
      workspaceId,
      tripId,
    }: {
      workspaceId: string;
      tripId: string;
    }) =>
      state.trips.find(
        (trip) => trip.workspaceId === workspaceId && trip.id === tripId,
      ) ?? null,
    updateTrip: async ({
      workspaceId,
      tripId,
      ...changes
    }: {
      workspaceId: string;
      tripId: string;
      name?: string;
      destinationName?: string;
      startDate?: string;
      endDate?: string;
      tz?: string;
      groupMode?: boolean;
      claimMode?: "organizer" | "tap";
    }) => {
      const index = state.trips.findIndex(
        (trip) => trip.workspaceId === workspaceId && trip.id === tripId,
      );

      if (index === -1) {
        return null;
      }

      state.trips[index] = {
        ...state.trips[index]!,
        ...changes,
        updatedAt: new Date("2026-04-16T08:00:00.000Z"),
      };

      return state.trips[index]!;
    },
  };

  return { state, store };
}

describe("trip guards", () => {
  it("resolves workspace access for a member", async () => {
    const { store } = createAccessStore({
      workspaceMemberships: [
        {
          workspaceId: "workspace_1",
          userId: "user_1",
          role: "admin",
        },
      ],
    });

    await expect(
      resolveWorkspaceAccess(store, {
        userId: "user_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual({
      workspaceId: "workspace_1",
      workspaceRole: "admin",
    });
  });

  it("rejects cross-trip access when the user is not a member of the trip", async () => {
    const { store } = createAccessStore({
      workspaceMemberships: [
        {
          workspaceId: "workspace_1",
          userId: "user_1",
          role: "owner",
        },
      ],
      trips: [
        {
          id: "trip_1",
          workspaceId: "workspace_1",
          name: "Milan",
          createdByUserId: "user_2",
          status: "planning",
          groupMode: false,
          claimMode: "organizer",
          destinationName: "Milan",
          destinationLat: "45.4642",
          destinationLng: "9.1900",
          defaultZoom: 13,
          startDate: "2026-06-01",
          endDate: "2026-06-08",
          tz: "Europe/Rome",
          createdAt: new Date("2026-04-01T00:00:00.000Z"),
          updatedAt: null,
        },
      ],
    });

    await expect(
      resolveTripAccess(store, {
        userId: "user_1",
        workspaceId: "workspace_1",
        tripId: "trip_1",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("trip creation", () => {
  it("creates a planning trip, an organizer membership, and an initial segment", async () => {
    const { state, store } = createTripStore();

    const created = await createTripRecord(store, {
      workspaceId: "workspace_1",
      createdByUserId: "user_1",
      name: "Italy Summer",
      destinationName: "Milan",
      destinationLat: "45.4642",
      destinationLng: "9.1900",
      startDate: "2026-06-01",
      endDate: "2026-06-08",
      tz: "Europe/Rome",
    });

    expect(created.trip.status).toBe("planning");
    expect(created.trip.claimMode).toBe("organizer");
    expect(created.trip.tz).toBe("Europe/Rome");
    expect(created.member.role).toBe("organizer");
    expect(created.segment.name).toBe("Milan");
    expect(created.segmentMember.userId).toBe("user_1");
    expect(state.trips).toHaveLength(1);
    expect(state.tripMembers).toHaveLength(1);
    expect(state.tripSegments).toHaveLength(1);
    expect(state.segmentMembers).toHaveLength(1);
  });

  it("lists only trips the user belongs to inside the requested workspace", async () => {
    const { store } = createTripStore({
      trips: [
        {
          id: "trip_1",
          workspaceId: "workspace_1",
          name: "Milan",
          createdByUserId: "user_1",
          status: "planning",
          groupMode: false,
          claimMode: "organizer",
          destinationName: "Milan",
          destinationLat: null,
          destinationLng: null,
          defaultZoom: 13,
          startDate: null,
          endDate: null,
          tz: "Europe/Rome",
          createdAt: new Date("2026-04-10T00:00:00.000Z"),
          updatedAt: null,
        },
        {
          id: "trip_2",
          workspaceId: "workspace_1",
          name: "Florence",
          createdByUserId: "user_2",
          status: "planning",
          groupMode: false,
          claimMode: "organizer",
          destinationName: "Florence",
          destinationLat: null,
          destinationLng: null,
          defaultZoom: 13,
          startDate: null,
          endDate: null,
          tz: "Europe/Rome",
          createdAt: new Date("2026-04-11T00:00:00.000Z"),
          updatedAt: null,
        },
        {
          id: "trip_3",
          workspaceId: "workspace_2",
          name: "Paris",
          createdByUserId: "user_1",
          status: "planning",
          groupMode: false,
          claimMode: "organizer",
          destinationName: "Paris",
          destinationLat: null,
          destinationLng: null,
          defaultZoom: 13,
          startDate: null,
          endDate: null,
          tz: "Europe/Paris",
          createdAt: new Date("2026-04-12T00:00:00.000Z"),
          updatedAt: null,
        },
      ],
      tripMembers: [
        {
          id: "member_1",
          tripId: "trip_1",
          userId: "user_1",
          role: "organizer",
          displayName: null,
          colorHex: null,
          venmoHandle: null,
          joinedAt: new Date("2026-04-10T00:00:00.000Z"),
        },
        {
          id: "member_2",
          tripId: "trip_2",
          userId: "user_2",
          role: "organizer",
          displayName: null,
          colorHex: null,
          venmoHandle: null,
          joinedAt: new Date("2026-04-11T00:00:00.000Z"),
        },
        {
          id: "member_3",
          tripId: "trip_3",
          userId: "user_1",
          role: "organizer",
          displayName: null,
          colorHex: null,
          venmoHandle: null,
          joinedAt: new Date("2026-04-12T00:00:00.000Z"),
        },
      ],
    });

    await expect(
      listWorkspaceTrips(store, {
        userId: "user_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toMatchObject([
      {
        id: "trip_1",
        workspaceId: "workspace_1",
        name: "Milan",
      },
    ]);
  });
});

describe("trip updates", () => {
  it("lets an organizer update the trip settings", async () => {
    const { state, store } = createTripStore({
      trips: [
        {
          id: "trip_1",
          workspaceId: "workspace_1",
          name: "Italy Summer",
          createdByUserId: "user_1",
          status: "planning",
          groupMode: false,
          claimMode: "organizer",
          destinationName: "Milan",
          destinationLat: null,
          destinationLng: null,
          defaultZoom: 13,
          startDate: "2026-06-01",
          endDate: "2026-06-08",
          tz: "Europe/Rome",
          createdAt: new Date("2026-04-10T00:00:00.000Z"),
          updatedAt: null,
        },
      ],
    });

    const updated = await updateTripRecord(store, {
      workspaceId: "workspace_1",
      tripId: "trip_1",
      tripRole: "organizer",
      name: "Italy Summer Reset",
      destinationName: "Florence",
      startDate: "2026-06-02",
      endDate: "2026-06-09",
      tz: "Europe/Paris",
    });

    expect(updated.name).toBe("Italy Summer Reset");
    expect(updated.destinationName).toBe("Florence");
    expect(updated.startDate).toBe("2026-06-02");
    expect(updated.endDate).toBe("2026-06-09");
    expect(updated.tz).toBe("Europe/Paris");
    expect(state.trips[0]?.updatedAt).not.toBeNull();
  });

  it("rejects settings updates from non-organizers", async () => {
    const { store } = createTripStore({
      trips: [
        {
          id: "trip_1",
          workspaceId: "workspace_1",
          name: "Italy Summer",
          createdByUserId: "user_1",
          status: "planning",
          groupMode: false,
          claimMode: "organizer",
          destinationName: "Milan",
          destinationLat: null,
          destinationLng: null,
          defaultZoom: 13,
          startDate: null,
          endDate: null,
          tz: "Europe/Rome",
          createdAt: new Date("2026-04-10T00:00:00.000Z"),
          updatedAt: null,
        },
      ],
    });

    await expect(
      updateTripRecord(store, {
        workspaceId: "workspace_1",
        tripId: "trip_1",
        tripRole: "member",
        name: "Blocked Edit",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("updates group mode and claim mode with organizer-only helpers", async () => {
    const { store } = createTripStore({
      trips: [
        {
          id: "trip_1",
          workspaceId: "workspace_1",
          name: "Italy Summer",
          createdByUserId: "user_1",
          status: "planning",
          groupMode: false,
          claimMode: "organizer",
          destinationName: "Milan",
          destinationLat: null,
          destinationLng: null,
          defaultZoom: 13,
          startDate: null,
          endDate: null,
          tz: "Europe/Rome",
          createdAt: new Date("2026-04-10T00:00:00.000Z"),
          updatedAt: null,
        },
      ],
    });

    const grouped = await setTripGroupMode(store, {
      workspaceId: "workspace_1",
      tripId: "trip_1",
      tripRole: "organizer",
      groupMode: true,
    });
    const claimed = await setTripClaimMode(store, {
      workspaceId: "workspace_1",
      tripId: "trip_1",
      tripRole: "organizer",
      claimMode: "tap",
    });

    expect(grouped.groupMode).toBe(true);
    expect(claimed.claimMode).toBe("tap");
  });
});
