import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { tripProcedure } from "../auth/guards";
import { computeServiceAlerts } from "../daymap/service-ops";

export const daymapRouter = {
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
