import { eq } from "@sortey/db";
import { type ExpenseCategory, expenses } from "@sortey/db/schema";
import { TRPCError } from "@trpc/server";

/**
 * Shared draft-expense insert used by BOTH `expenses.create` and the ferry
 * fare→expense link. This is the single place that owns the money-bearing
 * `insert(expenses)` so neither caller hand-rolls the cents/currency mapping.
 *
 * The caller is responsible for its own framing concerns (segment validation,
 * payer-override authorization, push notifications) — this helper only writes
 * the draft row and returns it.
 */
export interface TransportDraftInput {
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle db type is complex
  db: any;
  tripId: string;
  segmentId: string;
  payerUserId: string;
  merchant: string;
  category: ExpenseCategory;
  occurredAt: Date;
  currency: string;
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  notes: string | null;
}

export async function insertExpenseDraft(
  input: TransportDraftInput,
): Promise<typeof expenses.$inferSelect> {
  const [created] = (await input.db
    .insert(expenses)
    .values({
      tripId: input.tripId,
      segmentId: input.segmentId,
      payerUserId: input.payerUserId,
      merchant: input.merchant,
      category: input.category,
      occurredAt: input.occurredAt,
      currency: input.currency,
      subtotalCents: input.subtotalCents,
      taxCents: input.taxCents,
      tipCents: input.tipCents,
      totalCents: input.totalCents,
      notes: input.notes,
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
}

/**
 * Update the fare-bearing amount + currency on a linked draft expense. Used by
 * the ferry router when the fare changes — keeps the single splittable amount
 * (subtotal == total, no tax/tip) consistent with how the ferry draft was
 * created.
 */
export async function updateTransportDraftAmount(input: {
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle db type is complex
  db: any;
  expenseId: string;
  amountCents: number;
  currency: string;
}): Promise<void> {
  await input.db
    .update(expenses)
    .set({
      subtotalCents: input.amountCents,
      totalCents: input.amountCents,
      currency: input.currency,
    })
    .where(eq(expenses.id, input.expenseId));
}
