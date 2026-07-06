import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { tripProcedure } from "../auth/guards";
import { computeBriefing } from "../daymap/briefing-ops";
import { computeServiceAlerts } from "../daymap/service-ops";

const levelsInput = z
  .object({
    grey: z.number().min(0).max(100).optional(),
    black: z.number().min(0).max(100).optional(),
    fresh: z.number().min(0).max(100).optional(),
    propane: z.number().min(0).max(100).optional(),
  })
  .optional();

export const daymapRouter = {
  /**
   * The daily day-map: "what does today look like physically?" — assembles the
   * day's drive, weather, predictive service, and curated nearby POIs into a
   * time-blocked schedule. Fail-soft (null when there's no position).
   */
  briefing: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        levels: levelsInput,
      }),
    )
    .query(({ ctx, input }) =>
      computeBriefing(ctx.db, {
        tripId: ctx.tripId,
        date: input.date,
        levels: input.levels,
      }),
    ),

  /**
   * Predictive van-service alerts: "service before it becomes urgent". Given
   * current resource levels (manual now, DriftPort telemetry later), forecast
   * when each needs service and match to the nearest corridor POI ahead.
   * Fail-soft — empty alerts when there's no position or no levels.
   */
  serviceAlerts: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        levels: z
          .object({
            grey: z.number().min(0).max(100).optional(),
            black: z.number().min(0).max(100).optional(),
            fresh: z.number().min(0).max(100).optional(),
            propane: z.number().min(0).max(100).optional(),
          })
          .optional(),
      }),
    )
    .query(({ ctx, input }) =>
      computeServiceAlerts(ctx.db, {
        tripId: ctx.tripId,
        levels: input.levels,
      }),
    ),
} satisfies TRPCRouterRecord;
