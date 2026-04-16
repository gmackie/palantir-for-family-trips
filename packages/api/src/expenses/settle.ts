/**
 * Settlement minimization — "who owes whom."
 *
 * Given a map of userId → net balance (positive = is owed, negative = owes),
 * produces the minimum set of transactions to settle all debts.
 *
 * Uses the greedy largest-creditor-vs-largest-debtor algorithm with a
 * deterministic tiebreaker (userId ASC) so two tabs render identical
 * suggestions.
 */

export interface SettlementTransaction {
  fromUserId: string;
  toUserId: string;
  amountCents: number;
}

export interface SettlementSummary {
  /** Per-user net balance (positive = owed money, negative = owes money). */
  balances: Map<string, number>;
  /** Minimum set of transactions to settle all balances. */
  suggestedTransactions: SettlementTransaction[];
}

/**
 * Compute the minimum transactions needed to settle balances.
 *
 * @param balances Map of userId → net cents (positive = creditor, negative = debtor)
 * @returns Suggested transactions sorted deterministically
 */
export function minimizeTransactions(
  balances: Map<string, number>,
): SettlementTransaction[] {
  // Clone into sorted arrays for deterministic output
  const creditors: Array<{ userId: string; amount: number }> = [];
  const debtors: Array<{ userId: string; amount: number }> = [];

  for (const [userId, amount] of balances) {
    if (amount > 0) {
      creditors.push({ userId, amount });
    } else if (amount < 0) {
      debtors.push({ userId, amount: -amount }); // store as positive
    }
  }

  // Deterministic sort: largest amount DESC, then userId ASC for ties
  const sortFn = (
    a: { userId: string; amount: number },
    b: { userId: string; amount: number },
  ) => {
    if (b.amount !== a.amount) return b.amount - a.amount;
    return a.userId.localeCompare(b.userId);
  };
  creditors.sort(sortFn);
  debtors.sort(sortFn);

  const transactions: SettlementTransaction[] = [];

  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const creditor = creditors[ci]!;
    const debtor = debtors[di]!;
    const transferAmount = Math.min(creditor.amount, debtor.amount);

    if (transferAmount > 0) {
      transactions.push({
        fromUserId: debtor.userId,
        toUserId: creditor.userId,
        amountCents: transferAmount,
      });
    }

    creditor.amount -= transferAmount;
    debtor.amount -= transferAmount;

    if (creditor.amount === 0) ci++;
    if (debtor.amount === 0) di++;
  }

  return transactions;
}

/**
 * Compute net balances from expense shares and recorded settlements.
 *
 * Each expense share means: the user owes that amount to the payer.
 * Each recorded settlement subtracts from the debtor's obligation.
 *
 * @returns Map of userId → net cents (positive = is owed, negative = owes)
 */
export function computeNetBalances(input: {
  expenseShares: Array<{
    payerUserId: string;
    shares: Array<{ userId: string; totalCents: number }>;
  }>;
  settlements: Array<{
    fromUserId: string;
    toUserId: string;
    amountCents: number;
  }>;
}): Map<string, number> {
  const balances = new Map<string, number>();

  const add = (userId: string, cents: number) => {
    balances.set(userId, (balances.get(userId) ?? 0) + cents);
  };

  for (const expense of input.expenseShares) {
    for (const share of expense.shares) {
      if (share.userId === expense.payerUserId) continue;
      // share.userId owes share.totalCents to the payer
      add(share.userId, -share.totalCents);
      add(expense.payerUserId, share.totalCents);
    }
  }

  for (const settlement of input.settlements) {
    // settlement.fromUserId paid settlement.toUserId
    add(settlement.fromUserId, settlement.amountCents);
    add(settlement.toUserId, -settlement.amountCents);
  }

  // Remove zero-balance entries
  for (const [userId, amount] of balances) {
    if (amount === 0) balances.delete(userId);
  }

  return balances;
}
