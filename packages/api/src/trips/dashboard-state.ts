import { z } from "zod/v4";

export const tripDashboardNavItemSchema = z.enum([
  "overview",
  "stay",
  "meals",
  "activities",
  "expenses",
  "settlement",
  "members",
  "polls",
  "proposals",
  "photos",
  "chat",
]);

export type TripDashboardNavItem = z.infer<typeof tripDashboardNavItemSchema>;

export const tripDashboardMapStateSchema = z.object({
  showRoutes: z.boolean(),
  showFacilities: z.boolean(),
  showTraffic: z.boolean(),
  focusMemberId: z.union([z.string(), z.literal("all")]),
  focusDayId: z.union([z.string(), z.literal("all")]),
});

export const tripDashboardTimelineStateSchema = z.object({
  mode: z.enum(["scenario", "live"]),
  cursorSlot: z.number().int().min(0),
});

export const tripDashboardUiStateSchema = z.object({
  searchQuery: z.string(),
  timeline: tripDashboardTimelineStateSchema,
  map: tripDashboardMapStateSchema,
});

export const tripDashboardStateSchema = z.object({
  activeNav: tripDashboardNavItemSchema,
  timelineOpen: z.boolean(),
  viewerMemberId: z.string().nullable(),
  selectedEntityId: z.string().nullable(),
  pageNotes: z.record(z.string(), z.string()),
  ui: tripDashboardUiStateSchema,
});

export type TripDashboardState = z.infer<typeof tripDashboardStateSchema>;

export function createDefaultTripDashboardState(
  overrides: Partial<TripDashboardState> = {},
): TripDashboardState {
  return tripDashboardStateSchema.parse({
    activeNav: "overview",
    timelineOpen: true,
    viewerMemberId: null,
    selectedEntityId: null,
    pageNotes: {},
    ui: {
      searchQuery: "",
      timeline: {
        mode: "scenario",
        cursorSlot: 3,
      },
      map: {
        showRoutes: true,
        showFacilities: true,
        showTraffic: false,
        focusMemberId: "all",
        focusDayId: "all",
      },
    },
    ...overrides,
  });
}

const LEGACY_SELECTED_PAGE_TO_NAV: Record<string, TripDashboardNavItem> = {
  itinerary: "overview",
  stay: "stay",
  meals: "meals",
  activities: "activities",
  expenses: "expenses",
  families: "members",
  polls: "polls",
  proposals: "proposals",
};

function readLegacyNav(raw: unknown): TripDashboardNavItem | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const selectedPage = (raw as { selectedPage?: unknown }).selectedPage;
  if (typeof selectedPage !== "string") return undefined;
  return LEGACY_SELECTED_PAGE_TO_NAV[selectedPage];
}

function readLegacySelection(raw: unknown): string | null | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const selection = (raw as { selection?: unknown }).selection;
  if (!selection || typeof selection !== "object") return undefined;
  const entityId = (selection as { entityId?: unknown }).entityId;
  return typeof entityId === "string" ? entityId : null;
}

function readLegacyPageNotes(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const pageNotes = (raw as { pageNotes?: unknown }).pageNotes;
  if (!pageNotes || typeof pageNotes !== "object") return undefined;

  const entries = Object.entries(pageNotes).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return Object.fromEntries(entries);
}

function readLegacyUi(
  raw: unknown,
): Partial<TripDashboardState["ui"]> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const ui = (raw as { ui?: unknown }).ui;
  if (!ui || typeof ui !== "object") return undefined;

  const uiRecord = ui as Record<string, unknown>;
  const patch: Partial<TripDashboardState["ui"]> = {};

  if (typeof uiRecord.searchQuery === "string") {
    patch.searchQuery = uiRecord.searchQuery;
  }

  if (uiRecord.timeline && typeof uiRecord.timeline === "object") {
    const timeline = uiRecord.timeline as Record<string, unknown>;
    patch.timeline = {
      mode: timeline.mode === "live" ? "live" : "scenario",
      cursorSlot:
        typeof timeline.cursorSlot === "number" && timeline.cursorSlot >= 0
          ? timeline.cursorSlot
          : 3,
    };
  }

  if (uiRecord.map && typeof uiRecord.map === "object") {
    const map = uiRecord.map as Record<string, unknown>;
    patch.map = {
      showRoutes: map.showRoutes !== false,
      showFacilities: map.showFacilities !== false,
      showTraffic: map.showTraffic === true,
      focusMemberId:
        typeof map.focusFamilyId === "string" ? map.focusFamilyId : "all",
      focusDayId: typeof map.focusDayId === "string" ? map.focusDayId : "all",
    };
  }

  return patch;
}

export function parseLegacyLocalStorageState(input: {
  tripDocumentRaw?: string | null;
  viewerProfileRaw?: string | null;
}): Partial<TripDashboardState> | null {
  let tripDocument: unknown;
  if (input.tripDocumentRaw) {
    try {
      tripDocument = JSON.parse(input.tripDocumentRaw);
    } catch {
      tripDocument = undefined;
    }
  }

  let viewerProfile: unknown;
  if (input.viewerProfileRaw) {
    try {
      viewerProfile = JSON.parse(input.viewerProfileRaw);
    } catch {
      viewerProfile = undefined;
    }
  }

  const patch: Partial<TripDashboardState> = {};
  const activeNav = readLegacyNav(tripDocument);
  if (activeNav) patch.activeNav = activeNav;

  const selectedEntityId = readLegacySelection(tripDocument);
  if (selectedEntityId !== undefined) patch.selectedEntityId = selectedEntityId;

  const pageNotes = readLegacyPageNotes(tripDocument);
  if (pageNotes) patch.pageNotes = pageNotes;

  const uiPatch = readLegacyUi(tripDocument);
  if (uiPatch) {
    patch.ui = {
      ...createDefaultTripDashboardState().ui,
      ...uiPatch,
      timeline: {
        ...createDefaultTripDashboardState().ui.timeline,
        ...uiPatch.timeline,
      },
      map: {
        ...createDefaultTripDashboardState().ui.map,
        ...uiPatch.map,
      },
    };
  }

  if (viewerProfile && typeof viewerProfile === "object") {
    const familyId = (viewerProfile as { familyId?: unknown }).familyId;
    if (typeof familyId === "string") {
      patch.viewerMemberId = familyId;
    }
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

export function mergeTripDashboardState(
  current: TripDashboardState,
  patch: TripDashboardStatePatch,
): TripDashboardState {
  return tripDashboardStateSchema.parse({
    ...current,
    ...patch,
    pageNotes: patch.pageNotes
      ? { ...current.pageNotes, ...patch.pageNotes }
      : current.pageNotes,
    ui: patch.ui
      ? {
          ...current.ui,
          ...patch.ui,
          timeline: {
            ...current.ui.timeline,
            ...(patch.ui.timeline ?? {}),
          },
          map: {
            ...current.ui.map,
            ...(patch.ui.map ?? {}),
          },
        }
      : current.ui,
  });
}

export const tripDashboardStatePatchSchema = tripDashboardStateSchema
  .partial()
  .extend({
    pageNotes: z.record(z.string(), z.string()).optional(),
    ui: tripDashboardUiStateSchema
      .partial()
      .extend({
        timeline: tripDashboardTimelineStateSchema.partial().optional(),
        map: tripDashboardMapStateSchema.partial().optional(),
      })
      .optional(),
  });

export type TripDashboardStatePatch = z.infer<
  typeof tripDashboardStatePatchSchema
>;

export const LEGACY_TRIP_DOCUMENT_STORAGE_KEY = "trip-command-center/v4-public";
export const LEGACY_VIEWER_PROFILE_STORAGE_KEY =
  "trip-command-center/viewer/v4-public";
