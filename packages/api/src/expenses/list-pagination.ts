// Pure helpers for `expenses.list` keyset pagination. Kept dependency-free so
// it is unit-testable and importable by clients that need the cursor shape.

/** Hard cap on a single `expenses.list` page. */
export const MAX_EXPENSE_LIST_LIMIT = 100;

/**
 * Clamp a caller-supplied page size into `[1, MAX_EXPENSE_LIST_LIMIT]`.
 * Non-finite input falls back to the maximum.
 */
export function clampExpenseListLimit(limit: number): number {
  if (!Number.isFinite(limit)) return MAX_EXPENSE_LIST_LIMIT;
  return Math.min(Math.max(1, Math.floor(limit)), MAX_EXPENSE_LIST_LIMIT);
}

/**
 * Keyset cursor for `expenses.list`. Anchored on the list's sort key
 * (`occurredAt` desc, then `id` desc as a unique tiebreaker). Clients derive
 * the next cursor from the last row of the previous page.
 */
export interface ExpenseListCursor {
  /** ISO 8601 timestamp of the last row's `occurredAt`. */
  occurredAt: string;
  /** The last row's id (unique tiebreaker for equal `occurredAt`). */
  id: string;
}
