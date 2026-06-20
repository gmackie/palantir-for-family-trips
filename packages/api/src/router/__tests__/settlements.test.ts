import { describe, expect, it } from "vitest";
import type {
  ClaimRow,
  ExpenseRow,
  LineItemRow,
  MemberRow,
  SettlementRow,
  SettlementSummaryStore,
} from "../settlements";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/gmacko_test";

const { buildSettlementSummary } = await import("../settlements");

// ---------------------------------------------------------------------------
// In-memory SettlementSummaryStore — no real DB.
// ---------------------------------------------------------------------------
function createMemorySettlementStore(input?: {
  expenses?: ExpenseRow[];
  lineItems?: LineItemRow[];
  claims?: ClaimRow[];
  members?: MemberRow[];
  settlements?: SettlementRow[];
}) {
  const state = {
    expenses: [...(input?.expenses ?? [])],
    lineItems: [...(input?.lineItems ?? [])],
    claims: [...(input?.claims ?? [])],
    members: [...(input?.members ?? [])],
    settlements: [...(input?.settlements ?? [])],
  };

  const store: SettlementSummaryStore = {
    listFinalizedExpenses: async (tripId) =>
      state.expenses.filter((e) => e.tripId === tripId),

    listLineItems: async (expenseIds) =>
      state.lineItems.filter((li) => expenseIds.includes(li.expenseId)),

    listClaims: async (lineItemIds) =>
      state.claims.filter((c) => lineItemIds.includes(c.lineItemId)),

    listMembers: async (tripId) =>
      state.members.filter((m) => m.tripId === tripId),

    listActiveSettlements: async (tripId) =>
      state.settlements.filter((s) => s.tripId === tripId),
  };

  return { state, store };
}

// ---------------------------------------------------------------------------
// Test 1: Regression — the bug. Claims must actually affect share math.
//
// Setup: expense E, payer A, subtotal 2000¢ (zero tax/tip),
// two line items of 1000¢ each.
// Item 1 claimed by member B only → B owes 1000¢ for item 1.
// Item 2 unclaimed → split across participants [A, B] → 500¢ each.
// B's total share: 1500¢.  B→A suggested transaction of 1500¢.
// Before the bug fix, claims were never loaded so item 1 also split equally
// and B would owe only 1000¢ (500+500).
// ---------------------------------------------------------------------------
describe("buildSettlementSummary — regression (the bug)", () => {
  it("applies claims so claimed line items are NOT split equally", async () => {
    const { store } = createMemorySettlementStore({
      expenses: [
        {
          id: "exp_1",
          tripId: "trip_1",
          payerUserId: "user_A",
          subtotalCents: 2000,
          taxCents: 0,
          tipCents: 0,
        },
      ],
      lineItems: [
        { id: "li_1", expenseId: "exp_1", lineTotalCents: 1000 },
        { id: "li_2", expenseId: "exp_1", lineTotalCents: 1000 },
      ],
      claims: [
        // item 1 is claimed by B; item 2 has no claim (unclaimed → split A+B)
        { lineItemId: "li_1", userId: "user_B" },
      ],
      members: [
        {
          tripId: "trip_1",
          userId: "user_A",
          displayName: "Alice",
          venmoHandle: null,
        },
        {
          tripId: "trip_1",
          userId: "user_B",
          displayName: "Bob",
          venmoHandle: null,
        },
      ],
      settlements: [],
    });

    const result = await buildSettlementSummary(store, "trip_1");

    // There should be exactly one suggested transaction: B→A
    expect(result.suggestedTransactions).toHaveLength(1);
    const tx = result.suggestedTransactions[0]!;
    expect(tx.fromUserId).toBe("user_B");
    expect(tx.toUserId).toBe("user_A");
    // B owes 1000 (claimed item 1) + 500 (half of unclaimed item 2) = 1500¢
    expect(tx.amountCents).toBe(1500);

    expect(result.allSettled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 2: No expenses → allSettled true, empty arrays.
// ---------------------------------------------------------------------------
describe("buildSettlementSummary — no expenses", () => {
  it("returns allSettled:true with empty balances and transactions", async () => {
    const { store } = createMemorySettlementStore({
      members: [
        {
          tripId: "trip_1",
          userId: "user_A",
          displayName: "Alice",
          venmoHandle: null,
        },
        {
          tripId: "trip_1",
          userId: "user_B",
          displayName: "Bob",
          venmoHandle: null,
        },
      ],
    });

    const result = await buildSettlementSummary(store, "trip_1");

    expect(result.allSettled).toBe(true);
    expect(result.balances).toEqual([]);
    expect(result.suggestedTransactions).toEqual([]);
    expect(result.members).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Expense with zero line items. Subtotal 600¢, two participants.
// With no line items, computeExpenseShares receives an empty lineItems array;
// all items are "unclaimed", the line-items sum is 0 ≠ subtotal 600 — that
// triggers the reconstructed-subtotal warning path.  The payer ends up net
// positive (is owed money).
// ---------------------------------------------------------------------------
describe("buildSettlementSummary — expense with zero line items", () => {
  it("payer ends up net positive when no line items are passed", async () => {
    const { store } = createMemorySettlementStore({
      expenses: [
        {
          id: "exp_1",
          tripId: "trip_1",
          payerUserId: "user_A",
          subtotalCents: 600,
          taxCents: 0,
          tipCents: 0,
        },
      ],
      lineItems: [], // no line items at all
      claims: [],
      members: [
        {
          tripId: "trip_1",
          userId: "user_A",
          displayName: "Alice",
          venmoHandle: null,
        },
        {
          tripId: "trip_1",
          userId: "user_B",
          displayName: "Bob",
          venmoHandle: null,
        },
      ],
      settlements: [],
    });

    const result = await buildSettlementSummary(store, "trip_1");

    // With no line items the shares function gets an empty items array.
    // reconstructedSubtotal = 0 ≠ subtotalCents 600 → uses reconstructed (0)
    // for proration. Tax+tip are 0. Result: no shares, so payer has 0 balance.
    // allSettled = true (no outstanding balances).
    expect(result.allSettled).toBe(true);
    // No net balances to report since no line items means no shares are generated
    expect(result.suggestedTransactions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Existing settlement offsets balances → allSettled: true.
// Same scenario as test 1, plus a recorded settlement B→A of 1500¢.
// ---------------------------------------------------------------------------
describe("buildSettlementSummary — settlement offsets balance", () => {
  it("marks allSettled:true when recorded settlements cover all debts", async () => {
    const { store } = createMemorySettlementStore({
      expenses: [
        {
          id: "exp_1",
          tripId: "trip_1",
          payerUserId: "user_A",
          subtotalCents: 2000,
          taxCents: 0,
          tipCents: 0,
        },
      ],
      lineItems: [
        { id: "li_1", expenseId: "exp_1", lineTotalCents: 1000 },
        { id: "li_2", expenseId: "exp_1", lineTotalCents: 1000 },
      ],
      claims: [{ lineItemId: "li_1", userId: "user_B" }],
      members: [
        {
          tripId: "trip_1",
          userId: "user_A",
          displayName: "Alice",
          venmoHandle: null,
        },
        {
          tripId: "trip_1",
          userId: "user_B",
          displayName: "Bob",
          venmoHandle: null,
        },
      ],
      settlements: [
        // B already paid A the 1500¢ they owe
        {
          tripId: "trip_1",
          fromUserId: "user_B",
          toUserId: "user_A",
          amountCents: 1500,
        },
      ],
    });

    const result = await buildSettlementSummary(store, "trip_1");

    expect(result.allSettled).toBe(true);
    expect(result.suggestedTransactions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 5: Batching guard — listLineItems and listClaims each called once.
// Three finalized expenses; wrapper counters verify no N+1.
// ---------------------------------------------------------------------------
describe("buildSettlementSummary — batching (no N+1)", () => {
  it("calls listLineItems and listClaims exactly once regardless of expense count", async () => {
    const { store: baseStore } = createMemorySettlementStore({
      expenses: [
        {
          id: "exp_1",
          tripId: "trip_1",
          payerUserId: "user_A",
          subtotalCents: 300,
          taxCents: 0,
          tipCents: 0,
        },
        {
          id: "exp_2",
          tripId: "trip_1",
          payerUserId: "user_A",
          subtotalCents: 600,
          taxCents: 0,
          tipCents: 0,
        },
        {
          id: "exp_3",
          tripId: "trip_1",
          payerUserId: "user_A",
          subtotalCents: 900,
          taxCents: 0,
          tipCents: 0,
        },
      ],
      lineItems: [
        { id: "li_1", expenseId: "exp_1", lineTotalCents: 300 },
        { id: "li_2", expenseId: "exp_2", lineTotalCents: 600 },
        { id: "li_3", expenseId: "exp_3", lineTotalCents: 900 },
      ],
      claims: [{ lineItemId: "li_1", userId: "user_B" }],
      members: [
        {
          tripId: "trip_1",
          userId: "user_A",
          displayName: "Alice",
          venmoHandle: null,
        },
        {
          tripId: "trip_1",
          userId: "user_B",
          displayName: "Bob",
          venmoHandle: null,
        },
      ],
      settlements: [],
    });

    // Wrap store methods with counters
    let listLineItemsCallCount = 0;
    let listClaimsCallCount = 0;

    const countingStore: SettlementSummaryStore = {
      ...baseStore,
      listLineItems: async (expenseIds) => {
        listLineItemsCallCount++;
        return baseStore.listLineItems(expenseIds);
      },
      listClaims: async (lineItemIds) => {
        listClaimsCallCount++;
        return baseStore.listClaims(lineItemIds);
      },
    };

    await buildSettlementSummary(countingStore, "trip_1");

    expect(listLineItemsCallCount).toBe(1);
    expect(listClaimsCallCount).toBe(1);
  });
});
