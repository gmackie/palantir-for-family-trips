import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { tripProcedure } from "../auth/guards";
import {
  computeNextAnchor,
  createAnchor,
  deleteAnchor,
  listAnchors,
  updateAnchor,
} from "../route-planner/anchor-ops";
import { resolveCurrentPoint } from "../route-planner/journey-logic";
import { eq } from "@sortey/db";
import { tripSegments } from "@sortey/db/schema";

const KINDS = ["event", "reservation", "lodging", "must_see"] as const;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const anchorFields = {
  title: z.string().min(1).max(300),
  kind: z.enum(KINDS).default("event"),
  placeName: z.string().max(300).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  startDate: DATE,
  endDate: DATE.nullable().optional(),
  confirmationCode: z.string().max(100).nullable().optional(),
  url: z.string().max(500).nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
};

async function currentPoint(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  tripId: string,
  today: string,
) {
  const segments = await db
    .select({
      sortOrder: tripSegments.sortOrder,
      originLat: tripSegments.originLat,
      originLng: tripSegments.originLng,
      originName: tripSegments.originName,
      destinationLat: tripSegments.destinationLat,
      destinationLng: tripSegments.destinationLng,
      destinationName: tripSegments.destinationName,
      startDate: tripSegments.startDate,
    })
    .from(tripSegments)
    .where(eq(tripSegments.tripId, tripId));
  return resolveCurrentPoint(segments, today);
}

export const anchorsRouter = {
  list: tripProcedure()
    .input(z.object({ workspaceId: z.string().min(1), tripId: z.string().min(1) }))
    .query(({ ctx }) => listAnchors(ctx.db, ctx.tripId)),

  /** The next upcoming anchor, paced from the trip's current position. */
  next: tripProcedure()
    .input(z.object({ workspaceId: z.string().min(1), tripId: z.string().min(1) }))
    .query(async ({ ctx }) => {
      const today = new Date().toISOString().slice(0, 10);
      const from = await currentPoint(ctx.db, ctx.tripId, today);
      return computeNextAnchor(ctx.db, { tripId: ctx.tripId, from, today });
    }),

  create: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        ...anchorFields,
      }),
    )
    .mutation(({ ctx, input }) => {
      const { workspaceId: _w, tripId: _t, ...fields } = input;
      return createAnchor(ctx.db, { tripId: ctx.tripId, ...fields });
    }),

  update: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        anchorId: z.string().uuid(),
        title: anchorFields.title.optional(),
        kind: z.enum(KINDS).optional(),
        placeName: anchorFields.placeName,
        lat: anchorFields.lat,
        lng: anchorFields.lng,
        startDate: DATE.optional(),
        endDate: anchorFields.endDate,
        confirmationCode: anchorFields.confirmationCode,
        url: anchorFields.url,
        note: anchorFields.note,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await updateAnchor(ctx.db, {
        tripId: ctx.tripId,
        anchorId: input.anchorId,
        title: input.title,
        kind: input.kind,
        placeName: input.placeName,
        lat: input.lat,
        lng: input.lng,
        startDate: input.startDate,
        endDate: input.endDate,
        confirmationCode: input.confirmationCode,
        url: input.url,
        note: input.note,
      });
      return { ok: true };
    }),

  delete: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        anchorId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await deleteAnchor(ctx.db, input.anchorId);
      return { ok: true };
    }),
} satisfies TRPCRouterRecord;
