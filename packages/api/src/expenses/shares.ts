/**
 * Share calculation for a single expense.
 *
 * Inputs are already-resolved expense facts — no DB access here.
 * The function is pure so it's trivial to unit test and reason about.
 *
 * Rules:
 * - Each line item with N claimants: integer cents / N, with any
 *   remainder going to the last claimant (deterministic via sort).
 * - Tax and tip are prorated across users proportional to their share
 *   of the pre-tax subtotal. Rounding residuals go to the payer and
 *   are reported back in the result so the UI can surface "You absorb
 *   $0.03 rounding".
 * - Unclaimed line items are split equally among all eligible participants
 *   (passed as `participantUserIds`). If no participants, they go to the payer.
 * - The payer's net is total owed (by others) minus their own share,
 *   but we return per-user owed amounts only — the settlement layer
 *   handles directionality.
 */

export interface ExpenseLineItemInput {
  id: string;
  lineTotalCents: number;
  /** User IDs of people who have claimed this line item. Empty = unclaimed. */
  claimantUserIds: readonly string[];
}

export interface ExpenseSharesInput {
  payerUserId: string;
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  /** Total participants considered for unclaimed-item splitting. */
  participantUserIds: readonly string[];
  lineItems: readonly ExpenseLineItemInput[];
}

export interface UserShare {
  userId: string;
  /** Sum of line-item shares. */
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  /** subtotalCents + taxCents + tipCents */
  totalCents: number;
}

export interface ExpenseSharesResult {
  shares: UserShare[];
  /** Positive when the payer absorbs rounding residuals. */
  payerRoundingAbsorptionCents: number;
  /** Validation warnings that the caller should surface. */
  warnings: string[];
}

export class ExpenseShareError extends Error {}

export function computeExpenseShares(
  input: ExpenseSharesInput,
): ExpenseSharesResult {
  if (input.subtotalCents < 0 || input.taxCents < 0 || input.tipCents < 0) {
    throw new ExpenseShareError(
      "Expense amounts must be non-negative integers in cents.",
    );
  }

  const warnings: string[] = [];

  // Step 1: allocate each line item's cents among its claimants.
  const subtotalByUser = new Map<string, number>();
  const addSubtotal = (userId: string, cents: number) => {
    subtotalByUser.set(userId, (subtotalByUser.get(userId) ?? 0) + cents);
  };

  for (const item of input.lineItems) {
    const claimants =
      item.claimantUserIds.length > 0
        ? [...item.claimantUserIds].sort()
        : input.participantUserIds.length > 0
          ? [...input.participantUserIds].sort()
          : [input.payerUserId];

    if (
      item.claimantUserIds.length === 0 &&
      input.participantUserIds.length === 0
    ) {
      warnings.push(
        `Line item ${item.id} is unclaimed and no participants were provided. Assigned to payer.`,
      );
    } else if (item.claimantUserIds.length === 0) {
      warnings.push(
        `Line item ${item.id} has no claimants — split equally among trip participants.`,
      );
    }

    const share = Math.floor(item.lineTotalCents / claimants.length);
    const remainder = item.lineTotalCents - share * claimants.length;

    for (let i = 0; i < claimants.length; i++) {
      const userId = claimants[i]!;
      const takesRemainder = i === claimants.length - 1;
      addSubtotal(userId, share + (takesRemainder ? remainder : 0));
    }
  }

  // Sanity check: line item sums should equal input subtotal (within tolerance)
  const reconstructedSubtotal = Array.from(subtotalByUser.values()).reduce(
    (a, b) => a + b,
    0,
  );

  let effectiveSubtotal = input.subtotalCents;
  if (reconstructedSubtotal !== input.subtotalCents) {
    // If the caller didn't pass line items that sum to the stored subtotal,
    // use the reconstructed subtotal for tax/tip proration so the math
    // stays consistent. Warn so the UI can surface the discrepancy.
    warnings.push(
      `Line items sum to ${reconstructedSubtotal}¢ but expense subtotal is ${input.subtotalCents}¢. Using line-item sum for proration.`,
    );
    effectiveSubtotal = reconstructedSubtotal;
  }

  // Step 2: prorate tax + tip against each user's subtotal share.
  const taxShareByUser = new Map<string, number>();
  const tipShareByUser = new Map<string, number>();

  const extrasCents = input.taxCents + input.tipCents;
  if (effectiveSubtotal > 0 && extrasCents > 0) {
    // Sorted userIds for deterministic rounding residual assignment.
    const sortedUserIds = Array.from(subtotalByUser.keys()).sort();

    let allocatedTax = 0;
    let allocatedTip = 0;
    for (let i = 0; i < sortedUserIds.length; i++) {
      const userId = sortedUserIds[i]!;
      const userSubtotal = subtotalByUser.get(userId) ?? 0;
      const isLast = i === sortedUserIds.length - 1;

      const taxShare = isLast
        ? input.taxCents - allocatedTax
        : Math.round((userSubtotal * input.taxCents) / effectiveSubtotal);
      const tipShare = isLast
        ? input.tipCents - allocatedTip
        : Math.round((userSubtotal * input.tipCents) / effectiveSubtotal);

      taxShareByUser.set(userId, taxShare);
      tipShareByUser.set(userId, tipShare);
      allocatedTax += taxShare;
      allocatedTip += tipShare;
    }
  } else {
    for (const userId of subtotalByUser.keys()) {
      taxShareByUser.set(userId, 0);
      tipShareByUser.set(userId, 0);
    }
  }

  // Step 3: assemble UserShare array sorted by userId for deterministic output.
  const shares: UserShare[] = Array.from(subtotalByUser.keys())
    .sort()
    .map((userId) => {
      const subtotal = subtotalByUser.get(userId) ?? 0;
      const tax = taxShareByUser.get(userId) ?? 0;
      const tip = tipShareByUser.get(userId) ?? 0;
      return {
        userId,
        subtotalCents: subtotal,
        taxCents: tax,
        tipCents: tip,
        totalCents: subtotal + tax + tip,
      };
    });

  // Step 4: compute rounding absorption on the payer.
  const allocatedTotal = shares.reduce((sum, s) => sum + s.totalCents, 0);
  const expectedTotal = input.subtotalCents + input.taxCents + input.tipCents;
  const payerRoundingAbsorptionCents = expectedTotal - allocatedTotal;

  return {
    shares,
    payerRoundingAbsorptionCents,
    warnings,
  };
}
