import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";
import { tripProcedure } from "../auth/guards";
import { steerCopilot } from "../copilot";
import { buildCopilotWorld } from "../copilot/world-ops";

/**
 * Chat-primary co-pilot: one planning turn per call, pure rules over the
 * trip's own world.
 *
 * The world is built from THIS trip's anchors and segments (see
 * `copilot/world-ops`). It used to come from `defaultSeedWorld` — a hardcoded
 * July-2026 dogfood run — which meant every trip was advised about Denver
 * deadlines and a Costco in Manteca. The co-pilot's whole premise is that it
 * never invents miles or places, and borrowing a stranger's route broke that
 * more thoroughly than any hallucination would.
 */
export const copilotRouter = {
  /**
   * One planning turn: message → reply + PlanOption cards.
   * Does not write the plan until the client calls applyOption (or replan).
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
    .mutation(async ({ ctx, input }) => {
      const world = await buildCopilotWorld(ctx.db, ctx.tripId);
      return steerCopilot({
        message: input.message,
        lat: input.lat,
        lng: input.lng,
        today: input.today,
        world,
      });
    }),

  /**
   * Drive-time lookup for UI facts without a full steer.
   *
   * `source: "missing"` is the honest answer for a leg this trip does not
   * have — the caller shows "unknown", never a number from somewhere else.
   */
  estimateDrive: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        fromKey: z.string().min(1),
        toKey: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const world = await buildCopilotWorld(ctx.db, ctx.tripId);
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
