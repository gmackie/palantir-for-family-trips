import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { TripAccessStore } from "../../auth/guards";
import type { RoomOccupantRow, RoomRow, RoomStore } from "../rooms";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/gmacko_test";

const { resolveTripAccess } = await import("../../auth/guards");
const {
  assertRoomInTrip,
  assignOccupant,
  createRoom,
  deleteRoom,
  listRoomsWithOccupants,
  removeOccupant,
} = await import("../rooms");

type WorkspaceRole = "owner" | "admin" | "member";
type TripRole = "organizer" | "member";

type WorkspaceMembershipRecord = {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
};

type TripRecord = { id: string; workspaceId: string };
type TripMemberRecord = { tripId: string; userId: string; role: TripRole };

// ── Guard access store fake (mirrors ferries.test.ts) ────────────────────────

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
    findWorkspaceAccess: async ({ userId, workspaceId }) => {
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
    findTripAccess: async ({ userId, workspaceId, tripId }) => {
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

// ── Room store fake ──────────────────────────────────────────────────────────

type LodgingRecord = { id: string; segmentId: string };
type SegmentRecord = { id: string; tripId: string };

function createRoomStore(input?: {
  lodgings?: LodgingRecord[];
  segments?: SegmentRecord[];
  rooms?: RoomRow[];
  occupants?: RoomOccupantRow[];
}) {
  const state = {
    lodgings: [...(input?.lodgings ?? [])],
    segments: [...(input?.segments ?? [])],
    rooms: [...(input?.rooms ?? [])],
    occupants: [...(input?.occupants ?? [])],
  };

  const store: RoomStore = {
    getLodgingSegment: async (lodgingId) => {
      const lodging = state.lodgings.find((l) => l.id === lodgingId) ?? null;
      return lodging ? { segmentId: lodging.segmentId } : null;
    },
    segmentBelongsToTrip: async ({ segmentId, tripId }) =>
      state.segments.some((s) => s.id === segmentId && s.tripId === tripId),
    getRoomLodging: async (roomId) => {
      const room = state.rooms.find((r) => r.id === roomId) ?? null;
      return room ? { lodgingId: room.lodgingId } : null;
    },
    listRoomsForLodging: async (lodgingId) =>
      state.rooms.filter((r) => r.lodgingId === lodgingId),
    listOccupants: async (roomIds) =>
      state.occupants.filter((o) => roomIds.includes(o.roomAssignmentId)),
    insertRoom: async ({ lodgingId, roomLabel, sortOrder }) => {
      const row: RoomRow = {
        id: randomUUID(),
        lodgingId,
        roomLabel,
        sortOrder,
        createdAt: new Date("2026-06-21T12:00:00.000Z"),
      };
      state.rooms.push(row);
      return row;
    },
    deleteRoom: async (roomId) => {
      state.rooms = state.rooms.filter((r) => r.id !== roomId);
    },
    insertOccupant: async (roomId, userId) => {
      // Idempotent: unique(room, user) — mirror onConflictDoNothing.
      const exists = state.occupants.some(
        (o) => o.roomAssignmentId === roomId && o.userId === userId,
      );
      if (exists) return;
      state.occupants.push({
        id: randomUUID(),
        roomAssignmentId: roomId,
        userId,
      });
    },
    removeOccupant: async (roomId, userId) => {
      state.occupants = state.occupants.filter(
        (o) => !(o.roomAssignmentId === roomId && o.userId === userId),
      );
    },
  };

  return { state, store };
}

function makeRoomRow(overrides: Partial<RoomRow> & { id: string }): RoomRow {
  return {
    lodgingId: "lodging_1",
    roomLabel: "Room",
    sortOrder: 0,
    createdAt: new Date("2026-06-21T12:00:00.000Z"),
    ...overrides,
  };
}

// trip_1 owns lodging_1 (via seg_1); trip_2 owns lodging_2 (via seg_2).
function tripScopedFixture(extra?: {
  rooms?: RoomRow[];
  occupants?: RoomOccupantRow[];
}) {
  return createRoomStore({
    lodgings: [
      { id: "lodging_1", segmentId: "seg_1" },
      { id: "lodging_2", segmentId: "seg_2" },
    ],
    segments: [
      { id: "seg_1", tripId: "trip_1" },
      { id: "seg_2", tripId: "trip_2" },
    ],
    rooms: extra?.rooms,
    occupants: extra?.occupants,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("rooms router — guard", () => {
  it("rejects a non-member resolving trip access", async () => {
    const { store } = createAccessStore({
      workspaceMemberships: [
        { workspaceId: "ws_1", userId: "user_1", role: "owner" },
      ],
      trips: [{ id: "trip_1", workspaceId: "ws_1" }],
      // user_1 is a workspace member but NOT a trip member
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

describe("rooms router — createRoom + cross-trip guard", () => {
  it("creates a room on a lodging that belongs to the trip", async () => {
    const { state, store } = tripScopedFixture();

    const created = await createRoom(store, {
      tripId: "trip_1",
      lodgingId: "lodging_1",
      roomLabel: "Primary Bedroom",
      sortOrder: 2,
    });

    expect(created.lodgingId).toBe("lodging_1");
    expect(created.roomLabel).toBe("Primary Bedroom");
    expect(created.sortOrder).toBe(2);
    expect(state.rooms).toHaveLength(1);
  });

  it("defaults sortOrder to 0 when omitted", async () => {
    const { store } = tripScopedFixture();

    const created = await createRoom(store, {
      tripId: "trip_1",
      lodgingId: "lodging_1",
      roomLabel: "Bunk Room",
    });

    expect(created.sortOrder).toBe(0);
  });

  // The key security case: a lodging owned by another trip must be rejected
  // with BAD_REQUEST, and nothing is written.
  it("rejects creating a room on a lodging from a foreign trip (BAD_REQUEST)", async () => {
    const { state, store } = tripScopedFixture();

    await expect(
      createRoom(store, {
        tripId: "trip_1",
        lodgingId: "lodging_2", // belongs to trip_2
        roomLabel: "Sneaky Room",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(state.rooms).toHaveLength(0);
  });

  it("rejects creating a room on a missing lodging (NOT_FOUND)", async () => {
    const { store } = tripScopedFixture();

    await expect(
      createRoom(store, {
        tripId: "trip_1",
        lodgingId: "lodging_missing",
        roomLabel: "Ghost Room",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("rooms router — assertRoomInTrip", () => {
  it("resolves the lodging for a room in the trip", async () => {
    const { store } = tripScopedFixture({
      rooms: [makeRoomRow({ id: "room_1", lodgingId: "lodging_1" })],
    });

    const result = await assertRoomInTrip(store, "room_1", "trip_1");
    expect(result.lodgingId).toBe("lodging_1");
  });

  it("rejects a room whose lodging belongs to another trip (BAD_REQUEST)", async () => {
    const { store } = tripScopedFixture({
      rooms: [makeRoomRow({ id: "room_2", lodgingId: "lodging_2" })],
    });

    await expect(
      assertRoomInTrip(store, "room_2", "trip_1"),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a missing room (NOT_FOUND)", async () => {
    const { store } = tripScopedFixture();

    await expect(
      assertRoomInTrip(store, "room_missing", "trip_1"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("rooms router — deleteRoom", () => {
  it("deletes a room that belongs to the trip", async () => {
    const { state, store } = tripScopedFixture({
      rooms: [makeRoomRow({ id: "room_1", lodgingId: "lodging_1" })],
    });

    const result = await deleteRoom(store, {
      tripId: "trip_1",
      roomId: "room_1",
    });

    expect(result.ok).toBe(true);
    expect(state.rooms).toHaveLength(0);
  });

  it("refuses to delete a room from a foreign trip (BAD_REQUEST)", async () => {
    const { state, store } = tripScopedFixture({
      rooms: [makeRoomRow({ id: "room_2", lodgingId: "lodging_2" })],
    });

    await expect(
      deleteRoom(store, { tripId: "trip_1", roomId: "room_2" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(state.rooms).toHaveLength(1);
  });
});

describe("rooms router — assignOccupant / removeOccupant", () => {
  it("assigns an occupant to a room in the trip", async () => {
    const { state, store } = tripScopedFixture({
      rooms: [makeRoomRow({ id: "room_1", lodgingId: "lodging_1" })],
    });

    await assignOccupant(store, {
      tripId: "trip_1",
      roomId: "room_1",
      userId: "user_1",
    });

    expect(state.occupants).toHaveLength(1);
    expect(state.occupants[0]!.userId).toBe("user_1");
  });

  it("is idempotent: assigning the same user twice does not duplicate", async () => {
    const { state, store } = tripScopedFixture({
      rooms: [makeRoomRow({ id: "room_1", lodgingId: "lodging_1" })],
    });

    await assignOccupant(store, {
      tripId: "trip_1",
      roomId: "room_1",
      userId: "user_1",
    });
    await assignOccupant(store, {
      tripId: "trip_1",
      roomId: "room_1",
      userId: "user_1",
    });

    expect(state.occupants).toHaveLength(1);
  });

  it("removeOccupant removes only the target user", async () => {
    const { state, store } = tripScopedFixture({
      rooms: [makeRoomRow({ id: "room_1", lodgingId: "lodging_1" })],
      occupants: [
        { id: "occ_1", roomAssignmentId: "room_1", userId: "user_1" },
        { id: "occ_2", roomAssignmentId: "room_1", userId: "user_2" },
      ],
    });

    await removeOccupant(store, {
      tripId: "trip_1",
      roomId: "room_1",
      userId: "user_1",
    });

    expect(state.occupants).toHaveLength(1);
    expect(state.occupants[0]!.userId).toBe("user_2");
  });

  it("rejects assigning an occupant to a room from a foreign trip", async () => {
    const { state, store } = tripScopedFixture({
      rooms: [makeRoomRow({ id: "room_2", lodgingId: "lodging_2" })],
    });

    await expect(
      assignOccupant(store, {
        tripId: "trip_1",
        roomId: "room_2",
        userId: "user_1",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(state.occupants).toHaveLength(0);
  });
});

describe("rooms router — listRoomsWithOccupants", () => {
  it("returns rooms ordered by sortOrder with their occupants grouped", async () => {
    const { store } = tripScopedFixture({
      rooms: [
        makeRoomRow({ id: "room_b", lodgingId: "lodging_1", sortOrder: 2 }),
        makeRoomRow({ id: "room_a", lodgingId: "lodging_1", sortOrder: 1 }),
        makeRoomRow({ id: "room_c", lodgingId: "lodging_1", sortOrder: 3 }),
      ],
      occupants: [
        { id: "occ_1", roomAssignmentId: "room_a", userId: "user_1" },
        { id: "occ_2", roomAssignmentId: "room_a", userId: "user_2" },
        { id: "occ_3", roomAssignmentId: "room_b", userId: "user_3" },
        // room_c has no occupants
      ],
    });

    const result = await listRoomsWithOccupants(store, {
      tripId: "trip_1",
      lodgingId: "lodging_1",
    });

    expect(result.map((r) => r.id)).toEqual(["room_a", "room_b", "room_c"]);
    expect(result[0]!.occupants.map((o) => o.userId)).toEqual([
      "user_1",
      "user_2",
    ]);
    expect(result[1]!.occupants.map((o) => o.userId)).toEqual(["user_3"]);
    expect(result[2]!.occupants).toEqual([]);
  });

  it("rejects listing rooms for a lodging from a foreign trip (BAD_REQUEST)", async () => {
    const { store } = tripScopedFixture();

    await expect(
      listRoomsWithOccupants(store, {
        tripId: "trip_1",
        lodgingId: "lodging_2",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects listing rooms for a missing lodging (NOT_FOUND)", async () => {
    const { store } = tripScopedFixture();

    await expect(
      listRoomsWithOccupants(store, {
        tripId: "trip_1",
        lodgingId: "lodging_missing",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
