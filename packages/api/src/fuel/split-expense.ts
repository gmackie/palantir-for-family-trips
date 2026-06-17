import type { fuelLogs } from "@sortey/db/schema";

/**
 * The subset of a fuel-log row that the split builder needs. Kept structural
 * (rather than `typeof fuelLogs.$inferSelect`) so callers can pass either a
 * freshly-inserted row or a test fixture without dragging in every column.
 */
export type FuelLogForSplit = Pick<
  typeof fuelLogs.$inferSelect,
  "tripId" | "totalCents" | "stationName" | "loggedAt"
>;

/**
 * The insert-values object for the expenses table. The procedure performs the
 * actual `db.insert(expenses).values(...)`; this fn only assembles the values
 * so it stays DB/IO-free and unit-testable (mirrors the chat.ts store pattern).
 */
export type FuelExpenseValues = {
  tripId: string;
  segmentId: string;
  payerUserId: string;
  merchant: string;
  category: "fuel";
  totalCents: number;
  currency: string;
  occurredAt: Date;
};

/**
 * Build the insert values for the group-split expense that mirrors a fuel
 * fill-up. Pure function — no DB calls, no side effects.
 *
 * Splitting is *implicit*: this expense is created with NO line items, so
 * `computeExpenseShares` splits its `totalCents` equally across the trip's
 * members at read time (the whole total is the shared, unclaimed pool). That's
 * why we only carry `totalCents` through here and never build line items.
 */
export function buildFuelExpenseValues(args: {
  fuelLog: FuelLogForSplit;
  segmentId: string;
  payerUserId: string;
  currency: string;
}): FuelExpenseValues {
  const { fuelLog, segmentId, payerUserId, currency } = args;

  return {
    tripId: fuelLog.tripId,
    segmentId,
    payerUserId,
    merchant: fuelLog.stationName ?? "Fuel",
    category: "fuel",
    // Passes through unchanged — the equal split happens at read time, so no
    // line items and no pre-division of the total here.
    totalCents: fuelLog.totalCents,
    currency,
    occurredAt: fuelLog.loggedAt,
  };
}
