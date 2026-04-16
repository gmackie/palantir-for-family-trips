import { and, asc, desc, eq } from "@gmacko/db";
import {
  expenses,
  lineItemClaims,
  lineItems,
  receiptImages,
  tripMembers,
  tripSegments,
} from "@gmacko/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { tripProcedure } from "../auth/guards";
import { computeExpenseShares } from "../expenses/shares";

const expenseCategoryEnum = z.enum([
  "meal",
  "transit",
  "lodging",
  "activity",
  "drinks",
  "tickets",
  "general",
]);

const currencySchema = z.string().length(3).toUpperCase();

function requireOrganizerOrSelf(
  tripRole: "organizer" | "member",
  payerUserId: string,
  ctxUserId: string,
) {
  if (tripRole === "organizer") return;
  if (payerUserId === ctxUserId) return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "Only the payer or a trip organizer can modify this expense.",
  });
}

export const expensesRouter = {
  /**
   * Create a draft expense. Payer defaults to the calling user unless
   * an organizer explicitly overrides. SegmentId must belong to the trip.
   */
  create: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        segmentId: z.string().min(1),
        merchant: z.string().min(1).max(200),
        occurredAt: z.string().datetime(),
        category: expenseCategoryEnum.default("general"),
        currency: currencySchema.default("USD"),
        subtotalCents: z.number().int().nonnegative().default(0),
        taxCents: z.number().int().nonnegative().default(0),
        tipCents: z.number().int().nonnegative().default(0),
        totalCents: z.number().int().nonnegative().default(0),
        notes: z.string().max(2000).nullish(),
        payerUserId: z.string().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify segment belongs to this trip
      const segment = await ctx.db.query.tripSegments?.findFirst?.({
        where: and(
          eq(tripSegments.id, input.segmentId),
          eq(tripSegments.tripId, ctx.tripId),
        ),
      });
      if (!segment) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Segment does not belong to this trip.",
        });
      }

      // Organizer can designate any trip member as payer; others default to self
      let payerUserId = ctx.session.user.id;
      if (input.payerUserId && input.payerUserId !== ctx.session.user.id) {
        if (ctx.tripRole !== "organizer") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only organizers can set a different payer.",
          });
        }
        const payerMember = await ctx.db.query.tripMembers?.findFirst?.({
          where: and(
            eq(tripMembers.tripId, ctx.tripId),
            eq(tripMembers.userId, input.payerUserId),
          ),
        });
        if (!payerMember) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Payer must be a member of this trip.",
          });
        }
        payerUserId = input.payerUserId;
      }

      const [created] = (await ctx.db
        .insert(expenses)
        .values({
          tripId: ctx.tripId,
          segmentId: input.segmentId,
          payerUserId,
          merchant: input.merchant,
          category: input.category,
          occurredAt: new Date(input.occurredAt),
          currency: input.currency,
          subtotalCents: input.subtotalCents,
          taxCents: input.taxCents,
          tipCents: input.tipCents,
          totalCents: input.totalCents,
          notes: input.notes ?? null,
          status: "draft",
        })
        .returning()) as Array<typeof expenses.$inferSelect>;

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create expense.",
        });
      }

      return created;
    }),

  /**
   * List expenses for a trip, newest first. Scoped by tripProcedure.
   */
  list: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        segmentId: z.string().min(1).optional(),
        status: z.enum(["draft", "finalized"]).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(expenses.tripId, ctx.tripId)];
      if (input.segmentId) {
        conditions.push(eq(expenses.segmentId, input.segmentId));
      }
      if (input.status) {
        conditions.push(eq(expenses.status, input.status));
      }

      const rows = (await ctx.db
        .select()
        .from(expenses)
        .where(and(...conditions))
        .orderBy(desc(expenses.occurredAt), desc(expenses.createdAt))) as Array<
        typeof expenses.$inferSelect
      >;

      return rows;
    }),

  /**
   * Get a single expense with its line items, claims, and computed shares.
   */
  get: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        expenseId: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [expense] = (await ctx.db
        .select()
        .from(expenses)
        .where(
          and(
            eq(expenses.id, input.expenseId),
            eq(expenses.tripId, ctx.tripId),
          ),
        )
        .limit(1)) as Array<typeof expenses.$inferSelect>;

      if (!expense) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Expense not found.",
        });
      }

      const items = (await ctx.db
        .select()
        .from(lineItems)
        .where(eq(lineItems.expenseId, expense.id))
        .orderBy(asc(lineItems.sortOrder), asc(lineItems.createdAt))) as Array<
        typeof lineItems.$inferSelect
      >;

      const claims = (await ctx.db
        .select()
        .from(lineItemClaims)
        .where(
          // Claim rows for any of this expense's line items
          items.length > 0
            ? eq(lineItems.expenseId, expense.id)
            : eq(lineItemClaims.id, "__never__"),
        )) as Array<typeof lineItemClaims.$inferSelect>;

      // Build line-item-to-claimants map
      const claimantsByLineItem = new Map<string, string[]>();
      for (const claim of claims) {
        const existing = claimantsByLineItem.get(claim.lineItemId) ?? [];
        existing.push(claim.userId);
        claimantsByLineItem.set(claim.lineItemId, existing);
      }

      // Load trip members to use as the "unclaimed item split" pool
      const members = (await ctx.db
        .select({ userId: tripMembers.userId })
        .from(tripMembers)
        .where(eq(tripMembers.tripId, ctx.tripId))) as Array<{
        userId: string;
      }>;

      const shares = computeExpenseShares({
        payerUserId: expense.payerUserId,
        subtotalCents: expense.subtotalCents,
        taxCents: expense.taxCents,
        tipCents: expense.tipCents,
        participantUserIds: members.map((m) => m.userId),
        lineItems: items.map((item) => ({
          id: item.id,
          lineTotalCents: item.lineTotalCents,
          claimantUserIds: claimantsByLineItem.get(item.id) ?? [],
        })),
      });

      return {
        expense,
        lineItems: items.map((item) => ({
          ...item,
          claimantUserIds: claimantsByLineItem.get(item.id) ?? [],
        })),
        shares,
      };
    }),

  /**
   * Edit expense draft fields before finalization.
   */
  updateDraft: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        expenseId: z.string().min(1),
        merchant: z.string().min(1).max(200).optional(),
        occurredAt: z.string().datetime().optional(),
        category: expenseCategoryEnum.optional(),
        currency: currencySchema.optional(),
        subtotalCents: z.number().int().nonnegative().optional(),
        taxCents: z.number().int().nonnegative().optional(),
        tipCents: z.number().int().nonnegative().optional(),
        totalCents: z.number().int().nonnegative().optional(),
        notes: z.string().max(2000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = (await ctx.db
        .select()
        .from(expenses)
        .where(
          and(
            eq(expenses.id, input.expenseId),
            eq(expenses.tripId, ctx.tripId),
          ),
        )
        .limit(1)) as Array<typeof expenses.$inferSelect>;

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Expense not found.",
        });
      }

      if (existing.status !== "draft") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only draft expenses can be edited.",
        });
      }

      requireOrganizerOrSelf(
        ctx.tripRole,
        existing.payerUserId,
        ctx.session.user.id,
      );

      const patch: Record<string, unknown> = {};
      if (input.merchant !== undefined) patch.merchant = input.merchant;
      if (input.occurredAt !== undefined)
        patch.occurredAt = new Date(input.occurredAt);
      if (input.category !== undefined) patch.category = input.category;
      if (input.currency !== undefined) patch.currency = input.currency;
      if (input.subtotalCents !== undefined)
        patch.subtotalCents = input.subtotalCents;
      if (input.taxCents !== undefined) patch.taxCents = input.taxCents;
      if (input.tipCents !== undefined) patch.tipCents = input.tipCents;
      if (input.totalCents !== undefined) patch.totalCents = input.totalCents;
      if (input.notes !== undefined) patch.notes = input.notes;

      if (Object.keys(patch).length === 0) {
        return existing;
      }

      const [updated] = (await ctx.db
        .update(expenses)
        .set(patch)
        .where(eq(expenses.id, input.expenseId))
        .returning()) as Array<typeof expenses.$inferSelect>;

      return updated;
    }),

  /**
   * Finalize the expense — lock totals and open for claiming.
   * Refuses if currency doesn't match the trip's settlement currency.
   */
  finalize: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        expenseId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = (await ctx.db
        .select()
        .from(expenses)
        .where(
          and(
            eq(expenses.id, input.expenseId),
            eq(expenses.tripId, ctx.tripId),
          ),
        )
        .limit(1)) as Array<typeof expenses.$inferSelect>;

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Expense not found.",
        });
      }

      if (existing.status !== "draft") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Expense is already finalized.",
        });
      }

      requireOrganizerOrSelf(
        ctx.tripRole,
        existing.payerUserId,
        ctx.session.user.id,
      );

      // Enforce currency match: all finalized expenses in a trip must share one currency.
      const existingFinalized = (await ctx.db
        .select({ currency: expenses.currency })
        .from(expenses)
        .where(
          and(
            eq(expenses.tripId, ctx.tripId),
            eq(expenses.status, "finalized"),
          ),
        )
        .limit(1)) as Array<{ currency: string }>;

      if (
        existingFinalized.length > 0 &&
        existingFinalized[0]?.currency !== existing.currency
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `This trip already has finalized expenses in ${existingFinalized[0]?.currency}. Mixed-currency settlement is not supported.`,
        });
      }

      const [updated] = (await ctx.db
        .update(expenses)
        .set({ status: "finalized" })
        .where(eq(expenses.id, input.expenseId))
        .returning()) as Array<typeof expenses.$inferSelect>;

      return updated;
    }),

  /**
   * Add a line item to a draft expense.
   */
  addLineItem: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        expenseId: z.string().min(1),
        name: z.string().min(1).max(200),
        quantity: z.number().positive().default(1),
        unitPriceCents: z.number().int().nonnegative(),
        lineTotalCents: z.number().int().nonnegative(),
        sortOrder: z.number().int().nonnegative().default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [expense] = (await ctx.db
        .select()
        .from(expenses)
        .where(
          and(
            eq(expenses.id, input.expenseId),
            eq(expenses.tripId, ctx.tripId),
          ),
        )
        .limit(1)) as Array<typeof expenses.$inferSelect>;

      if (!expense) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Expense not found.",
        });
      }

      if (expense.status !== "draft") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Line items can only be added to draft expenses.",
        });
      }

      requireOrganizerOrSelf(
        ctx.tripRole,
        expense.payerUserId,
        ctx.session.user.id,
      );

      const [created] = (await ctx.db
        .insert(lineItems)
        .values({
          expenseId: input.expenseId,
          name: input.name,
          quantity: String(input.quantity),
          unitPriceCents: input.unitPriceCents,
          lineTotalCents: input.lineTotalCents,
          sortOrder: input.sortOrder,
        })
        .returning()) as Array<typeof lineItems.$inferSelect>;

      return created;
    }),

  /**
   * Remove a line item from a draft expense.
   */
  removeLineItem: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        expenseId: z.string().min(1),
        lineItemId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [expense] = (await ctx.db
        .select()
        .from(expenses)
        .where(
          and(
            eq(expenses.id, input.expenseId),
            eq(expenses.tripId, ctx.tripId),
          ),
        )
        .limit(1)) as Array<typeof expenses.$inferSelect>;

      if (!expense) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found." });
      }

      if (expense.status !== "draft") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Line items can only be removed from draft expenses.",
        });
      }

      requireOrganizerOrSelf(
        ctx.tripRole,
        expense.payerUserId,
        ctx.session.user.id,
      );

      await ctx.db
        .delete(lineItems)
        .where(
          and(
            eq(lineItems.id, input.lineItemId),
            eq(lineItems.expenseId, input.expenseId),
          ),
        );

      return { success: true };
    }),

  /**
   * Claim a line item on behalf of the current user (tap-to-claim).
   * Idempotent: claiming an already-claimed item is a no-op.
   */
  claimLineItem: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        expenseId: z.string().min(1),
        lineItemId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify line item belongs to the expense and the expense belongs to the trip
      const [item] = (await ctx.db
        .select({
          id: lineItems.id,
          expenseId: lineItems.expenseId,
          tripId: expenses.tripId,
          status: expenses.status,
        })
        .from(lineItems)
        .innerJoin(expenses, eq(expenses.id, lineItems.expenseId))
        .where(
          and(
            eq(lineItems.id, input.lineItemId),
            eq(lineItems.expenseId, input.expenseId),
            eq(expenses.tripId, ctx.tripId),
          ),
        )
        .limit(1)) as Array<{
        id: string;
        expenseId: string;
        tripId: string;
        status: "draft" | "finalized";
      }>;

      if (!item) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Line item not found on this expense.",
        });
      }

      if (item.status !== "finalized") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Line items can only be claimed on finalized expenses.",
        });
      }

      await ctx.db
        .insert(lineItemClaims)
        .values({
          lineItemId: input.lineItemId,
          userId: ctx.session.user.id,
        })
        .onConflictDoNothing({
          target: [lineItemClaims.lineItemId, lineItemClaims.userId],
        });

      return { claimed: true };
    }),

  /**
   * Unclaim a line item previously claimed by the current user.
   */
  unclaimLineItem: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        expenseId: z.string().min(1),
        lineItemId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(lineItemClaims)
        .where(
          and(
            eq(lineItemClaims.lineItemId, input.lineItemId),
            eq(lineItemClaims.userId, ctx.session.user.id),
          ),
        );
      return { unclaimed: true };
    }),

  /**
   * Organizer-assign mode: set the exact set of claimants for a line item.
   */
  assignLineItem: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        expenseId: z.string().min(1),
        lineItemId: z.string().min(1),
        userIds: z.array(z.string().min(1)).min(0).max(32),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.tripRole !== "organizer") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only organizers can reassign line items for others.",
        });
      }

      // Verify members belong to this trip
      const members = (await ctx.db
        .select({ userId: tripMembers.userId })
        .from(tripMembers)
        .where(eq(tripMembers.tripId, ctx.tripId))) as Array<{
        userId: string;
      }>;
      const memberIds = new Set(members.map((m) => m.userId));
      for (const userId of input.userIds) {
        if (!memberIds.has(userId)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `User ${userId} is not a member of this trip.`,
          });
        }
      }

      // Replace existing claims for this line item with the new set
      // biome-ignore lint/suspicious/noExplicitAny: Drizzle tx type is complex
      await ctx.db.transaction(async (tx: any) => {
        await tx
          .delete(lineItemClaims)
          .where(eq(lineItemClaims.lineItemId, input.lineItemId));

        if (input.userIds.length > 0) {
          await tx.insert(lineItemClaims).values(
            input.userIds.map((userId) => ({
              lineItemId: input.lineItemId,
              userId,
            })),
          );
        }
      });

      return { assigned: input.userIds.length };
    }),

  /**
   * Attach a receipt image record to an expense. The image bytes themselves
   * are uploaded via a separate storage endpoint; this just records the key.
   */
  attachReceiptImage: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        expenseId: z.string().min(1),
        storageKey: z.string().min(1),
        mimeType: z.string().min(1),
        sizeBytes: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = (await ctx.db
        .insert(receiptImages)
        .values({
          expenseId: input.expenseId,
          storageKey: input.storageKey,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          uploadedByUserId: ctx.session.user.id,
        })
        .returning()) as Array<typeof receiptImages.$inferSelect>;

      return created;
    }),
} satisfies TRPCRouterRecord;
