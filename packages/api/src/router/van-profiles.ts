import { and, eq } from "@gmacko/db";
import { vanProfiles } from "@gmacko/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { workspaceProcedure } from "../auth/guards";

export const vanProfilesRouter = {
  list: workspaceProcedure()
    .input(z.object({ workspaceId: z.string().min(1) }))
    .query(async ({ ctx }) => {
      return ctx.db
        .select()
        .from(vanProfiles)
        .where(eq(vanProfiles.workspaceId, ctx.workspaceId));
    }),

  create: workspaceProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        name: z.string().min(1).max(100),
        vehicleType: z.string().max(50).optional(),
        year: z.number().int().min(1900).max(2100).optional(),
        make: z.string().max(100).optional(),
        model: z.string().max(100).optional(),
        fuelType: z.enum(["gas", "diesel", "e85"]).default("gas"),
        mpgEstimate: z.number().positive().optional(),
        tankGallons: z.number().positive().optional(),
        heightInches: z.number().int().positive().optional(),
        lengthFeet: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [profile] = await ctx.db
        .insert(vanProfiles)
        .values({
          workspaceId: ctx.workspaceId,
          userId: ctx.session.user.id,
          name: input.name,
          vehicleType: input.vehicleType,
          year: input.year,
          make: input.make,
          model: input.model,
          fuelType: input.fuelType,
          mpgEstimate: input.mpgEstimate?.toString(),
          tankGallons: input.tankGallons?.toString(),
          heightInches: input.heightInches,
          lengthFeet: input.lengthFeet,
        })
        .returning();
      return profile;
    }),

  update: workspaceProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        profileId: z.string().uuid(),
        name: z.string().min(1).max(100).optional(),
        mpgEstimate: z.number().positive().optional(),
        tankGallons: z.number().positive().optional(),
        fuelType: z.enum(["gas", "diesel", "e85"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const updates: Record<string, unknown> = {};
      if (input.name !== undefined) updates.name = input.name;
      if (input.mpgEstimate !== undefined)
        updates.mpgEstimate = input.mpgEstimate.toString();
      if (input.tankGallons !== undefined)
        updates.tankGallons = input.tankGallons.toString();
      if (input.fuelType !== undefined) updates.fuelType = input.fuelType;

      const [updated] = await ctx.db
        .update(vanProfiles)
        .set(updates)
        .where(
          and(
            eq(vanProfiles.id, input.profileId),
            eq(vanProfiles.workspaceId, ctx.workspaceId),
          ),
        )
        .returning();

      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),
} satisfies TRPCRouterRecord;
