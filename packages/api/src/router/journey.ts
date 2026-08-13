import { randomUUID } from "node:crypto";
import { and, asc, eq } from "@sortey/db";
import {
  journeyStops,
  pins,
  tripPhotos,
  tripSegments,
} from "@sortey/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { tripProcedure } from "../auth/guards";
import {
  affectedLegIds,
  planMove,
  STOP_KINDS,
} from "../route-planner/journey-logic";
import {
  deleteStopOp,
  logStopOp,
  updateStopOp,
} from "../route-planner/journey-ops";
import { reverseGeocode, routeLeg } from "../route-planner/routing";
import { protectedProcedure } from "../trpc";

const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const journeyRouter = {
  /** List recorded progress only; planned route segments never appear here. */
  list: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
      }),
    )
    .query(async ({ ctx }) => {
      const rows = await ctx.db
        .select({
          id: journeyStops.id,
          segmentId: journeyStops.segmentId,
          sortOrder: journeyStops.sortOrder,
          kind: journeyStops.kind,
          arrivedAt: journeyStops.arrivedAt,
          note: journeyStops.note,
          routeStatus: journeyStops.routeStatus,
          createdByUserId: journeyStops.createdByUserId,
          name: tripSegments.destinationName,
          lat: tripSegments.destinationLat,
          lng: tripSegments.destinationLng,
          originName: tripSegments.originName,
          distanceMiles: tripSegments.distanceMiles,
          durationMinutes: tripSegments.durationMinutes,
          routePolyline: tripSegments.routePolyline,
          pinId: pins.id,
        })
        .from(journeyStops)
        .innerJoin(tripSegments, eq(tripSegments.id, journeyStops.segmentId))
        .leftJoin(
          pins,
          and(
            eq(pins.tripId, ctx.tripId),
            eq(pins.segmentId, journeyStops.segmentId),
          ),
        )
        .where(eq(journeyStops.tripId, ctx.tripId))
        .orderBy(asc(journeyStops.sortOrder));

      return Promise.all(
        rows.map(async (row) => {
          const photos = await ctx.db
            .select({
              id: tripPhotos.id,
              storageKey: tripPhotos.storageKey,
              caption: tripPhotos.caption,
              takenAt: tripPhotos.takenAt,
            })
            .from(tripPhotos)
            .where(
              and(
                eq(tripPhotos.tripId, ctx.tripId),
                eq(tripPhotos.segmentId, row.segmentId),
              ),
            );
          return { ...row, photos };
        }),
      );
    }),

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
        stopId: z.string().uuid().optional(),
        name: z.string().min(1).max(200),
        lat: z.number(),
        lng: z.number(),
        date: dateInput.optional(),
        arrivedAt: z.string().datetime().optional(),
        kind: z.enum(STOP_KINDS).default("custom"),
        note: z.string().max(1000).nullish(),
        tz: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      logStopOp(ctx.db, {
        stopId: input.stopId ?? randomUUID(),
        tripId: ctx.tripId,
        userId: ctx.session.user.id,
        name: input.name,
        lat: input.lat,
        lng: input.lng,
        arrivedAt: input.arrivedAt
          ? new Date(input.arrivedAt)
          : input.date
            ? new Date(`${input.date}T12:00:00.000Z`)
            : new Date(),
        kind: input.kind,
        note: input.note ?? undefined,
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
        stopId: z.string().uuid().optional(),
        segmentId: z.string().uuid().optional(),
        name: z.string().min(1).max(200).optional(),
        date: dateInput.optional(),
        lat: z.number().optional(),
        lng: z.number().optional(),
        kind: z.enum(STOP_KINDS).optional(),
        note: z.string().max(1000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const segmentId =
        input.segmentId ??
        (
          await ctx.db
            .select({ segmentId: journeyStops.segmentId })
            .from(journeyStops)
            .where(
              and(
                eq(journeyStops.id, input.stopId ?? ""),
                eq(journeyStops.tripId, ctx.tripId),
              ),
            )
            .limit(1)
        )[0]?.segmentId;
      if (!segmentId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Stop not found." });
      }
      const result = await updateStopOp(ctx.db, {
        tripId: ctx.tripId,
        segmentId,
        name: input.name,
        date: input.date,
        lat: input.lat,
        lng: input.lng,
        kind: input.kind,
        note: input.note ?? undefined,
      });
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Stop not found." });
      }
      if (input.stopId) {
        await ctx.db
          .update(journeyStops)
          .set({
            ...(input.kind !== undefined ? { kind: input.kind } : {}),
            ...(input.note !== undefined ? { note: input.note } : {}),
            ...(input.date !== undefined
              ? { arrivedAt: new Date(`${input.date}T12:00:00.000Z`) }
              : {}),
          })
          .where(
            and(
              eq(journeyStops.id, input.stopId),
              eq(journeyStops.tripId, ctx.tripId),
            ),
          );
      }
      return result;
    }),

  moveStop: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        stopId: z.string().uuid(),
        direction: z.enum(["earlier", "later"]),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const rows = await tx
          .select({ id: journeyStops.id, sortOrder: journeyStops.sortOrder })
          .from(journeyStops)
          .where(eq(journeyStops.tripId, ctx.tripId))
          .orderBy(asc(journeyStops.sortOrder));
        const before = rows.map((row) => row.id);
        const after = planMove(before, input.stopId, input.direction);
        if (before.every((id, index) => id === after[index])) {
          return { moved: false, pendingRouteStopIds: [] };
        }
        for (let index = 0; index < after.length; index++) {
          await tx
            .update(journeyStops)
            .set({ sortOrder: -(index + 1) })
            .where(eq(journeyStops.id, after[index]!));
        }
        for (let index = 0; index < after.length; index++) {
          await tx
            .update(journeyStops)
            .set({ sortOrder: index })
            .where(eq(journeyStops.id, after[index]!));
        }
        const pendingRouteStopIds = affectedLegIds(before, after);
        for (const id of pendingRouteStopIds) {
          await tx
            .update(journeyStops)
            .set({ routeStatus: "pending" })
            .where(eq(journeyStops.id, id));
        }
        return { moved: true, pendingRouteStopIds };
      }),
    ),

  retryRoute: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        stopId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: journeyStops.id,
          segmentId: journeyStops.segmentId,
          sortOrder: journeyStops.sortOrder,
          name: tripSegments.destinationName,
          lat: tripSegments.destinationLat,
          lng: tripSegments.destinationLng,
        })
        .from(journeyStops)
        .innerJoin(tripSegments, eq(tripSegments.id, journeyStops.segmentId))
        .where(eq(journeyStops.tripId, ctx.tripId))
        .orderBy(asc(journeyStops.sortOrder));
      const index = rows.findIndex((row) => row.id === input.stopId);
      const target = rows[index];
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Stop not found." });
      }
      const previous = rows[index - 1];
      if (!previous) {
        await ctx.db
          .update(journeyStops)
          .set({ routeStatus: "ready" })
          .where(eq(journeyStops.id, target.id));
        return { routeStatus: "ready" as const };
      }
      const origin = {
        name: previous.name ?? "Previous stop",
        lat: Number(previous.lat),
        lng: Number(previous.lng),
      };
      const destination = {
        name: target.name ?? "Stop",
        lat: Number(target.lat),
        lng: Number(target.lng),
      };
      const routed = await routeLeg(origin, destination);
      if (!routed) return { routeStatus: "pending" as const };
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(tripSegments)
          .set({
            originName: origin.name,
            originLat: origin.lat,
            originLng: origin.lng,
            routePolyline: routed.polyline,
            distanceMiles: routed.miles,
            durationMinutes: routed.minutes,
          })
          .where(eq(tripSegments.id, target.segmentId));
        await tx
          .update(journeyStops)
          .set({ routeStatus: "ready" })
          .where(eq(journeyStops.id, target.id));
      });
      return { routeStatus: "ready" as const };
    }),

  /** Delete a logged stop and heal the chain (re-route the gap). */
  deleteStop: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        stopId: z.string().uuid().optional(),
        segmentId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const segmentId =
        input.segmentId ??
        (
          await ctx.db
            .select({ segmentId: journeyStops.segmentId })
            .from(journeyStops)
            .where(
              and(
                eq(journeyStops.id, input.stopId ?? ""),
                eq(journeyStops.tripId, ctx.tripId),
              ),
            )
            .limit(1)
        )[0]?.segmentId;
      if (!segmentId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Stop not found." });
      }
      const result = await deleteStopOp(ctx.db, {
        tripId: ctx.tripId,
        segmentId,
      });
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Stop not found." });
      }
      return result;
    }),
} satisfies TRPCRouterRecord;
