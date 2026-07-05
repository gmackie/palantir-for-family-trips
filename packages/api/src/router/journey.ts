import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { tripProcedure } from "../auth/guards";
import { STOP_KINDS } from "../route-planner/journey-logic";
import {
  deleteStopOp,
  logStopOp,
  updateStopOp,
} from "../route-planner/journey-ops";
import { reverseGeocode } from "../route-planner/routing";
import { protectedProcedure } from "../trpc";

const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const journeyRouter = {
  /**
   * Reverse-geocode a coordinate to a place name, to prefill "I'm here now".
   * Fail-soft: returns null when geocoding is unavailable.
   */
  reverseGeocode: protectedProcedure
    .input(z.object({ lat: z.number(), lng: z.number() }))
    .query(({ input }) => reverseGeocode({ lat: input.lat, lng: input.lng })),

  /**
   * Log a stop you've pulled into. Appends a driving leg from your last stop
   * (routed via Google, straight-line fallback) and drops a typed pin. Date
   * defaults to today in the trip tz but is aspirational — edit it later.
   */
  logStop: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        name: z.string().min(1).max(200),
        lat: z.number(),
        lng: z.number(),
        date: dateInput.optional(),
        kind: z.enum(STOP_KINDS).default("custom"),
        note: z.string().max(1000).optional(),
        tz: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      logStopOp(ctx.db, {
        tripId: ctx.tripId,
        userId: ctx.session.user.id,
        name: input.name,
        lat: input.lat,
        lng: input.lng,
        date: input.date,
        kind: input.kind,
        note: input.note,
        tz: input.tz,
      }),
    ),

  /**
   * Correct a logged stop: rename, re-date (nights are aspirational), move its
   * location (re-routes the legs into and out of it), or change its kind.
   */
  updateStop: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        segmentId: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        date: dateInput.optional(),
        lat: z.number().optional(),
        lng: z.number().optional(),
        kind: z.enum(STOP_KINDS).optional(),
        note: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await updateStopOp(ctx.db, {
        tripId: ctx.tripId,
        segmentId: input.segmentId,
        name: input.name,
        date: input.date,
        lat: input.lat,
        lng: input.lng,
        kind: input.kind,
        note: input.note,
      });
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Stop not found." });
      }
      return result;
    }),

  /** Delete a logged stop and heal the chain (re-route the gap). */
  deleteStop: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        segmentId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await deleteStopOp(ctx.db, {
        tripId: ctx.tripId,
        segmentId: input.segmentId,
      });
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Stop not found." });
      }
      return result;
    }),
} satisfies TRPCRouterRecord;
