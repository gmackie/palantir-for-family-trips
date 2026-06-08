import { and, asc, desc, eq } from "@sortey/db";
import { expenses, fuelLogs, tripMembers, tripSegments } from "@sortey/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { tripProcedure } from "../auth/guards";
import {
  buildFuelExpenseValues,
  type FuelExpenseValues,
  type FuelLogForSplit,
} from "../fuel/split-expense";

type FuelLogRow = typeof fuelLogs.$inferSelect;

/**
 * DB seam for the gas-split flow. Each method is one IO step so the
 * orchestration logic fn below stays in-memory-testable (mirrors the
 * chat.ts store pattern).
 */
export interface FuelLogStore {
  insertFuelLog(values: {
    tripId: string;
    segmentId: string | null;
    userId: string;
    vanProfileId: string | null;
    odometerMiles: string | null;
    gallons: string;
    pricePerGallon: string;
    totalCents: number;
    fuelType: string;
    stationName: string | null;
    stationLat: string | null;
    stationLng: string | null;
    isCostco: boolean;
    loggedAt: Date;
    expenseId: string | null;
    notes: string | null;
  }): Promise<FuelLogRow>;
  // Returns the trip's default segment id (first by sort order), or null when
  // the trip has no segments. Used to scope the split expense.
  findDefaultSegmentId(tripId: string): Promise<string | null>;
  // Verifies a segment belongs to the trip; null if it doesn't.
  findSegmentId(input: {
    tripId: string;
    segmentId: string;
  }): Promise<string | null>;
  listTripMemberIds(tripId: string): Promise<string[]>;
  insertExpense(values: FuelExpenseValues): Promise<{ id: string }>;
  linkExpenseToFuelLog(input: {
    fuelLogId: string;
    expenseId: string;
  }): Promise<FuelLogRow>;
}

// biome-ignore lint/suspicious/noExplicitAny: Drizzle db type is complex
export function createFuelLogStore(db: any): FuelLogStore {
  return {
    insertFuelLog: async (values) => {
      const [created] = (await db
        .insert(fuelLogs)
        .values(values)
        .returning()) as FuelLogRow[];
      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to log fuel.",
        });
      }
      return created;
    },
    findDefaultSegmentId: async (tripId) => {
      const [segment] = (await db
        .select({ id: tripSegments.id })
        .from(tripSegments)
        .where(eq(tripSegments.tripId, tripId))
        .orderBy(asc(tripSegments.sortOrder))
        .limit(1)) as Array<{ id: string }>;
      return segment?.id ?? null;
    },
    findSegmentId: async ({ tripId, segmentId }) => {
      const [segment] = (await db
        .select({ id: tripSegments.id })
        .from(tripSegments)
        .where(
          and(eq(tripSegments.id, segmentId), eq(tripSegments.tripId, tripId)),
        )
        .limit(1)) as Array<{ id: string }>;
      return segment?.id ?? null;
    },
    listTripMemberIds: async (tripId) => {
      const members = (await db
        .select({ userId: tripMembers.userId })
        .from(tripMembers)
        .where(eq(tripMembers.tripId, tripId))) as Array<{ userId: string }>;
      return members.map((m) => m.userId);
    },
    insertExpense: async (values) => {
      const [created] = (await db
        .insert(expenses)
        .values({ ...values, status: "draft" })
        .returning({ id: expenses.id })) as Array<{ id: string }>;
      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create the split expense.",
        });
      }
      return created;
    },
    linkExpenseToFuelLog: async ({ fuelLogId, expenseId }) => {
      const [updated] = (await db
        .update(fuelLogs)
        .set({ expenseId })
        .where(eq(fuelLogs.id, fuelLogId))
        .returning()) as FuelLogRow[];
      if (!updated) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to link the split expense.",
        });
      }
      return updated;
    },
  };
}

export type CreateFuelLogResult = {
  log: FuelLogRow;
  // Set when a split was requested but couldn't be created because the trip
  // has no segment to scope the expense to. The log is still returned.
  splitSkipped?: "no_segment";
};

/**
 * Orchestrates logging a fill-up and (optionally) splitting it into a group
 * expense. The pure money/shape logic lives in `buildFuelExpenseValues`; the
 * equal split itself is implicit (the expense has no line items, so
 * `computeExpenseShares` divides the total across members at read time).
 *
 * Side effects are sequenced here against the injected store so this is
 * unit-testable with an in-memory mock. Logging fuel must always succeed: if no
 * segment is available to scope the split, we skip the expense and return the
 * log with `splitSkipped: "no_segment"` rather than throwing.
 */
export async function createFuelLogWithSplit(
  store: FuelLogStore,
  input: {
    tripId: string;
    userId: string;
    segmentId: string | null;
    vanProfileId: string | null;
    odometerMiles: string | null;
    gallons: string;
    pricePerGallon: string;
    totalCents: number;
    fuelType: string;
    stationName: string | null;
    stationLat: string | null;
    stationLng: string | null;
    isCostco: boolean;
    loggedAt: Date;
    expenseId: string | null;
    notes: string | null;
    splitWithGroup: boolean;
    currency: string;
  },
): Promise<CreateFuelLogResult> {
  const log = await store.insertFuelLog({
    tripId: input.tripId,
    segmentId: input.segmentId,
    userId: input.userId,
    vanProfileId: input.vanProfileId,
    odometerMiles: input.odometerMiles,
    gallons: input.gallons,
    pricePerGallon: input.pricePerGallon,
    totalCents: input.totalCents,
    fuelType: input.fuelType,
    stationName: input.stationName,
    stationLat: input.stationLat,
    stationLng: input.stationLng,
    isCostco: input.isCostco,
    loggedAt: input.loggedAt,
    expenseId: input.expenseId,
    notes: input.notes,
  });

  if (!input.splitWithGroup) {
    return { log };
  }

  // Resolve a segment to scope the expense: explicit input first (verified
  // against the trip), then the trip's default segment by sort order.
  let segmentId: string | null = null;
  if (input.segmentId) {
    segmentId = await store.findSegmentId({
      tripId: input.tripId,
      segmentId: input.segmentId,
    });
  }
  segmentId ??= await store.findDefaultSegmentId(input.tripId);

  if (!segmentId) {
    // No segment to attach the expense to — skip the split, keep the log.
    return { log, splitSkipped: "no_segment" };
  }

  const fuelLog: FuelLogForSplit = {
    tripId: log.tripId,
    totalCents: log.totalCents,
    stationName: log.stationName,
    loggedAt: log.loggedAt,
  };

  // The whole total is the shared pool; members drive the read-time split.
  await store.listTripMemberIds(input.tripId);

  const values = buildFuelExpenseValues({
    fuelLog,
    segmentId,
    payerUserId: input.userId,
    currency: input.currency,
  });

  const expense = await store.insertExpense(values);
  const linked = await store.linkExpenseToFuelLog({
    fuelLogId: log.id,
    expenseId: expense.id,
  });

  return { log: linked };
}

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
        currency: z.string().length(3).toUpperCase().default("USD"),
        // When true, the fill-up is also recorded as an equal-split `fuel`
        // expense across trip members and linked back via `expenseId`.
        splitWithGroup: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await createFuelLogWithSplit(createFuelLogStore(ctx.db), {
        tripId: ctx.tripId,
        userId: ctx.session.user.id,
        segmentId: input.segmentId ?? null,
        vanProfileId: input.vanProfileId ?? null,
        odometerMiles: input.odometerMiles?.toString() ?? null,
        gallons: input.gallons.toString(),
        pricePerGallon: input.pricePerGallon.toString(),
        totalCents: input.totalCents,
        fuelType: input.fuelType,
        stationName: input.stationName ?? null,
        stationLat: input.stationLat?.toString() ?? null,
        stationLng: input.stationLng?.toString() ?? null,
        isCostco: input.isCostco,
        loggedAt: new Date(input.loggedAt),
        expenseId: input.expenseId ?? null,
        notes: input.notes ?? null,
        splitWithGroup: input.splitWithGroup,
        currency: input.currency,
      });
      return result.log;
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
