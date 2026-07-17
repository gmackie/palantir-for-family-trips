import { describe, expect, it } from "vitest";

import {
  createDefaultTripDashboardState,
  mergeTripDashboardState,
  parseLegacyLocalStorageState,
  type TripDashboardState,
} from "../dashboard-state";
import {
  createTripMemberStateStore,
  getTripDashboardState,
  type TripMemberStateStore,
  updateTripDashboardState,
} from "../dashboard-state-store";

describe("trip dashboard state", () => {
  it("creates stable defaults", () => {
    expect(createDefaultTripDashboardState()).toEqual({
      activeNav: "overview",
      timelineOpen: true,
      viewerMemberId: null,
      selectedEntityId: null,
      pageNotes: {},
      ui: {
        searchQuery: "",
        timeline: { mode: "scenario", cursorSlot: 3 },
        map: {
          showRoutes: true,
          showFacilities: true,
          showTraffic: false,
          focusMemberId: "all",
          focusDayId: "all",
        },
      },
    });
  });

  it("maps legacy localStorage trip document fields", () => {
    const patch = parseLegacyLocalStorageState({
      tripDocumentRaw: JSON.stringify({
        selectedPage: "meals",
        selection: { entityId: "pin_123" },
        pageNotes: { meals: "Keep Friday easy." },
        ui: {
          searchQuery: "pizza",
          timeline: { mode: "live", cursorSlot: 5 },
          map: {
            showRoutes: false,
            showFacilities: true,
            showTraffic: true,
            focusFamilyId: "family_a",
            focusDayId: "day_2",
          },
        },
      }),
      viewerProfileRaw: JSON.stringify({ familyId: "family_a" }),
    });

    expect(patch).toEqual({
      activeNav: "meals",
      selectedEntityId: "pin_123",
      pageNotes: { meals: "Keep Friday easy." },
      viewerMemberId: "family_a",
      ui: {
        searchQuery: "pizza",
        timeline: { mode: "live", cursorSlot: 5 },
        map: {
          showRoutes: false,
          showFacilities: true,
          showTraffic: true,
          focusMemberId: "family_a",
          focusDayId: "day_2",
        },
      },
    });
  });

  it("deep-merges nested ui and page notes", () => {
    const current = createDefaultTripDashboardState({
      pageNotes: { meals: "Old note" },
      ui: {
        searchQuery: "old",
        timeline: { mode: "scenario", cursorSlot: 1 },
        map: {
          showRoutes: true,
          showFacilities: false,
          showTraffic: false,
          focusMemberId: "all",
          focusDayId: "all",
        },
      },
    });

    const next = mergeTripDashboardState(current, {
      pageNotes: { stay: "New note" },
      ui: {
        searchQuery: "new",
        map: { showTraffic: true },
      },
    });

    expect(next.pageNotes).toEqual({
      meals: "Old note",
      stay: "New note",
    });
    expect(next.ui.searchQuery).toBe("new");
    expect(next.ui.timeline).toEqual({ mode: "scenario", cursorSlot: 1 });
    expect(next.ui.map.showTraffic).toBe(true);
    expect(next.ui.map.showFacilities).toBe(false);
  });
});

describe("trip member state store", () => {
  it("seeds defaults and applies patches per trip member", async () => {
    const rows = new Map<
      string,
      { state: TripDashboardState; updatedAt: Date | null }
    >();

    const store: TripMemberStateStore = {
      findByTripAndUser: async ({ tripId, userId }) =>
        rows.get(`${tripId}:${userId}`) ?? null,
      upsert: async ({ tripId, userId, state }) => {
        const row = {
          state: state as TripDashboardState,
          updatedAt: new Date("2026-07-17T12:00:00.000Z"),
        };
        rows.set(`${tripId}:${userId}`, row);
        return row;
      },
    };

    const initial = await getTripDashboardState(store, {
      tripId: "trip_1",
      userId: "user_1",
      legacyPatch: { activeNav: "expenses" },
    });

    expect(initial.activeNav).toBe("expenses");

    const updated = await updateTripDashboardState(store, {
      tripId: "trip_1",
      userId: "user_1",
      patch: { timelineOpen: false },
    });

    expect(updated.timelineOpen).toBe(false);
    expect(updated.activeNav).toBe("expenses");
  });

  it("uses the drizzle-shaped store adapter", async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      }),
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: () => ({
            returning: async () => [
              {
                state: createDefaultTripDashboardState({ activeNav: "stay" }),
                updatedAt: new Date("2026-07-17T12:00:00.000Z"),
              },
            ],
          }),
        }),
      }),
    };

    const store = createTripMemberStateStore(db);
    const state = await getTripDashboardState(store, {
      tripId: "trip_1",
      userId: "user_1",
    });

    expect(state.activeNav).toBe("stay");
  });
});
