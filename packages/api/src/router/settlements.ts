import { and, desc, eq, inArray, isNull } from "@sortey/db";
import {
  expenses,
  lineItemClaims,
  lineItems,
  settlements,
  tripMembers,
} from "@sortey/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { tripProcedure } from "../auth/guards";
import { computeNetBalances, minimizeTransactions } from "../expenses/settle";
import { computeExpenseShares } from "../expenses/shares";

// ─── Store interface ────────────────────────────────────────────────────────

export interface SettlementStore {
  listFinalizedExpenses(tripId: string): Promise<
    Array<{
      id: string;
      payerUserId: string;
      subtotalCents: number;
      taxCents: number;
      tipCents: number;
    }>
  >;
  listLineItems(expenseIds: string[]): Promise<
    Array<{
      id: string;
      expenseId: string;
      lineTotalCents: number;
    }>
  >;
  listClaims(lineItemIds: string[]): Promise<
    Array<{
      lineItemId: string;
      userId: string;
    }>
  >;
  listTripMembers(tripId: string): Promise<
    Array<{
      userId: string;
      displayName: string | null;
      venmoHandle: string | null;
    }>
  >;
  listActiveSettlements(tripId: string): Promise<
    Array<{
      fromUserId: string;
      toUserId: string;
      amountCents: number;
    }>
  >;
}

// ─── Drizzle implementation ─────────────────────────────────────────────────

export function createSettlementStore(db: any): SettlementStore {
  return {
    async listFinalizedExpenses(tripId) {
      return (await db
        .select({
          id: expenses.id,
          payerUserId: expenses.payerUserId,
          subtotalCents: expenses.subtotalCents,
          taxCents: expenses.taxCents,
          tipCents: expenses.tipCents,
        })
        .from(expenses)
        .where(
          and(eq(expenses.tripId, tripId), eq(expenses.status, "finalized")),
        )) as Array<{
        id: string;
        payerUserId: string;
        subtotalCents: number;
        taxCents: number;
        tipCents: number;
      }>;
    },

    async listLineItems(expenseIds) {
      if (expenseIds.length === 0) return [];
      return (await db
        .select({
          id: lineItems.id,
          expenseId: lineItems.expenseId,
          lineTotalCents: lineItems.lineTotalCents,
        })
        .from(lineItems)
        .where(inArray(lineItems.expenseId, expenseIds))) as Array<{
        id: string;
        expenseId: string;
        lineTotalCents: number;
      }>;
    },

    async listClaims(lineItemIds) {
      if (lineItemIds.length === 0) return [];
      return (await db
        .select({
          lineItemId: lineItemClaims.lineItemId,
          userId: lineItemClaims.userId,
        })
        .from(lineItemClaims)
        .where(inArray(lineItemClaims.lineItemId, lineItemIds))) as Array<{
        lineItemId: string;
        userId: string;
      }>;
    },

    async listTripMembers(tripId) {
      return (await db
        .select({
          userId: tripMembers.userId,
          displayName: tripMembers.displayName,
          venmoHandle: tripMembers.venmoHandle,
        })
        .from(tripMembers)
        .where(eq(tripMembers.tripId, tripId))) as Array<{
        userId: string;
        displayName: string | null;
        venmoHandle: string | null;
      }>;
    },

    async listActiveSettlements(tripId) {
      return (await db
        .select({
          fromUserId: settlements.fromUserId,
          toUserId: settlements.toUserId,
          amountCents: settlements.amountCents,
        })
        .from(settlements)
        .where(
          and(eq(settlements.tripId, tripId), isNull(settlements.undoneAt)),
        )) as Array<{
        fromUserId: string;
        toUserId: string;
        amountCents: number;
      }>;
    },
  };
}

// ─── Domain function ────────────────────────────────────────────────────────

export async function buildSettlementSummary(
  store: SettlementStore,
  input: { tripId: string },
): Promise<{
  balances: Array<{ userId: string; amountCents: number }>;
  suggestedTransactions: Array<{
    fromUserId: string;
    toUserId: string;
    amountCents: number;
  }>;
  allSettled: boolean;
  members: Array<{
    userId: string;
    displayName: string | null;
    venmoHandle: string | null;
  }>;
}> {
  const { tripId } = input;

  // Batch load: all finalized expenses in one query
  const finalizedExpenses = await store.listFinalizedExpenses(tripId);
  const members = await store.listTripMembers(tripId);
  const participantUserIds = members.map((m) => m.userId);

  // Batch load: all line items for all finalized expenses in one query
  const expenseIds = finalizedExpenses.map((e) => e.id);
  const allLineItems = await store.listLineItems(expenseIds);

  // Batch load: all claims for all line items in one query
  const allItemIds = allLineItems.map((i) => i.id);
  const allClaims = await store.listClaims(allItemIds);

  // Group line items by expenseId
  const itemsByExpense = new Map<
    string,
    Array<{ id: string; expenseId: string; lineTotalCents: number }>
  >();
  for (const item of allLineItems) {
    const existing = itemsByExpense.get(item.expenseId) ?? [];
    existing.push(item);
    itemsByExpense.set(item.expenseId, existing);
  }

  // Group claims by lineItemId
  const claimantsByLineItem = new Map<string, string[]>();
  for (const claim of allClaims) {
    const existing = claimantsByLineItem.get(claim.lineItemId) ?? [];
    existing.push(claim.userId);
    claimantsByLineItem.set(claim.lineItemId, existing);
  }

  // Compute per-expense shares using in-memory maps (no more per-expense queries)
  const expenseShares: Array<{
    payerUserId: string;
    shares: Array<{ userId: string; totalCents: number }>;
  }> = [];

  for (const expense of finalizedExpenses) {
    const items = itemsByExpense.get(expense.id) ?? [];

    const result = computeExpenseShares({
      payerUserId: expense.payerUserId,
      subtotalCents: expense.subtotalCents,
      taxCents: expense.taxCents,
      tipCents: expense.tipCents,
      participantUserIds,
      lineItems: items.map((item) => ({
        id: item.id,
        lineTotalCents: item.lineTotalCents,
        claimantUserIds: claimantsByLineItem.get(item.id) ?? [],
      })),
    });

    expenseShares.push({
      payerUserId: expense.payerUserId,
      shares: result.shares,
    });
  }

  // Load and apply active settlements
  const activeSettlements = await store.listActiveSettlements(tripId);

  const balancesMap = computeNetBalances({
    expenseShares,
    settlements: activeSettlements,
  });

  const suggestedTransactions = minimizeTransactions(balancesMap);

  const balances = Array.from(balancesMap.entries()).map(
    ([userId, amountCents]) => ({ userId, amountCents }),
  );

  const allSettled =
    balances.length === 0 && suggestedTransactions.length === 0;

  return {
    balances,
    suggestedTransactions,
    allSettled,
    members,
  };
}

// ─── Router ─────────────────────────────────────────────────────────────────

export const settlementsRouter = {
  /**
   * Compute the settlement summary for a trip: net balances and
   * suggested minimum transactions to settle all debts.
   */
  summary: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
      }),
    )
    .query(async ({ ctx }) => {
      return buildSettlementSummary(createSettlementStore(ctx.db), {
        tripId: ctx.tripId,
      });
    }),

  /**
   * Record a settlement payment between two trip members.
   * Deduplicates on idempotencyKey.
   */
  record: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        fromUserId: z.string().min(1),
        toUserId: z.string().min(1),
        amountCents: z.number().int().positive(),
        idempotencyKey: z.string().min(1).max(255),
        note: z.string().max(500).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Validate both users are trip members
      const members = (await ctx.db
        .select({ userId: tripMembers.userId })
        .from(tripMembers)
        .where(eq(tripMembers.tripId, ctx.tripId))) as Array<{
        userId: string;
      }>;
      const memberIds = new Set(members.map((m) => m.userId));

      if (!memberIds.has(input.fromUserId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "From-user is not a member of this trip.",
        });
      }
      if (!memberIds.has(input.toUserId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "To-user is not a member of this trip.",
        });
      }
      if (input.fromUserId === input.toUserId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot settle with yourself.",
        });
      }

      const [created] = (await ctx.db
        .insert(settlements)
        .values({
          tripId: ctx.tripId,
          fromUserId: input.fromUserId,
          toUserId: input.toUserId,
          amountCents: input.amountCents,
          idempotencyKey: input.idempotencyKey,
          note: input.note ?? null,
        })
        .onConflictDoNothing({ target: settlements.idempotencyKey })
        .returning()) as Array<typeof settlements.$inferSelect>;

      // If conflict (duplicate key), return the existing one
      if (!created) {
        const [existing] = (await ctx.db
          .select()
          .from(settlements)
          .where(eq(settlements.idempotencyKey, input.idempotencyKey))
          .limit(1)) as Array<typeof settlements.$inferSelect>;
        return existing!;
      }

      return created;
    }),

  /**
   * Undo a settlement (set undoneAt). Refuses if > 24h since settledAt.
   */
  undo: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        settlementId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [settlement] = (await ctx.db
        .select()
        .from(settlements)
        .where(
          and(
            eq(settlements.id, input.settlementId),
            eq(settlements.tripId, ctx.tripId),
          ),
        )
        .limit(1)) as Array<typeof settlements.$inferSelect>;

      if (!settlement) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Settlement not found.",
        });
      }

      if (settlement.undoneAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Settlement is already undone.",
        });
      }

      const hoursSinceSettled =
        (Date.now() - new Date(settlement.settledAt).getTime()) /
        (1000 * 60 * 60);

      if (hoursSinceSettled > 24) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot undo a settlement older than 24 hours.",
        });
      }

      const [updated] = (await ctx.db
        .update(settlements)
        .set({ undoneAt: new Date() })
        .where(eq(settlements.id, input.settlementId))
        .returning()) as Array<typeof settlements.$inferSelect>;

      return updated!;
    }),

  /**
   * List all settlements for the trip, newest first.
   */
  history: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
      }),
    )
    .query(async ({ ctx }) => {
      const rows = (await ctx.db
        .select()
        .from(settlements)
        .where(eq(settlements.tripId, ctx.tripId))
        .orderBy(desc(settlements.createdAt))) as Array<
        typeof settlements.$inferSelect
      >;

      return rows;
    }),
} satisfies TRPCRouterRecord;
