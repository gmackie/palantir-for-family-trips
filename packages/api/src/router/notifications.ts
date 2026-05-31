import { and, eq } from "@gmacko/db";
import { pushTokens } from "@gmacko/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";

export const notificationsRouter = {
  registerPushToken: protectedProcedure
    .input(
      z.object({
        token: z.string().min(1).max(255),
        platform: z.enum(["ios", "android"]).default("ios"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(pushTokens)
        .values({
          userId: ctx.session.user.id,
          token: input.token,
          platform: input.platform,
        })
        .onConflictDoUpdate({
          target: [pushTokens.userId, pushTokens.token],
          set: { updatedAt: new Date() },
        });

      return { registered: true };
    }),

  unregisterPushToken: protectedProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(pushTokens)
        .where(
          and(
            eq(pushTokens.userId, ctx.session.user.id),
            eq(pushTokens.token, input.token),
          ),
        );

      return { unregistered: true };
    }),
} satisfies TRPCRouterRecord;
