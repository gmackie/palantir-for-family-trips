import { sql } from "drizzle-orm";
import { index, sqliteTable, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { user } from "./auth-schema";

export const workspaceRoleEnum = ["owner", "admin", "member"] as const;
export type WorkspaceRole = (typeof workspaceRoleEnum)[number];
export const tenancyModeEnum = ["single-tenant", "multi-tenant"] as const;
export type TenancyMode = (typeof tenancyModeEnum)[number];
export const tripStatusEnum = [
  "planning",
  "confirmed",
  "active",
  "en_route",
  "paused",
  "completed",
] as const;
export type TripStatus = (typeof tripStatusEnum)[number];
export const tripModeEnum = ["destination", "roadtrip"] as const;
export type TripMode = (typeof tripModeEnum)[number];
/** Execution state on the road — orthogonal to trip.status lifecycle. */
export const tripRunStateEnum = ["on_plan", "side_trip", "paused"] as const;
export type TripRunState = (typeof tripRunStateEnum)[number];
/** Actuals vs plan for one Trip Day. */
export const tripDayStatusEnum = [
  "planned",
  "active",
  "done",
  "skipped",
  "partial",
] as const;
export type TripDayStatus = (typeof tripDayStatusEnum)[number];
export const tripClaimModeEnum = ["organizer", "tap"] as const;
export type TripClaimMode = (typeof tripClaimModeEnum)[number];
export const tripMemberRoleEnum = ["organizer", "member"] as const;
export type TripMemberRole = (typeof tripMemberRoleEnum)[number];
export const billingIntervalEnum = ["month", "year"] as const;
export type BillingInterval = (typeof billingIntervalEnum)[number];
export const workspaceSubscriptionStatusEnum = [
  "free",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "incomplete",
] as const;
export type WorkspaceSubscriptionStatus =
  (typeof workspaceSubscriptionStatusEnum)[number];
export const billingProviderEnum = ["manual", "stripe"] as const;
export type BillingProvider = (typeof billingProviderEnum)[number];
export const billingLimitPeriodEnum = ["day", "month", "all_time"] as const;
export type BillingLimitPeriod = (typeof billingLimitPeriodEnum)[number];
export const usageAggregationEnum = ["sum", "max"] as const;
export type UsageAggregation = (typeof usageAggregationEnum)[number];

export const Post = sqliteTable("post", (t) => ({
  id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: t.text().notNull(),
  content: t.text().notNull(),
  createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: t
    .integer({ mode: "timestamp" })
    .$onUpdateFn(() => new Date()),
}));

export const CreatePostSchema = createInsertSchema(Post, {
  title: z.string().max(256),
  content: z.string().max(256),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const userPreferences = sqliteTable("user_preferences", (t) => ({
  id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: t
    .text()
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  theme: t.text().notNull().default("system"),
  language: t.text().notNull().default("en"),
  timezone: t.text().notNull().default("UTC"),
  emailNotifications: t.integer({ mode: "boolean" }).notNull().default(true),
  pushNotifications: t.integer({ mode: "boolean" }).notNull().default(true),
  createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: t
    .integer({ mode: "timestamp" })
    .$onUpdateFn(() => new Date()),
}));

export const pushTokens = sqliteTable(
  "push_token",
  (t) => ({
    id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: t.text().notNull(),
    platform: t.text().notNull().default("ios"),
    createdAt: t
      .integer({ mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: t
      .integer({ mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (table) => [
    unique("push_token_user_token_unique").on(table.userId, table.token),
  ],
);

export const apiKeys = sqliteTable("api_keys", (t) => ({
  id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: t.text().notNull(),
  keyHash: t.text().notNull(),
  keyPrefix: t.text().notNull(),
  permissions: t.text({ mode: "json" }).$type<string[]>().notNull().default(["read"]),
  lastUsedAt: t.integer({ mode: "timestamp" }),
  expiresAt: t.integer({ mode: "timestamp" }),
  createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  revokedAt: t.integer({ mode: "timestamp" }),
}));

export const workspace = sqliteTable("workspace", (t) => ({
  id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: t.text().notNull(),
  slug: t.text().notNull().unique(),
  ownerUserId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: t
    .integer({ mode: "timestamp" })
    .$onUpdateFn(() => new Date()),
}));

export const workspaceMembership = sqliteTable(
  "workspace_membership",
  (t) => ({
    id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: t
      .text()
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: t.text().$type<WorkspaceRole>().notNull().default("member"),
    createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
    updatedAt: t
      .integer({ mode: "timestamp" })
      .$onUpdateFn(() => new Date()),
  }),
  (table) => [
    unique("workspace_membership_workspace_user_unique").on(
      table.workspaceId,
      table.userId,
    ),
  ],
);

export const workspaceInviteAllowlist = sqliteTable(
  "workspace_invite_allowlist",
  (t) => ({
    id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: t
      .text()
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    email: t.text().notNull(),
    role: t.text().$type<WorkspaceRole>().notNull().default("member"),
    invitedByUserId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
    updatedAt: t
      .integer({ mode: "timestamp" })
      .$onUpdateFn(() => new Date()),
  }),
  (table) => [
    unique("workspace_invite_allowlist_workspace_email_unique").on(
      table.workspaceId,
      table.email,
    ),
  ],
);

export const trips = sqliteTable("trip", (t) => ({
  id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: t
    .text()
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  name: t.text().notNull(),
  createdByUserId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  status: t.text().$type<TripStatus>().notNull().default("planning"),
  groupMode: t.integer({ mode: "boolean" }).notNull().default(false),
  tripMode: t.text().$type<TripMode>().notNull().default("destination"),
  claimMode: t.text().$type<TripClaimMode>().notNull().default("organizer"),
  destinationName: t.text(),
  destinationLat: t.real(),
  destinationLng: t.real(),
  defaultZoom: t.integer().notNull().default(13),
  startDate: t.text(),
  endDate: t.text(),
  tz: t.text().notNull().default("UTC"),
  // Phase 1a — device-sent share invite (one reusable, revocable link per trip)
  shareInviteToken: t.text().unique(),
  shareInviteEnabled: t.integer({ mode: "boolean" }).notNull().default(true),
  shareInviteCreatedAt: t.integer({ mode: "timestamp" }),
  /** Van execution: on plan vs exploring off-corridor vs paused. */
  runState: t.text().$type<TripRunState>().notNull().default("on_plan"),
  runStateSince: t.integer({ mode: "timestamp" }),
  runStateNote: t.text(),
  /**
   * Corridor Cast narrator for this trip. NULL keeps the deployment default
   * (ELEVENLABS_VOICE_ID_DEFAULT, else the premade "George"). Stored per trip
   * rather than per user: an episode is a shared artifact, and the group hears
   * one voice.
   */
  castVoiceId: t.text(),
  createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: t
    .integer({ mode: "timestamp" })
    .$onUpdateFn(() => new Date()),
}));

export const tripMembers = sqliteTable(
  "trip_member",
  (t) => ({
    id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    tripId: t
      .text()
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: t.text().$type<TripMemberRole>().notNull().default("member"),
    displayName: t.text(),
    colorHex: t.text(),
    venmoHandle: t.text(),
    joinedAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  }),
  (table) => [
    unique("trip_members_trip_user_unique").on(table.tripId, table.userId),
  ],
);

/** Per-user dashboard UI preferences for a trip (replaces localStorage). */
export const tripMemberState = sqliteTable(
  "trip_member_state",
  (t) => ({
    id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    tripId: t
      .text()
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    state: t.text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
    createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
    updatedAt: t
      .integer({ mode: "timestamp" })
      .$onUpdateFn(() => new Date()),
  }),
  (table) => [
    unique("trip_member_state_trip_user_unique").on(table.tripId, table.userId),
  ],
);

export const tripSegments = sqliteTable(
  "trip_segment",
  (t) => ({
    id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    tripId: t
      .text()
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    name: t.text().notNull(),
    destinationName: t.text(),
    destinationLat: t.real(),
    destinationLng: t.real(),
    defaultZoom: t.integer().notNull().default(13),
    startDate: t.text(),
    endDate: t.text(),
    tz: t.text().notNull().default("UTC"),
    originName: t.text(),
    originLat: t.real(),
    originLng: t.real(),
    routePolyline: t.text(),
    distanceMiles: t.real(),
    durationMinutes: t.integer(),
    sortOrder: t.integer().notNull(),
    createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
    updatedAt: t
      .integer({ mode: "timestamp" })
      .$onUpdateFn(() => new Date()),
  }),
  (table) => [
    unique("trip_segments_trip_sort_order_unique").on(
      table.tripId,
      table.sortOrder,
    ),
  ],
);

export const journeyStopKindEnum = [
  "camp",
  "overnight",
  "rest",
  "scenic",
  "fuel",
  "water",
  "dump",
  "town",
  "custom",
] as const;
export type JourneyStopKind = (typeof journeyStopKindEnum)[number];

export const journeyRouteStatusEnum = ["ready", "pending"] as const;
export type JourneyRouteStatus = (typeof journeyRouteStatusEnum)[number];

/**
 * The traveler-facing record of a place they actually reached. Route segments
 * remain the map/routing representation; this row distinguishes recorded
 * progress from future itinerary legs and gives offline retries a stable id.
 */
export const journeyStops = sqliteTable(
  "journey_stop",
  (t) => ({
    id: t.text().notNull().primaryKey(),
    tripId: t
      .text()
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    segmentId: t
      .text()
      .notNull()
      .references(() => tripSegments.id, { onDelete: "cascade" }),
    kind: t.text().$type<JourneyStopKind>().notNull().default("custom"),
    sortOrder: t.integer().notNull(),
    arrivedAt: t.integer({ mode: "timestamp" }).notNull(),
    note: t.text(),
    routeStatus: t
      .text()
      .$type<JourneyRouteStatus>()
      .notNull()
      .default("ready"),
    createdByUserId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: t
      .integer({ mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: t
      .integer({ mode: "timestamp" })
      .$onUpdateFn(() => new Date()),
  }),
  (table) => [
    unique("journey_stop_segment_unique").on(table.segmentId),
    unique("journey_stop_trip_sort_order_unique").on(
      table.tripId,
      table.sortOrder,
    ),
    index("journey_stop_trip_arrived_idx").on(table.tripId, table.arrivedAt),
  ],
);

export const segmentMembers = sqliteTable(
  "segment_member",
  (t) => ({
    id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    segmentId: t
      .text()
      .notNull()
      .references(() => tripSegments.id, { onDelete: "cascade" }),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  }),
  (table) => [
    unique("segment_members_segment_user_unique").on(
      table.segmentId,
      table.userId,
    ),
  ],
);

export const tripInvites = sqliteTable(
  "trip_invite",
  (t) => ({
    id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    tripId: t
      .text()
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    email: t.text().notNull(),
    token: t.text().notNull().unique(),
    role: t.text().$type<TripMemberRole>().notNull().default("member"),
    invitedByUserId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: t.integer({ mode: "timestamp" }).notNull(),
    acceptedAt: t.integer({ mode: "timestamp" }),
    createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
    updatedAt: t
      .integer({ mode: "timestamp" })
      .$onUpdateFn(() => new Date()),
  }),
  (table) => [
    unique("trip_invites_trip_email_unique").on(table.tripId, table.email),
  ],
);

export const tripMessages = sqliteTable(
  "trip_message",
  (t) => ({
    id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    tripId: t
      .text()
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    body: t.text().notNull(),
    contextType: t.text().$type<"pin" | "poll" | "expense" | "segment">(),
    contextId: t.text(),
    createdAt: t
      .integer({ mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
    editedAt: t.integer({ mode: "timestamp" }),
    deletedAt: t.integer({ mode: "timestamp" }),
  }),
  (table) => [
    index("trip_message_trip_created_idx").on(table.tripId, table.createdAt),
  ],
);

// ═══════════════════════════════════════════════════════
// EXPENSES (Phase 3)
// ═══════════════════════════════════════════════════════

export const expenseStatusEnum = ["draft", "finalized"] as const;
export type ExpenseStatus = (typeof expenseStatusEnum)[number];

export const expenseCategoryEnum = [
  "meal",
  "transit",
  "lodging",
  "activity",
  "drinks",
  "tickets",
  "general",
  "fuel",
  "camping",
] as const;
export type ExpenseCategory = (typeof expenseCategoryEnum)[number];

export const expenses = sqliteTable("expense", (t) => ({
  id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  tripId: t
    .text()
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" }),
  segmentId: t
    .text()
    .notNull()
    .references(() => tripSegments.id, { onDelete: "cascade" }),
  payerUserId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  merchant: t.text().notNull(),
  category: t.text().$type<ExpenseCategory>().notNull().default("general"),
  occurredAt: t.integer({ mode: "timestamp" }).notNull(),
  subtotalCents: t.integer().notNull().default(0),
  taxCents: t.integer().notNull().default(0),
  tipCents: t.integer().notNull().default(0),
  totalCents: t.integer().notNull().default(0),
  currency: t.text().notNull().default("USD"),
  notes: t.text(),
  // OCR provenance — persisted from the receipt-OCR pipeline so a low-confidence
  // or failed extraction can be surfaced for review instead of silently trusted.
  // Null on all three = manually-entered (no OCR was run).
  ocrConfidence: t.real(),
  ocrWarnings: t.text({ mode: "json" }).$type<string[]>(),
  ocrProvider: t.text().$type<"claude" | "gemini" | "fixture">(),
  ocrStatus: t.text().$type<"success" | "failed">(),
  status: t.text().$type<ExpenseStatus>().notNull().default("draft"),
  createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: t
    .integer({ mode: "timestamp" })
    .$onUpdateFn(() => new Date()),
}));

export const receiptImages = sqliteTable("receipt_image", (t) => ({
  id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  expenseId: t
    .text()
    .notNull()
    .references(() => expenses.id, { onDelete: "cascade" }),
  storageKey: t.text().notNull(),
  mimeType: t.text().notNull(),
  sizeBytes: t.integer().notNull(),
  uploadedByUserId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
}));

export const lineItems = sqliteTable("line_item", (t) => ({
  id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  expenseId: t
    .text()
    .notNull()
    .references(() => expenses.id, { onDelete: "cascade" }),
  name: t.text().notNull(),
  quantity: t.real().notNull().default(1),
  unitPriceCents: t.integer().notNull().default(0),
  lineTotalCents: t.integer().notNull().default(0),
  sortOrder: t.integer().notNull().default(0),
  createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: t
    .integer({ mode: "timestamp" })
    .$onUpdateFn(() => new Date()),
}));

export const lineItemClaims = sqliteTable(
  "line_item_claim",
  (t) => ({
    id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    lineItemId: t
      .text()
      .notNull()
      .references(() => lineItems.id, { onDelete: "cascade" }),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  }),
  (table) => [
    unique("line_item_claim_line_item_user_unique").on(
      table.lineItemId,
      table.userId,
    ),
  ],
);

// ═══════════════════════════════════════════════════════
// SETTLEMENTS (Phase 4)
// ═══════════════════════════════════════════════════════

export const settlements = sqliteTable("settlement", (t) => ({
  id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  tripId: t
    .text()
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" }),
  fromUserId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  toUserId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  amountCents: t.integer().notNull(),
  idempotencyKey: t.text().notNull().unique(),
  note: t.text(),
  settledAt: t
    .integer({ mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
  undoneAt: t.integer({ mode: "timestamp" }),
  createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: t
    .integer({ mode: "timestamp" })
    .$onUpdateFn(() => new Date()),
}));

// ═══════════════════════════════════════════════════════
// PHOTOS
// ═══════════════════════════════════════════════════════

export const tripPhotos = sqliteTable("trip_photo", (t) => ({
  id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  tripId: t
    .text()
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" }),
  segmentId: t
    .text()
    .references(() => tripSegments.id, { onDelete: "set null" }),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  storageKey: t.text().notNull(),
  caption: t.text(),
  lat: t.real(),
  lng: t.real(),
  takenAt: t.integer({ mode: "timestamp" }),
  uploadedAt: t
    .integer({ mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
}));

export const photoReactionEnum = [
  "heart",
  "fire",
  "laugh",
  "wow",
  "sad",
] as const;
export type PhotoReaction = (typeof photoReactionEnum)[number];

export const photoReactions = sqliteTable(
  "photo_reaction",
  (t) => ({
    id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    photoId: t
      .text()
      .notNull()
      .references(() => tripPhotos.id, { onDelete: "cascade" }),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    reaction: t.text().$type<PhotoReaction>().notNull(),
    createdAt: t
      .integer({ mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (table) => [
    unique("photo_reaction_photo_user_unique").on(table.photoId, table.userId),
  ],
);

// ═══════════════════════════════════════════════════════
// ITINERARY
// ═══════════════════════════════════════════════════════

export const itineraryEventCategoryEnum = [
  "meal",
  "activity",
  "transport",
  "lodging",
  "free_time",
  "meeting_point",
  "other",
] as const;
export type ItineraryEventCategory =
  (typeof itineraryEventCategoryEnum)[number];

export const itineraryEvents = sqliteTable("itinerary_event", (t) => ({
  id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  tripId: t
    .text()
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" }),
  segmentId: t
    .text()
    .references(() => tripSegments.id, { onDelete: "set null" }),
  title: t.text().notNull(),
  description: t.text(),
  category: t.text().$type<ItineraryEventCategory>().notNull().default("other"),
  location: t.text(),
  lat: t.real(),
  lng: t.real(),
  startsAt: t.integer({ mode: "timestamp" }).notNull(),
  endsAt: t.integer({ mode: "timestamp" }),
  allDay: t.integer({ mode: "boolean" }).notNull().default(false),
  createdByUserId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  sortOrder: t.integer().notNull().default(0),
  createdAt: t
    .integer({ mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
}));

// ═══════════════════════════════════════════════════════
// PRE-TRIP PLANNING
// ═══════════════════════════════════════════════════════

export const pollTypeEnum = [
  "date_range",
  "single_choice",
  "multi_choice",
  "ranked",
] as const;
export type PollType = (typeof pollTypeEnum)[number];

export const pollStatusEnum = ["open", "closed"] as const;
export type PollStatus = (typeof pollStatusEnum)[number];

export const pollVoteResponseEnum = ["yes", "no", "maybe", "prefer"] as const;
export type PollVoteResponse = (typeof pollVoteResponseEnum)[number];

export const proposalTypeEnum = [
  "flight",
  "lodging",
  "car_rental",
  "activity",
  "other",
] as const;
export type ProposalType = (typeof proposalTypeEnum)[number];

export const proposalStatusEnum = [
  "proposed",
  "selected",
  "booked",
  "rejected",
] as const;
export type ProposalStatus = (typeof proposalStatusEnum)[number];

export const proposalReactionEnum = [
  "up",
  "down",
  "interested",
  "booked",
] as const;
export type ProposalReaction = (typeof proposalReactionEnum)[number];

export const polls = sqliteTable("poll", (t) => ({
  id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  tripId: t
    .text()
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" }),
  createdByUserId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  title: t.text().notNull(),
  pollType: t.text().$type<PollType>().notNull().default("single_choice"),
  status: t.text().$type<PollStatus>().notNull().default("open"),
  closesAt: t.integer({ mode: "timestamp" }),
  createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: t
    .integer({ mode: "timestamp" })
    .$onUpdateFn(() => new Date()),
}));

export const pollOptions = sqliteTable("poll_option", (t) => ({
  id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  pollId: t
    .text()
    .notNull()
    .references(() => polls.id, { onDelete: "cascade" }),
  label: t.text().notNull(),
  description: t.text(),
  url: t.text(),
  sortOrder: t.integer().notNull().default(0),
  createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
}));

export const pollVotes = sqliteTable(
  "poll_vote",
  (t) => ({
    id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    pollOptionId: t
      .text()
      .notNull()
      .references(() => pollOptions.id, { onDelete: "cascade" }),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    response: t.text().$type<PollVoteResponse>().notNull().default("yes"),
    rank: t.integer(),
    note: t.text(),
    createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
    updatedAt: t
      .integer({ mode: "timestamp" })
      .$onUpdateFn(() => new Date()),
  }),
  (table) => [
    unique("poll_votes_option_user_unique").on(
      table.pollOptionId,
      table.userId,
    ),
  ],
);

export const proposals = sqliteTable("proposal", (t) => ({
  id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  tripId: t
    .text()
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" }),
  segmentId: t
    .text()
    .references(() => tripSegments.id, { onDelete: "set null" }),
  createdByUserId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  proposalType: t.text().$type<ProposalType>().notNull().default("other"),
  title: t.text().notNull(),
  description: t.text(),
  url: t.text(),
  priceCents: t.integer(),
  currency: t.text().notNull().default("USD"),
  priceNote: t.text(),
  imageUrl: t.text(),
  status: t.text().$type<ProposalStatus>().notNull().default("proposed"),
  bookedByUserId: t.text().references(() => user.id, { onDelete: "set null" }),
  createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: t
    .integer({ mode: "timestamp" })
    .$onUpdateFn(() => new Date()),
}));

export const proposalReactions = sqliteTable(
  "proposal_reaction",
  (t) => ({
    id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    proposalId: t
      .text()
      .notNull()
      .references(() => proposals.id, { onDelete: "cascade" }),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    reaction: t.text().$type<ProposalReaction>().notNull().default("up"),
    note: t.text(),
    createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
    updatedAt: t
      .integer({ mode: "timestamp" })
      .$onUpdateFn(() => new Date()),
  }),
  (table) => [
    unique("proposal_reactions_proposal_user_unique").on(
      table.proposalId,
      table.userId,
    ),
  ],
);

// ═══════════════════════════════════════════════════════
// MAP + ITINERARY (Phase 5)
// ═══════════════════════════════════════════════════════

export const pinTypeEnum = [
  "lodging",
  "activity",
  "meal",
  "transit",
  "drinks",
  "tickets",
  "custom",
  "fuel",
  "water",
  "campsite",
  "dump_station",
  "rest_area",
  "scenic",
  "shower",
  "grocery",
  "propane",
  "laundry",
] as const;
export type PinType = (typeof pinTypeEnum)[number];

export const pins = sqliteTable("pin", (t) => ({
  id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  tripId: t
    .text()
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" }),
  segmentId: t
    .text()
    .notNull()
    .references(() => tripSegments.id, { onDelete: "cascade" }),
  type: t.text().$type<PinType>().notNull().default("custom"),
  title: t.text().notNull(),
  lat: t.real().notNull(),
  lng: t.real().notNull(),
  startsAt: t.integer({ mode: "timestamp" }),
  endsAt: t.integer({ mode: "timestamp" }),
  notes: t.text(),
  createdByUserId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  editLockedByUserId: t
    .text()
    .references(() => user.id, { onDelete: "set null" }),
  editLockedUntil: t.integer({ mode: "timestamp" }),
  createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: t
    .integer({ mode: "timestamp" })
    .$onUpdateFn(() => new Date()),
}));

export const pinAttendees = sqliteTable(
  "pin_attendee",
  (t) => ({
    id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    pinId: t
      .text()
      .notNull()
      .references(() => pins.id, { onDelete: "cascade" }),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  }),
  (table) => [
    unique("pin_attendees_pin_user_unique").on(table.pinId, table.userId),
  ],
);

// ═══════════════════════════════════════════════════════
// LODGING + ARRIVALS
// ═══════════════════════════════════════════════════════

export const lodgingProviderEnum = [
  "airbnb",
  "vrbo",
  "hotel",
  "hostel",
  "other",
] as const;
export type LodgingProvider = (typeof lodgingProviderEnum)[number];

export const lodgingSourceTypeEnum = [
  "manual",
  "email_parsed",
  "api_imported",
  "link_parsed",
] as const;
export type LodgingSourceType = (typeof lodgingSourceTypeEnum)[number];

export const lodgings = sqliteTable("lodging", (t) => ({
  id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  segmentId: t
    .text()
    .notNull()
    .references(() => tripSegments.id, { onDelete: "cascade" }),
  createdByUserId: t.text().references(() => user.id, { onDelete: "set null" }),
  provider: t.text().$type<LodgingProvider>(),
  propertyName: t.text().notNull(),
  address: t.text(),
  lat: t.real(),
  lng: t.real(),
  checkInAt: t.integer({ mode: "timestamp" }).notNull(),
  checkOutAt: t.integer({ mode: "timestamp" }).notNull(),
  checkInInstructions: t.text(),
  confirmationNumber: t.text(),
  bookingUrl: t.text(),
  nightlyRateCents: t.integer(),
  totalCostCents: t.integer(),
  currency: t.text().notNull().default("USD"),
  hostName: t.text(),
  hostPhone: t.text(),
  notes: t.text(),
  sourceType: t.text().$type<LodgingSourceType>().notNull().default("manual"),
  sourceRaw: t.text(),
  createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: t
    .integer({ mode: "timestamp" })
    .$onUpdateFn(() => new Date()),
}));

export const lodgingGuests = sqliteTable(
  "lodging_guest",
  (t) => ({
    id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    lodgingId: t
      .text()
      .notNull()
      .references(() => lodgings.id, { onDelete: "cascade" }),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  }),
  (table) => [
    unique("lodging_guests_lodging_user_unique").on(
      table.lodgingId,
      table.userId,
    ),
  ],
);

// Sleeping arrangements within a lodging: named rooms + who occupies each.
export const roomAssignments = sqliteTable("room_assignment", (t) => ({
  id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  lodgingId: t
    .text()
    .notNull()
    .references(() => lodgings.id, { onDelete: "cascade" }),
  roomLabel: t.text().notNull(),
  sortOrder: t.integer().notNull().default(0),
  createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
}));

export const roomOccupants = sqliteTable(
  "room_occupant",
  (t) => ({
    id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    roomAssignmentId: t
      .text()
      .notNull()
      .references(() => roomAssignments.id, { onDelete: "cascade" }),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  }),
  (table) => [
    unique("room_occupant_room_user_unique").on(
      table.roomAssignmentId,
      table.userId,
    ),
  ],
);

export const transitDirectionEnum = ["arrival", "departure"] as const;
export type TransitDirection = (typeof transitDirectionEnum)[number];

export const transitTypeEnum = [
  "flight",
  "train",
  "bus",
  "car",
  "ferry",
  "other",
] as const;
export type TransitType = (typeof transitTypeEnum)[number];

export const trackingStatusEnum = [
  "scheduled",
  "en_route",
  "delayed",
  "arrived",
  "cancelled",
] as const;
export type TrackingStatus = (typeof trackingStatusEnum)[number];

export const memberTransits = sqliteTable("member_transit", (t) => ({
  id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  segmentId: t
    .text()
    .notNull()
    .references(() => tripSegments.id, { onDelete: "cascade" }),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  direction: t.text().$type<TransitDirection>(),
  transitType: t.text().$type<TransitType>(),
  carrier: t.text(),
  transitNumber: t.text(),
  departureStation: t.text(),
  arrivalStation: t.text(),
  scheduledAt: t.integer({ mode: "timestamp" }).notNull(),
  estimatedAt: t.integer({ mode: "timestamp" }),
  actualAt: t.integer({ mode: "timestamp" }),
  trackingStatus: t
    .text()
    .$type<TrackingStatus>()
    .notNull()
    .default("scheduled"),
  notes: t.text(),
  createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: t
    .integer({ mode: "timestamp" })
    .$onUpdateFn(() => new Date()),
}));

export const ferrySourceEnum = ["manual", "ocr"] as const;
export type FerrySource = (typeof ferrySourceEnum)[number];

export const ferryCrossings = sqliteTable("ferry_crossing", (t) => ({
  id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  tripId: t
    .text()
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" }),
  createdByUserId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  operator: t.text(),
  departureTerminal: t.text(),
  arrivalTerminal: t.text(),
  scheduledDepartureAt: t.integer({ mode: "timestamp" }),
  durationMinutes: t.integer(),
  arrivalCutoffMinutes: t.integer().notNull().default(30),
  vehicleReservation: t.integer({ mode: "boolean" }).notNull().default(false),
  confirmationNumber: t.text(),
  fareCents: t.integer(),
  currency: t.text().notNull().default("USD"),
  fareNote: t.text(),
  afterSegmentId: t
    .text()
    .references(() => tripSegments.id, { onDelete: "set null" }),
  source: t.text().$type<FerrySource>().notNull().default("manual"),
  sourceRaw: t.text(),
  ocrProvider: t.text(),
  ocrConfidence: t.real(),
  expenseId: t.text().references(() => expenses.id, { onDelete: "set null" }),
  createdAt: t
    .integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: t
    .integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
}));

export const insertFerryCrossingSchema = createInsertSchema(ferryCrossings);

export const groundTransportTypeEnum = [
  "rental_car",
  "taxi",
  "rideshare",
  "shuttle",
  "public_transit",
] as const;
export type GroundTransportType = (typeof groundTransportTypeEnum)[number];

export const groundTransportGroups = sqliteTable("ground_transport_group", (t) => ({
  id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  segmentId: t
    .text()
    .notNull()
    .references(() => tripSegments.id, { onDelete: "cascade" }),
  createdByUserId: t.text().references(() => user.id, { onDelete: "set null" }),
  transportType: t.text().$type<GroundTransportType>(),
  label: t.text().notNull(),
  fromDescription: t.text(),
  toDescription: t.text(),
  scheduledAt: t.integer({ mode: "timestamp" }),
  costCents: t.integer(),
  currency: t.text().notNull().default("USD"),
  notes: t.text(),
  createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: t
    .integer({ mode: "timestamp" })
    .$onUpdateFn(() => new Date()),
}));

export const groundTransportMembers = sqliteTable(
  "ground_transport_member",
  (t) => ({
    id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    groundTransportGroupId: t
      .text()
      .notNull()
      .references(() => groundTransportGroups.id, { onDelete: "cascade" }),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  }),
  (table) => [
    unique("ground_transport_members_group_user_unique").on(
      table.groundTransportGroupId,
      table.userId,
    ),
  ],
);

export const applicationSettings = sqliteTable("application_settings", (t) => ({
  id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  setupCompletedAt: t.integer({ mode: "timestamp" }),
  setupCompletedByUserId: t
    .text()
    .references(() => user.id, { onDelete: "set null" }),
  initialWorkspaceId: t
    .text()
    .references(() => workspace.id, { onDelete: "set null" }),
  tenancyMode: t.text().$type<TenancyMode>().notNull().default("single-tenant"),
  maintenanceMode: t.integer({ mode: "boolean" }).notNull().default(false),
  signupEnabled: t.integer({ mode: "boolean" }).notNull().default(true),
  announcementMessage: t.text(),
  announcementTone: t.text().notNull().default("info"),
  allowedEmailDomains: t.text({ mode: "json" }).$type<string[]>().notNull().default([]),
  createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: t
    .integer({ mode: "timestamp" })
    .$onUpdateFn(() => new Date()),
}));

export const waitlistSourceEnum = [
  "landing",
  "contact",
  "referral",
  "blocked-signup",
] as const;
export type WaitlistSource = (typeof waitlistSourceEnum)[number];

export const waitlistStatusEnum = [
  "pending",
  "contacted",
  "approved",
  "dismissed",
] as const;
export type WaitlistStatus = (typeof waitlistStatusEnum)[number];

export const waitlistEntry = sqliteTable(
  "waitlist_entry",
  (t) => ({
    id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    email: t.text().notNull(),
    source: t.text().$type<WaitlistSource>().notNull().default("landing"),
    status: t.text().$type<WaitlistStatus>().notNull().default("pending"),
    message: t.text(),
    referralCode: t.text(),
    reviewedByUserId: t
      .text()
      .references(() => user.id, { onDelete: "set null" }),
    reviewedAt: t.integer({ mode: "timestamp" }),
    createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
    updatedAt: t
      .integer({ mode: "timestamp" })
      .$onUpdateFn(() => new Date()),
  }),
  (table) => [
    unique("waitlist_entry_email_source_unique").on(table.email, table.source),
  ],
);

export const billingPlan = sqliteTable("billing_plan", (t) => ({
  id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  key: t.text().notNull().unique(),
  name: t.text().notNull(),
  description: t.text(),
  interval: t.text().$type<BillingInterval>().notNull().default("month"),
  amountInCents: t.integer().notNull().default(0),
  currency: t.text().notNull().default("usd"),
  isDefault: t.integer({ mode: "boolean" }).notNull().default(false),
  active: t.integer({ mode: "boolean" }).notNull().default(true),
  createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: t
    .integer({ mode: "timestamp" })
    .$onUpdateFn(() => new Date()),
}));

export const billingPlanLimit = sqliteTable(
  "billing_plan_limit",
  (t) => ({
    id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    planId: t
      .text()
      .notNull()
      .references(() => billingPlan.id, { onDelete: "cascade" }),
    key: t.text().notNull(),
    value: t.integer(),
    period: t.text().$type<BillingLimitPeriod>().notNull().default("month"),
    createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
    updatedAt: t
      .integer({ mode: "timestamp" })
      .$onUpdateFn(() => new Date()),
  }),
  (table) => [
    unique("billing_plan_limit_plan_key_unique").on(table.planId, table.key),
  ],
);

export const workspaceSubscription = sqliteTable(
  "workspace_subscription",
  (t) => ({
    id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: t
      .text()
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    planId: t.text().references(() => billingPlan.id, { onDelete: "set null" }),
    status: t
      .text()
      .$type<WorkspaceSubscriptionStatus>()
      .notNull()
      .default("free"),
    provider: t.text().$type<BillingProvider>().notNull().default("manual"),
    stripeCustomerId: t.text(),
    stripeSubscriptionId: t.text(),
    currentPeriodStart: t.integer({ mode: "timestamp" }),
    currentPeriodEnd: t.integer({ mode: "timestamp" }),
    cancelAtPeriodEnd: t.integer({ mode: "boolean" }).notNull().default(false),
    createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
    updatedAt: t
      .integer({ mode: "timestamp" })
      .$onUpdateFn(() => new Date()),
  }),
  (table) => [
    unique("workspace_subscription_workspace_unique").on(table.workspaceId),
  ],
);

export const usageMeter = sqliteTable("usage_meter", (t) => ({
  id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  key: t.text().notNull().unique(),
  name: t.text().notNull(),
  description: t.text(),
  aggregation: t.text().$type<UsageAggregation>().notNull().default("sum"),
  unit: t.text().notNull().default("count"),
  createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: t
    .integer({ mode: "timestamp" })
    .$onUpdateFn(() => new Date()),
}));

export const workspaceUsageRollup = sqliteTable(
  "workspace_usage_rollup",
  (t) => ({
    id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: t
      .text()
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    meterId: t
      .text()
      .notNull()
      .references(() => usageMeter.id, { onDelete: "cascade" }),
    periodStart: t.integer({ mode: "timestamp" }).notNull(),
    periodEnd: t.integer({ mode: "timestamp" }).notNull(),
    quantity: t.integer().notNull().default(0),
    createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
    updatedAt: t
      .integer({ mode: "timestamp" })
      .$onUpdateFn(() => new Date()),
  }),
  (table) => [
    unique("workspace_usage_rollup_workspace_meter_period_unique").on(
      table.workspaceId,
      table.meterId,
      table.periodStart,
      table.periodEnd,
    ),
  ],
);

// ═══════════════════════════════════════════════════════
// ROAD TRIP MODE
// ═══════════════════════════════════════════════════════

export const vanProfiles = sqliteTable("van_profile", (t) => ({
  id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: t
    .text()
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: t.text().notNull(),
  vehicleType: t.text(),
  year: t.integer(),
  make: t.text(),
  model: t.text(),
  fuelType: t.text().notNull().default("gas"),
  mpgEstimate: t.real(),
  tankGallons: t.real(),
  heightInches: t.integer(),
  lengthFeet: t.integer(),
  // Links this van to a driftport "rig" for live van-system telemetry. NULLABLE
  // and intentionally NOT a foreign key: the referenced row lives in driftport's
  // separate Postgres database, reached over a service-token HTTP call.
  driftportRigId: t.text(),
  createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: t
    .integer({ mode: "timestamp" })
    .$onUpdateFn(() => new Date()),
}));

export const fuelLogs = sqliteTable("fuel_log", (t) => ({
  id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  tripId: t
    .text()
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" }),
  segmentId: t
    .text()
    .references(() => tripSegments.id, { onDelete: "set null" }),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  vanProfileId: t
    .text()
    .references(() => vanProfiles.id, { onDelete: "set null" }),
  odometerMiles: t.real(),
  gallons: t.real().notNull(),
  pricePerGallon: t.real().notNull(),
  totalCents: t.integer().notNull(),
  fuelType: t.text().notNull().default("gas"),
  stationName: t.text(),
  stationLat: t.real(),
  stationLng: t.real(),
  isCostco: t.integer({ mode: "boolean" }).notNull().default(false),
  loggedAt: t.integer({ mode: "timestamp" }).notNull(),
  expenseId: t.text().references(() => expenses.id, { onDelete: "set null" }),
  notes: t.text(),
  createdAt: t.integer({ mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
}));

export const importedPois = sqliteTable(
  "imported_poi",
  (t) => ({
    id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    source: t.text().notNull(),
    externalId: t.text().notNull(),
    name: t.text().notNull(),
    category: t.text().notNull(),
    lat: t.real().notNull(),
    lng: t.real().notNull(),
    data: t.text({ mode: "json" }),
    // NULL = globally shared (e.g. OSM). Set = a single workspace's private
    // upload (e.g. iOverlander, which can't be redistributed) — queries must
    // filter `workspaceId IS NULL OR workspaceId = :currentWorkspace`.
    workspaceId: t
      .text()
      .references(() => workspace.id, { onDelete: "cascade" }),
    importedAt: t
      .integer({ mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (table) => [
    unique("imported_poi_source_external_id_unique").on(
      table.source,
      table.externalId,
    ),
    // Every corridor query is a lat/lng bounding box — cast context packs,
    // poi-suggest, the daily briefing, the corridor router. Without this they
    // all sequential-scan the whole table. The eventual upgrade is a PostGIS
    // geography column with a GiST index (docs/adr/0001), which turns the
    // 5-sample box approximation into one ST_DWithin; this index is the cheap
    // win until then.
    index("imported_poi_lat_lng_idx").on(table.lat, table.lng),
  ],
);

export const poiCache = sqliteTable(
  "poi_cache",
  (t) => ({
    id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    source: t.text().notNull(),
    externalId: t.text().notNull(),
    name: t.text().notNull(),
    category: t.text().notNull(),
    lat: t.real().notNull(),
    lng: t.real().notNull(),
    data: t.text({ mode: "json" }),
    fetchedAt: t
      .integer({ mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
    expiresAt: t.integer({ mode: "timestamp" }),
  }),
  (table) => [
    unique("poi_cache_source_external_id_unique").on(
      table.source,
      table.externalId,
    ),
  ],
);

export const gpsTrackPoints = sqliteTable("gps_track_point", (t) => ({
  id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  tripId: t
    .text()
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" }),
  segmentId: t
    .text()
    .references(() => tripSegments.id, { onDelete: "set null" }),
  lat: t.real().notNull(),
  lng: t.real().notNull(),
  speed: t.real(),
  recordedAt: t.integer({ mode: "timestamp" }).notNull(),
}));

// A shareable public link for a trip's journal/recap. The token is the
// capability; when enabled, /share/<token> renders a read-only recap (traveled
// route, stops, states, driven miles) with NO private data — no expenses, no
// member PII, and no workspace-scoped iOverlander POIs (non-redistributable).
export const tripShares = sqliteTable("trip_share", (t) => ({
  id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  tripId: t
    .text()
    .notNull()
    .unique()
    .references(() => trips.id, { onDelete: "cascade" }),
  token: t.text().notNull().unique(),
  enabled: t.integer({ mode: "boolean" }).notNull().default(true),
  createdAt: t
    .integer({ mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
}));

// Fixed commitments on a trip — a place you must be on a date (a conference,
// campground reservation, family visit, a booked hotel). Anchors constrain the
// day-map: the briefing counts down to the next one and flags when you're too
// far to make it at your current pace. See route-planner/anchors.
export const tripAnchors = sqliteTable("trip_anchor", (t) => ({
  id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  tripId: t
    .text()
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" }),
  title: t.text().notNull(),
  kind: t.text().notNull().default("event"), // event/reservation/lodging/must_see
  placeName: t.text(),
  lat: t.real(),
  lng: t.real(),
  startDate: t.text().notNull(), // YYYY-MM-DD
  endDate: t.text(),
  confirmationCode: t.text(),
  url: t.text(),
  note: t.text(),
  createdAt: t
    .integer({ mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
}));

// Calendar-day plan for a road trip. Planning unit is the day (intent,
// overnight, hero effort), not the polyline. Segments remain drive geometry.
// See docs/plans/2026-07-09-itinerary-planner.md and route-planner/day-plan.ts.
export const DAY_INTENTS = [
  "play",
  "drive",
  "position",
  "event",
  "recovery",
] as const;
export type DayIntent = (typeof DAY_INTENTS)[number];

export const OVERNIGHT_KINDS = [
  "dispersed",
  "campground",
  "hotel",
  "unknown",
] as const;
export type OvernightKind = (typeof OVERNIGHT_KINDS)[number];

export const tripDays = sqliteTable(
  "trip_day",
  (t) => ({
    id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    tripId: t
      .text()
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    date: t.text().notNull(), // YYYY-MM-DD
    intent: t.text().$type<DayIntent>().notNull().default("drive"),
    title: t.text(),
    overnightName: t.text(),
    overnightKind: t.text().$type<OvernightKind | null>(),
    overnightLat: t.real(),
    overnightLng: t.real(),
    heroTitle: t.text(),
    heroDetail: t.text(),
    cutIfBehind: t.text(),
    /** Time blocks: [{ part: morning|midday|afternoon|evening, title, detail }] */
    blocksJson: t.text({ mode: "json" }).$type<
      Array<{
        part: "morning" | "midday" | "afternoon" | "evening";
        title: string;
        detail: string;
      }>
    >(),
    segmentId: t.text().references(() => tripSegments.id, {
      onDelete: "set null",
    }),
    sortOrder: t.integer().notNull().default(0),
    note: t.text(),
    /** Actuals vs plan — Today Command mark done/partial/skipped. */
    status: t.text().$type<TripDayStatus>().notNull().default("planned"),
    completedAt: t.integer({ mode: "timestamp" }),
    actualNote: t.text(),
    createdAt: t
      .integer({ mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: t
      .integer({ mode: "timestamp" })
      .$onUpdateFn(() => new Date()),
  }),
  (table) => [unique("trip_day_trip_date_unique").on(table.tripId, table.date)],
);

// Historical resource-level readings (grey/black/fresh/propane/fuel), from
// manual entry or DriftPort telemetry. The latest reading per resource is the
// current level; the series feeds consumption-rate learning so predictive
// service alerts use *this van's* real drain/fill behavior. See daymap/vanstate.
export const vanStateReadings = sqliteTable("van_state_reading", (t) => ({
  id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  tripId: t
    .text()
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" }),
  resource: t.text().notNull(), // grey/black/fresh/propane/fuel
  levelPct: t.real().notNull(), // 0–100
  source: t.text().notNull().default("manual"), // manual/driftport
  note: t.text(),
  recordedAt: t
    .integer({ mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
}));

export const memberLocations = sqliteTable(
  "member_location",
  (t) => ({
    id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    tripId: t
      .text()
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    lat: t.real().notNull(),
    lng: t.real().notNull(),
    heading: t.real(),
    speed: t.real(),
    accuracy: t.real(),
    sharingEnabled: t.integer({ mode: "boolean" }).notNull().default(false),
    updatedAt: t
      .integer({ mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (table) => [
    unique("member_location_trip_user_unique").on(table.tripId, table.userId),
  ],
);

// ---------------------------------------------------------------------------
// Corridor Cast — "Tonight's Episode": a generated podcast for tomorrow's
// drive. The night-before tap enqueues a cast_episode_job; the worker's cron
// pump advances it (script → read gate → per-segment TTS → concat → R2) and a
// completed run writes a cast_episode row pointing at the final MP3.
// See docs/plans/2026-07-22-corridor-cast-podcast-studio.html (Phase 0 rev 3).

export const castJobStatusEnum = [
  "pending", // enqueued; pump will build context + generate the script
  "awaiting_approval", // script ready — read gate before any TTS spend
  "approved", // script approved; pump will synthesize + concat
  "synthesizing", // TTS in progress (resumable via per-segment R2 checkpoints)
  "complete",
  "failed",
] as const;
export type CastJobStatus = (typeof castJobStatusEnum)[number];

/** Statuses that hold the one-active-job-per-(trip,date) slot. */
export const CAST_JOB_ACTIVE_STATUSES = [
  "pending",
  "awaiting_approval",
  "approved",
  "synthesizing",
] as const;

export type CastScriptSegment = {
  key: string;
  title: string;
  /** Spoken text for this chapter, ready for TTS. */
  text: string;
  wordTarget: number;
};

export type CastScript = {
  episodeTitle: string;
  outline: Array<{
    key: string;
    title: string;
    beats: string[];
    wordTarget: number;
  }>;
  segments: CastScriptSegment[];
};

/** One structural check over a drafted script. */
export type CastScriptEvalCheck = {
  id: string;
  severity: "error" | "warning";
  passed: boolean;
  detail: string;
};

export type CastScriptEval = {
  passed: boolean;
  checks: CastScriptEvalCheck[];
  evaluatedAt: string;
};

/** One synthesized-segment checkpoint: paid audio parked in R2 temp space. */
export type CastCheckpoint = {
  segmentKey: string;
  /** hash(segment text + voice + model) — resume never re-bills a segment. */
  contentHash: string;
  r2Key: string;
  sizeBytes: number;
  durationSeconds: number;
};

export const castEpisodeJobs = sqliteTable(
  "cast_episode_job",
  (t) => ({
    id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    tripId: t
      .text()
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    createdByUserId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Drive day the episode covers, YYYY-MM-DD in the trip's tz. */
    targetDate: t.text().notNull(),
    durationMinutes: t.integer().notNull().default(30), // 15 | 30
    status: t.text().$type<CastJobStatus>().notNull().default("pending"),
    /**
     * Cron pump lease. Set atomically on claim, cleared on voluntary release
     * before the cron wall clock; a claim older than 20 min is stale and may
     * be reclaimed by a later pump run.
     */
    claimedAt: t.integer({ mode: "timestamp" }),
    attemptCount: t.integer().notNull().default(0),
    error: t.text(),
    scriptJson: t.text({ mode: "json" }).$type<CastScript>(),
    checkpointsJson: t.text({ mode: "json" }).$type<CastCheckpoint[]>(),
    /**
     * Structural quality report for the drafted script (cast/evals). Advisory,
     * not a gate: the human read gate is the decision, and a failing check is
     * information for it — blocking on one would strand an episode over a
     * chapter that ran 30 words short.
     */
    evalJson: t.text({ mode: "json" }).$type<CastScriptEval>(),
    llmInputTokens: t.integer().notNull().default(0),
    llmOutputTokens: t.integer().notNull().default(0),
    /** Characters actually billed to ElevenLabs across all attempts. */
    ttsCharacters: t.integer().notNull().default(0),
    createdAt: t
      .integer({ mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: t
      .integer({ mode: "timestamp" })
      .$onUpdateFn(() => new Date()),
  }),
  (table) => [
    // Server-side dedup: at most one non-terminal job per (trip, day). The
    // enqueue mutation inserts with ON CONFLICT against this index.
    uniqueIndex("cast_job_trip_date_active_unique")
      .on(table.tripId, table.targetDate)
      .where(sql`status NOT IN ('complete', 'failed')`),
    index("cast_job_status_idx").on(table.status),
  ],
);

export const castEpisodes = sqliteTable(
  "cast_episode",
  (t) => ({
    id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    tripId: t
      .text()
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    jobId: t.text().references(() => castEpisodeJobs.id, {
      onDelete: "set null",
    }),
    targetDate: t.text().notNull(),
    durationMinutes: t.integer().notNull(),
    title: t.text().notNull(),
    /** Final MP3 in the app bucket under the cast/ prefix. */
    r2Key: t.text().notNull(),
    sizeBytes: t.integer().notNull(),
    durationSeconds: t.real().notNull(),
    /** Chapter markers; offsets come from actual synthesized durations. */
    segmentsJson: t
      .text({ mode: "json" })
      .$type<
        Array<{ title: string; startSeconds: number; durationSeconds: number }>
      >()
      .notNull(),
    voiceId: t.text().notNull(),
    ttsModel: t.text().notNull(),
    scriptModel: t.text().notNull(),
    ttsCharacters: t.integer().notNull().default(0),
    createdAt: t
      .integer({ mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (table) => [
    index("cast_episode_trip_date_idx").on(table.tripId, table.targetDate),
    // One episode per job — makes crash-replayed finalization idempotent
    // (insert ON CONFLICT DO NOTHING). NULL jobIds (job deleted) don't collide.
    uniqueIndex("cast_episode_job_unique").on(table.jobId),
  ],
);

/** One source line from an OODA research-brief export's `## Sources` index. */
export type CastGroundingSource = {
  index: number;
  capabilityId: string;
  url: string | null;
  retrievedAt: string | null;
};

/**
 * One narratable research fact. `verified: false` mirrors OODA's
 * `[UNVERIFIED]` marker — a lead, not a fact; the script prompt keeps it
 * hedged exactly like unsourced model knowledge.
 */
export type CastGroundingFact = {
  title: string;
  text: string;
  verified: boolean;
  sourceIndexes: number[];
};

/**
 * Provenance-tracked documentary research for one drive segment, produced by
 * an OODA research thread (docs: /Volumes/dev/bob/ooda) and pushed via the
 * cast-grounding bridge. Latest row per (trip, segment) wins. Raises tier-2
 * "campfire truth" color into source-backed narration (eng-review Issue 7
 * follow-up).
 */
export const castGroundingBriefs = sqliteTable(
  "cast_grounding_brief",
  (t) => ({
    id: t.text().notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    tripId: t
      .text()
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    segmentId: t
      .text()
      .notNull()
      .references(() => tripSegments.id, { onDelete: "cascade" }),
    title: t.text().notNull(),
    facts: t.text({ mode: "json" }).$type<CastGroundingFact[]>().notNull(),
    sources: t.text({ mode: "json" }).$type<CastGroundingSource[]>().notNull(),
    provenance: t.text({ mode: "json" }).$type<{
      oodaThreadId?: string;
      exportedAt?: string;
      workspaceCommit?: string;
    }>(),
    createdAt: t
      .integer({ mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (table) => [
    index("cast_grounding_trip_segment_idx").on(table.tripId, table.segmentId),
  ],
);

export const CreateUserPreferencesSchema = createInsertSchema(userPreferences, {
  theme: z.enum(["light", "dark", "system"]).default("system"),
  language: z.string().max(10).default("en"),
  timezone: z.string().max(50).default("UTC"),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const UpdateUserPreferencesSchema =
  CreateUserPreferencesSchema.partial().omit({
    userId: true,
  });

export * from "./auth-schema";
