import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { tripProcedure } from "../auth/guards";
import {
  disableShare,
  enableShare,
  getShare,
  resolveSharedRecap,
} from "../route-planner/share-ops";
import { publicProcedure } from "../trpc";

const tripScoped = z.object({
  workspaceId: z.string().min(1),
  tripId: z.string().min(1),
});

export const shareRouter = {
  /** Current share state for the trip (token + enabled), or null. */
  get: tripProcedure()
    .input(tripScoped)
    .query(({ ctx }) => getShare(ctx.db, ctx.tripId)),

  /** Turn sharing on (mints a token on first enable, reuses it after). */
  enable: tripProcedure()
    .input(tripScoped)
    .mutation(({ ctx }) => enableShare(ctx.db, ctx.tripId)),

  /** Turn sharing off (link stops resolving; token is kept for re-enabling). */
  disable: tripProcedure()
    .input(tripScoped)
    .mutation(async ({ ctx }) => {
      await disableShare(ctx.db, ctx.tripId);
      return { ok: true };
    }),

  /**
   * PUBLIC — resolve a share token to a sanitized recap (no auth). Returns null
   * for unknown/disabled tokens. Never exposes expenses, member PII, or
   * workspace-scoped POIs.
   */
  publicRecap: publicProcedure
    .input(z.object({ token: z.string().min(8).max(64) }))
    .query(({ ctx, input }) => {
      const today = new Date().toISOString().slice(0, 10);
      return resolveSharedRecap(ctx.db, input.token, today);
    }),
} satisfies TRPCRouterRecord;
