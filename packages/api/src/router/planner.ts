import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { tripProcedure } from "../auth/guards";
import {
  DAY_INTENTS,
  type DayPlanDraft,
  OVERNIGHT_KINDS,
  openSauceApproachDraft,
  replanDraft,
} from "../route-planner/day-plan";
import {
  applyDraft,
  deleteDay,
  listDays,
  seedRange,
  upsertDay,
} from "../route-planner/day-plan-ops";
import {
  getPlanMapOp,
  planItineraryOp,
  resolveTemplate,
} from "../route-planner/plan-itinerary-ops";
import {
  applyOvernightFromPoi,
  autoAssignOvernightsForTrip,
  scanTripAmenities,
  suggestAmenitiesNearDay,
  suggestOvernightsForDay,
  suggestOvernightsForTrip,
} from "../route-planner/poi-suggest-ops";
import {
  buildReplanPreview,
  type ReplanReason,
} from "../route-planner/replan-reality";
import {
  getTodayCommand,
  setDayStatusOp,
  setRunStateOp,
} from "../route-planner/today-command-ops";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const dayBlockSchema = z.object({
  part: z.enum(["morning", "midday", "afternoon", "evening"]),
  title: z.string().max(200),
  detail: z.string().max(1000),
});

const dayFields = {
  intent: z.enum(DAY_INTENTS).optional(),
  title: z.string().max(200).nullable().optional(),
  overnightName: z.string().max(300).nullable().optional(),
  overnightKind: z.enum(OVERNIGHT_KINDS).nullable().optional(),
  overnightLat: z.number().min(-90).max(90).nullable().optional(),
  overnightLng: z.number().min(-180).max(180).nullable().optional(),
  heroTitle: z.string().max(300).nullable().optional(),
  heroDetail: z.string().max(1000).nullable().optional(),
  cutIfBehind: z.string().max(500).nullable().optional(),
  blocks: z.array(dayBlockSchema).nullable().optional(),
  segmentId: z.string().uuid().nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
  sortOrder: z.number().int().optional(),
};

const draftDaySchema = z.object({
  date: DATE,
  intent: z.enum(DAY_INTENTS),
  title: z.string().max(200).nullable(),
  overnightName: z.string().max(300).nullable(),
  overnightKind: z.enum(OVERNIGHT_KINDS).nullable(),
  heroTitle: z.string().max(300).nullable(),
  heroDetail: z.string().max(1000).nullable(),
  cutIfBehind: z.string().max(500).nullable(),
  blocks: z.array(dayBlockSchema),
  note: z.string().max(1000).nullable(),
});

const mustVisitSchema = z.object({
  name: z.string().min(1).max(200),
  nights: z.number().int().min(1).max(14).optional(),
  intent: z.enum(DAY_INTENTS).optional(),
  heroTitle: z.string().max(300).optional(),
  heroDetail: z.string().max(1000).optional(),
  overnightKind: z.enum(OVERNIGHT_KINDS).optional(),
  cutIfBehind: z.string().max(500).optional(),
  /** Miles of driving before this visit → hour-packed lead-in days. */
  leadInMiles: z.number().positive().optional(),
});

export const plannerRouter = {
  listDays: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
      }),
    )
    .query(({ ctx }) => listDays(ctx.db, ctx.tripId)),

  /** Single round-trip for Today Command (hero, leave-by, amenities, replan hooks). */
  todayCommand: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        date: DATE.optional(),
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
      }),
    )
    .query(({ ctx, input }) =>
      getTodayCommand(ctx.db, {
        tripId: ctx.tripId,
        workspaceId: input.workspaceId,
        date: input.date,
        lat: input.lat,
        lng: input.lng,
      }),
    ),

  setDayStatus: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        date: DATE,
        status: z.enum(["planned", "active", "done", "skipped", "partial"]),
        actualNote: z.string().max(500).nullable().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      setDayStatusOp(ctx.db, {
        tripId: ctx.tripId,
        date: input.date,
        status: input.status,
        actualNote: input.actualNote,
      }),
    ),

  setRunState: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        runState: z.enum(["on_plan", "side_trip", "paused"]),
        note: z.string().max(500).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await setRunStateOp(ctx.db, {
        tripId: ctx.tripId,
        runState: input.runState,
        note: input.note,
      });
      return { ok: true };
    }),

  /**
   * Preview a reality replan (no write). Accept via applyReplan / planItinerary.
   */
  replanPreview: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        reason: z.enum(["behind", "side_trip", "stayed", "manual"]),
        fromDate: DATE.optional(),
        mode: z.enum(["soft_days", "soft_route"]).default("soft_route"),
        origin: z
          .object({
            lat: z.number().min(-90).max(90),
            lng: z.number().min(-180).max(180),
            name: z.string().max(200).optional(),
          })
          .optional(),
      }),
    )
    .query(({ ctx, input }) =>
      buildReplanPreview(ctx.db, {
        tripId: ctx.tripId,
        reason: input.reason as ReplanReason,
        fromDate: input.fromDate,
        mode: input.mode,
        origin: input.origin,
      }),
    ),

  /**
   * Apply soft replan: rewrites future plan via planItinerary fromDate path
   * (template remaining + origin). Server recompute — does not trust client draft.
   */
  applyReplan: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        reason: z.enum(["behind", "side_trip", "stayed", "manual"]),
        fromDate: DATE.optional(),
        mode: z.enum(["soft_days", "soft_route"]).default("soft_route"),
        origin: z
          .object({
            lat: z.number().min(-90).max(90),
            lng: z.number().min(-180).max(180),
            name: z.string().max(200).optional(),
          })
          .optional(),
        autoAssignOvernights: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const preview = await buildReplanPreview(ctx.db, {
        tripId: ctx.tripId,
        reason: input.reason as ReplanReason,
        fromDate: input.fromDate,
        mode: input.mode,
        origin: input.origin,
      });

      if (input.mode === "soft_days") {
        const result = await applyDraft(ctx.db, {
          tripId: ctx.tripId,
          days: preview.draftDays,
        });
        await setRunStateOp(ctx.db, {
          tripId: ctx.tripId,
          runState: "on_plan",
          note: `Replan applied (${input.reason})`,
        });
        return {
          ...result,
          mode: "soft_days" as const,
          summary: preview.summary,
        };
      }

      // soft_route: route + days from live origin using template remainder
      const result = await planItineraryOp(ctx.db, {
        tripId: ctx.tripId,
        workspaceId: input.workspaceId,
        stops: resolveTemplate("open_sauce_full"),
        replaceExisting: true,
        fromDate: preview.fromDate,
        origin: input.origin,
        autoAssignOvernights: input.autoAssignOvernights,
      });
      await setRunStateOp(ctx.db, {
        tripId: ctx.tripId,
        runState: "on_plan",
        note: `Replan applied (${input.reason})`,
      });
      return {
        ...result,
        mode: "soft_route" as const,
        summary: preview.summary,
      };
    }),

  upsertDay: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        date: DATE,
        ...dayFields,
      }),
    )
    .mutation(({ ctx, input }) => {
      const { workspaceId: _w, tripId: _t, ...fields } = input;
      return upsertDay(ctx.db, { tripId: ctx.tripId, ...fields });
    }),

  deleteDay: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        dayId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await deleteDay(ctx.db, { tripId: ctx.tripId, dayId: input.dayId });
      return { ok: true };
    }),

  seedRange: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        fromDate: DATE,
        untilDate: DATE,
        defaultIntent: z.enum(DAY_INTENTS).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      seedRange(ctx.db, {
        tripId: ctx.tripId,
        fromDate: input.fromDate,
        untilDate: input.untilDate,
        defaultIntent: input.defaultIntent,
      }),
    ),

  /**
   * Pure draft — does not write. Client previews then calls applyDraft.
   */
  replanDraft: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        fromDate: DATE,
        untilDate: DATE,
        mustVisits: z.array(mustVisitSchema).optional(),
        playDates: z.array(DATE).optional(),
        eventDates: z.array(DATE).optional(),
        defaultOvernightKind: z.enum(OVERNIGHT_KINDS).optional(),
        /** Pure A→B: pack drive days by total miles / max hours. */
        totalDriveMiles: z.number().positive().optional(),
        maxDriveHours: z.number().positive().max(16).optional(),
        avgMph: z.number().positive().max(90).optional(),
        /** Dogfood: return the Open Sauce Jul 11–15 template. */
        template: z.enum(["open_sauce_approach"]).optional(),
      }),
    )
    .query(({ input }): DayPlanDraft[] => {
      if (input.template === "open_sauce_approach") {
        return openSauceApproachDraft();
      }
      return replanDraft({
        fromDate: input.fromDate,
        untilDate: input.untilDate,
        mustVisits: input.mustVisits,
        playDates: input.playDates,
        eventDates: input.eventDates,
        defaultOvernightKind: input.defaultOvernightKind,
        totalDriveMiles: input.totalDriveMiles,
        maxDriveHours: input.maxDriveHours,
        avgMph: input.avgMph,
      });
    }),

  applyDraft: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        days: z.array(draftDaySchema).min(1).max(60),
      }),
    )
    .mutation(({ ctx, input }) =>
      applyDraft(ctx.db, {
        tripId: ctx.tripId,
        days: input.days as DayPlanDraft[],
      }),
    ),

  /**
   * Full multi-day itinerary: route every leg, write segments + trip days +
   * anchors. Replaces existing plan when replaceExisting is true (default).
   * Template `open_sauce_full` = Hood → coast → Sauce → Yosemite → Bryce → Moab.
   */
  planItinerary: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        template: z.enum(["open_sauce_full"]).default("open_sauce_full"),
        replaceExisting: z.boolean().default(true),
        /**
         * Replan only from this date forward (YYYY-MM-DD). Past trip days and
         * legs are kept. Defaults to full rebuild when omitted.
         */
        fromDate: DATE.optional(),
        /** Live GPS — next drive leg starts from here. */
        origin: z
          .object({
            lat: z.number().min(-90).max(90),
            lng: z.number().min(-180).max(180),
            name: z.string().max(200).optional(),
          })
          .optional(),
        /**
         * After planning, assign best nearby iOverlander sleep POI per night
         * (skips hotels). Default true when workspace has imported data.
         */
        autoAssignOvernights: z.boolean().default(true),
      }),
    )
    .mutation(({ ctx, input }) =>
      planItineraryOp(ctx.db, {
        tripId: ctx.tripId,
        workspaceId: input.workspaceId,
        stops: resolveTemplate(input.template),
        replaceExisting: input.replaceExisting,
        fromDate: input.fromDate,
        origin: input.origin,
        autoAssignOvernights: input.autoAssignOvernights,
      }),
    ),

  /** Days + anchors + overnight markers for the trip map. */
  getPlanMap: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
      }),
    )
    .query(({ ctx }) => getPlanMapOp(ctx.db, ctx.tripId)),

  /**
   * iOverlander (etc.) sleep options near a trip day's planned overnight
   * endpoint — wild camping, campsites, overnight parking, rest areas.
   */
  suggestOvernights: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        date: DATE,
        maxMiles: z.number().positive().max(80).default(25),
        limit: z.number().int().min(1).max(40).default(15),
      }),
    )
    .query(({ ctx, input }) =>
      suggestOvernightsForDay(ctx.db, {
        tripId: ctx.tripId,
        workspaceId: input.workspaceId,
        date: input.date,
        maxMiles: input.maxMiles,
        limit: input.limit,
      }),
    ),

  /** Amenities near a day endpoint (dump, water, fuel, parking, toll, …). */
  suggestAmenities: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        date: DATE,
        categories: z.array(z.string()).min(1).max(20),
        maxMiles: z.number().positive().max(80).default(20),
        limit: z.number().int().min(1).max(40).default(20),
      }),
    )
    .query(({ ctx, input }) =>
      suggestAmenitiesNearDay(ctx.db, {
        tripId: ctx.tripId,
        workspaceId: input.workspaceId,
        date: input.date,
        categories: input.categories,
        maxMiles: input.maxMiles,
        limit: input.limit,
      }),
    ),

  /** Per-day overnight top picks for the whole trip (long-term plan scan). */
  suggestOvernightsTrip: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        maxMiles: z.number().positive().max(80).default(25),
        perDay: z.number().int().min(1).max(10).default(5),
      }),
    )
    .query(({ ctx, input }) =>
      suggestOvernightsForTrip(ctx.db, {
        tripId: ctx.tripId,
        workspaceId: input.workspaceId,
        maxMiles: input.maxMiles,
        perDay: input.perDay,
      }),
    ),

  /** Set a trip day's overnight from an imported POI (iOverlander row). */
  applyOvernight: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        date: DATE,
        poiId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await applyOvernightFromPoi(ctx.db, {
          tripId: ctx.tripId,
          workspaceId: input.workspaceId,
          date: input.date,
          poiId: input.poiId,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Failed";
        throw new TRPCError({
          code: message.includes("not found") ? "NOT_FOUND" : "BAD_REQUEST",
          message,
        });
      }
    }),

  /**
   * Auto-pick best sleep POI for every night that doesn't already have one
   * (skips hotels). Use after importing iOverlander CSV mid-trip.
   */
  autoAssignOvernights: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        maxMiles: z.number().positive().max(50).default(20),
      }),
    )
    .mutation(({ ctx, input }) =>
      autoAssignOvernightsForTrip(ctx.db, {
        tripId: ctx.tripId,
        workspaceId: input.workspaceId,
        maxMiles: input.maxMiles,
      }),
    ),

  /**
   * Whole-trip amenity scan: nearest sleep/dump/water/fuel/parking/tolls per
   * day + planning warnings (no dump, tolls nearby, etc.).
   */
  scanAmenities: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        maxMiles: z.number().positive().max(80).default(25),
      }),
    )
    .query(({ ctx, input }) =>
      scanTripAmenities(ctx.db, {
        tripId: ctx.tripId,
        workspaceId: input.workspaceId,
        maxMiles: input.maxMiles,
      }),
    ),
} satisfies TRPCRouterRecord;
