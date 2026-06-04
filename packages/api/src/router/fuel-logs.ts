import { and, desc, eq } from "@sortey/db";
import { fuelLogs } from "@sortey/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { tripProcedure } from "../auth/guards";

export const fuelLogsRouter = {
  list: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
      }),
    )
    .query(async ({ ctx }) => {
      const logs = await ctx.db
        .select()
        .from(fuelLogs)
        .where(eq(fuelLogs.tripId, ctx.tripId))
        .orderBy(desc(fuelLogs.loggedAt));

      // Calculate MPG between consecutive fills
      const withMpg = logs.map((log, i) => {
        const prevLog = logs[i + 1]; // logs are desc by date, so i+1 is the previous fill
        let actualMpg: number | null = null;
        if (prevLog && log.odometerMiles && prevLog.odometerMiles) {
          const milesDriven =
            Number(log.odometerMiles) - Number(prevLog.odometerMiles);
          if (milesDriven > 0 && Number(log.gallons) > 0) {
            actualMpg =
              Math.round((milesDriven / Number(log.gallons)) * 10) / 10;
          }
        }
        return { ...log, actualMpg };
      });

      return withMpg;
    }),

  create: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        segmentId: z.string().uuid().optional(),
        vanProfileId: z.string().uuid().optional(),
        odometerMiles: z.number().positive().optional(),
        gallons: z.number().positive(),
        pricePerGallon: z.number().positive(),
        totalCents: z.number().int().nonnegative(),
        fuelType: z.enum(["gas", "diesel", "e85"]).default("gas"),
        stationName: z.string().max(200).optional(),
        stationLat: z.number().optional(),
        stationLng: z.number().optional(),
        isCostco: z.boolean().default(false),
        loggedAt: z.string().datetime(),
        expenseId: z.string().uuid().optional(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [log] = await ctx.db
        .insert(fuelLogs)
        .values({
          tripId: ctx.tripId,
          segmentId: input.segmentId,
          userId: ctx.session.user.id,
          vanProfileId: input.vanProfileId,
          odometerMiles: input.odometerMiles?.toString(),
          gallons: input.gallons.toString(),
          pricePerGallon: input.pricePerGallon.toString(),
          totalCents: input.totalCents,
          fuelType: input.fuelType,
          stationName: input.stationName,
          stationLat: input.stationLat?.toString(),
          stationLng: input.stationLng?.toString(),
          isCostco: input.isCostco,
          loggedAt: new Date(input.loggedAt),
          expenseId: input.expenseId,
          notes: input.notes,
        })
        .returning();
      return log;
    }),

  stats: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
      }),
    )
    .query(async ({ ctx }) => {
      const logs = await ctx.db
        .select()
        .from(fuelLogs)
        .where(eq(fuelLogs.tripId, ctx.tripId))
        .orderBy(desc(fuelLogs.loggedAt));

      if (logs.length === 0) {
        return {
          totalFuelCents: 0,
          totalGallons: 0,
          avgPricePerGallon: 0,
          avgMpg: null,
          costPerMile: null,
          fillCount: 0,
        };
      }

      const totalFuelCents = logs.reduce((sum, l) => sum + l.totalCents, 0);
      const totalGallons = logs.reduce((sum, l) => sum + Number(l.gallons), 0);
      const avgPricePerGallon =
        totalGallons > 0 ? totalFuelCents / totalGallons / 100 : 0;

      let avgMpg: number | null = null;
      let costPerMile: number | null = null;
      if (logs.length >= 2) {
        const first = logs[logs.length - 1]!;
        const last = logs[0]!;
        if (first.odometerMiles && last.odometerMiles) {
          const totalMiles =
            Number(last.odometerMiles) - Number(first.odometerMiles);
          if (totalMiles > 0 && totalGallons > 0) {
            avgMpg = Math.round((totalMiles / totalGallons) * 10) / 10;
            costPerMile = Math.round(totalFuelCents / totalMiles) / 100;
          }
        }
      }

      return {
        totalFuelCents,
        totalGallons,
        avgPricePerGallon,
        avgMpg,
        costPerMile,
        fillCount: logs.length,
      };
    }),
} satisfies TRPCRouterRecord;
