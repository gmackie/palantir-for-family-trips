import { and, desc, eq, isNull } from "@gmacko/db";
import {
  expenses,
  lineItemClaims,
  lineItems,
  settlements,
  tripMembers,
} from "@gmacko/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { tripProcedure } from "../auth/guards";
import { computeExpenseShares } from "../expenses/shares";
import { computeNetBalances, minimizeTransactions } from "../expenses/settle";

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
      // Load all finalized expenses for this trip
      const finalizedExpenses = (await ctx.db
        .select()
        .from(expenses)
        .where(
          and(
            eq(expenses.tripId, ctx.tripId),
            eq(expenses.status, "finalized"),
          ),
        )) as Array<typeof expenses.$inferSelect>;

      // Load trip members for participant pool
      const members = (await ctx.db
        .select({
          userId: tripMembers.userId,
          displayName: tripMembers.displayName,
          venmoHandle: tripMembers.venmoHandle,
        })
        .from(tripMembers)
        .where(eq(tripMembers.tripId, ctx.tripId))) as Array<{
        userId: string;
        displayName: string | null;
        venmoHandle: string | null;
      }>;

      const participantUserIds = members.map((m) => m.userId);

      // For each expense, load line items + claims and compute shares
      const expenseShares: Array<{
        payerUserId: string;
        shares: Array<{ userId: string; totalCents: number }>;
      }> = [];

      for (const expense of finalizedExpenses) {
        const items = (await ctx.db
          .select()
          .from(lineItems)
          .where(eq(lineItems.expenseId, expense.id))) as Array<
          typeof lineItems.$inferSelect
        >;

        const itemIds = items.map((i) => i.id);
        let claims: Array<typeof lineItemClaims.$inferSelect> = [];
        if (itemIds.length > 0) {
          claims = (await ctx.db
            .select()
            .from(lineItemClaims)
            .where(eq(lineItems.expenseId, expense.id))) as Array<
            typeof lineItemClaims.$inferSelect
          >;
        }

        const claimantsByLineItem = new Map<string, string[]>();
        for (const claim of claims) {
          const existing = claimantsByLineItem.get(claim.lineItemId) ?? [];
          existing.push(claim.userId);
          claimantsByLineItem.set(claim.lineItemId, existing);
        }

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

      // Load non-undone settlements
      const activeSettlements = (await ctx.db
        .select()
        .from(settlements)
        .where(
          and(
            eq(settlements.tripId, ctx.tripId),
            isNull(settlements.undoneAt),
          ),
        )) as Array<typeof settlements.$inferSelect>;

      const balancesMap = computeNetBalances({
        expenseShares,
        settlements: activeSettlements.map((s) => ({
          fromUserId: s.fromUserId,
          toUserId: s.toUserId,
          amountCents: s.amountCents,
        })),
      });

      const suggestedTransactions = minimizeTransactions(balancesMap);

      // Convert Map to array for serialization
      const balances = Array.from(balancesMap.entries()).map(
        ([userId, amountCents]) => ({
          userId,
          amountCents,
        }),
      );

      const allSettled =
        balances.length === 0 && suggestedTransactions.length === 0;

      return {
        balances,
        suggestedTransactions,
        allSettled,
        members,
      };
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
          message:
            "Cannot undo a settlement older than 24 hours.",
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
