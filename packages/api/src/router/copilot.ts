import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { defaultSeedWorld, steerCopilot } from "../copilot";
import { tripProcedure } from "../auth/guards";

/**
 * Chat-primary co-pilot. Pure rules + seed world for P0.
 * Later: merge SQLite pack / server POIs into world.
 */
export const copilotRouter = {
  /**
   * One planning turn: message → reply + PlanOption cards.
   * Does not write the plan until client calls applyOption (or planner replan).
   */
  steer: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        message: z.string().min(1).max(4000),
        lat: z.number().optional(),
        lng: z.number().optional(),
        today: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      }),
    )
    .mutation(({ input }) => {
      const world = defaultSeedWorld(input.tripId);
      return steerCopilot({
        message: input.message,
        lat: input.lat,
        lng: input.lng,
        today: input.today,
        world,
      });
    }),

  /** Seed leg lookup for UI facts without a full steer. */
  estimateDrive: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        fromKey: z.string().min(1),
        toKey: z.string().min(1),
      }),
    )
    .query(({ input }) => {
      const world = defaultSeedWorld(input.tripId);
      const leg = world.legs.find(
        (l) => l.fromKey === input.fromKey && l.toKey === input.toKey,
      );
      return {
        hours: leg?.hours ?? null,
        miles: leg?.miles ?? null,
        notes: leg?.notes ?? null,
        source: leg ? ("table" as const) : ("missing" as const),
      };
    }),
} satisfies TRPCRouterRecord;
