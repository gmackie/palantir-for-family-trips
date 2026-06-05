import { describe, expect, it } from "vitest";
import type { TripStore } from "../trips";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/gmacko_test";

const { getOrCreateShareLink } = await import("../trips");

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

function createShareStore(input?: { trips?: TripRecord[] }) {
  const state = {
    trips: [...(input?.trips ?? [])],
  };

  const store: Pick<TripStore, "getShareInfo" | "setShareToken"> = {
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
        return;
      }
      state.trips[index] = {
        ...state.trips[index]!,
        shareInviteToken: token,
        shareInviteEnabled: true,
        shareInviteCreatedAt: new Date("2026-04-16T08:00:00.000Z"),
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
