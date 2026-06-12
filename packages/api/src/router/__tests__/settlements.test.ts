import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SettlementStore } from "../settlements";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/gmacko_test";

const { buildSettlementSummary } = await import("../settlements");

// ─── In-memory store factory ─────────────────────────────────────────────────

type FinalizedExpenseRow = {
  id: string;
  payerUserId: string;
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
};

type LineItemRow = {
  id: string;
  expenseId: string;
  lineTotalCents: number;
};

type ClaimRow = {
  lineItemId: string;
  userId: string;
};

type TripMemberRow = {
  userId: string;
  displayName: string | null;
  venmoHandle: string | null;
};

type ActiveSettlementRow = {
  fromUserId: string;
  toUserId: string;
  amountCents: number;
};

function createSettlementStoreMock(seed: {
  finalizedExpenses?: FinalizedExpenseRow[];
  lineItems?: LineItemRow[];
  claims?: ClaimRow[];
  members?: TripMemberRow[];
  activeSettlements?: ActiveSettlementRow[];
}): SettlementStore & {
  calls: {
    listFinalizedExpenses: string[][];
    listLineItems: string[][];
    listClaims: string[][];
    listTripMembers: string[][];
    listActiveSettlements: string[][];
  };
} {
  const finalizedExpenses = seed.finalizedExpenses ?? [];
  const lineItems = seed.lineItems ?? [];
  const claims = seed.claims ?? [];
  const members = seed.members ?? [];
  const activeSettlements = seed.activeSettlements ?? [];

  const calls = {
    listFinalizedExpenses: [] as string[][],
    listLineItems: [] as string[][],
    listClaims: [] as string[][],
    listTripMembers: [] as string[][],
    listActiveSettlements: [] as string[][],
  };

  return {
    calls,

    async listFinalizedExpenses(tripId) {
      calls.listFinalizedExpenses.push([tripId]);
      return finalizedExpenses;
    },

    async listLineItems(expenseIds) {
      calls.listLineItems.push([...expenseIds]);
      return lineItems.filter((item) => expenseIds.includes(item.expenseId));
    },

    async listClaims(lineItemIds) {
      calls.listClaims.push([...lineItemIds]);
      return claims.filter((c) => lineItemIds.includes(c.lineItemId));
    },

    async listTripMembers(tripId) {
      calls.listTripMembers.push([tripId]);
      return members;
    },

    async listActiveSettlements(tripId) {
      calls.listActiveSettlements.push([tripId]);
      return activeSettlements;
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("buildSettlementSummary", () => {
  const tripId = randomUUID();

  const alice = "user_alice";
  const bob = "user_bob";
  const charlie = "user_charlie";

  it("regression: itemized expense produces correct shares when claims exist (the shipped bug)", async () => {
    const expenseId = randomUUID();
    const item1Id = randomUUID();
    const item2Id = randomUUID();

    const store = createSettlementStoreMock({
      finalizedExpenses: [
        {
          id: expenseId,
          payerUserId: alice,
          subtotalCents: 2000, // $20 total (two $10 line items)
          taxCents: 0,
          tipCents: 0,
        },
      ],
      lineItems: [
        { id: item1Id, expenseId, lineTotalCents: 1000 },
        { id: item2Id, expenseId, lineTotalCents: 1000 },
      ],
      claims: [
        { lineItemId: item1Id, userId: bob }, // bob claims item1
        { lineItemId: item2Id, userId: charlie }, // charlie claims item2
      ],
      members: [
        { userId: alice, displayName: "Alice", venmoHandle: null },
        { userId: bob, displayName: "Bob", venmoHandle: null },
        { userId: charlie, displayName: "Charlie", venmoHandle: null },
      ],
      activeSettlements: [],
    });

    const result = await buildSettlementSummary(store, { tripId });

    // listClaims must have been called with the actual line-item ids, not empty
    expect(store.calls.listClaims).toHaveLength(1);
    expect(store.calls.listClaims[0]).toEqual(
      expect.arrayContaining([item1Id, item2Id]),
    );

    // Bob owes Alice $10 for item1; Charlie owes Alice $10 for item2
    const balances = Object.fromEntries(
      result.balances.map((b) => [b.userId, b.amountCents]),
    );
    expect(balances[alice]).toBe(2000); // owed $20 total
    expect(balances[bob]).toBe(-1000); // owes $10
    expect(balances[charlie]).toBe(-1000); // owes $10

    // Exactly 2 transactions to settle
    expect(result.suggestedTransactions).toHaveLength(2);
    expect(result.allSettled).toBe(false);
  });

  it("expense with line items but zero claims splits across all members", async () => {
    const expenseId = randomUUID();
    const item1Id = randomUUID();
    const item2Id = randomUUID();

    const store = createSettlementStoreMock({
      finalizedExpenses: [
        {
          id: expenseId,
          payerUserId: alice,
          subtotalCents: 3000, // $30 total
          taxCents: 0,
          tipCents: 0,
        },
      ],
      lineItems: [
        { id: item1Id, expenseId, lineTotalCents: 1500 },
        { id: item2Id, expenseId, lineTotalCents: 1500 },
      ],
      claims: [], // no claims on either item
      members: [
        { userId: alice, displayName: "Alice", venmoHandle: null },
        { userId: bob, displayName: "Bob", venmoHandle: null },
        { userId: charlie, displayName: "Charlie", venmoHandle: null },
      ],
      activeSettlements: [],
    });

    const result = await buildSettlementSummary(store, { tripId });

    // With no claims, each item splits equally among 3 members: $10 each
    // Alice paid, so Alice is owed $20 (bob + charlie shares), bob and charlie each owe $10
    const balances = Object.fromEntries(
      result.balances.map((b) => [b.userId, b.amountCents]),
    );
    expect(balances[alice]).toBeGreaterThan(0);
    expect(balances[bob]).toBeLessThan(0);
    expect(balances[charlie]).toBeLessThan(0);
    // Total owed by bob and charlie equals what alice is owed
    expect(balances[alice]).toBe(-(balances[bob]! + balances[charlie]!));
  });

  it("expense with no line items at all: listClaims called with empty array, summary still computes", async () => {
    const expenseId = randomUUID();

    const store = createSettlementStoreMock({
      finalizedExpenses: [
        {
          id: expenseId,
          payerUserId: alice,
          subtotalCents: 0,
          taxCents: 0,
          tipCents: 0,
        },
      ],
      lineItems: [], // no line items
      claims: [],
      members: [
        { userId: alice, displayName: "Alice", venmoHandle: null },
        { userId: bob, displayName: "Bob", venmoHandle: null },
      ],
      activeSettlements: [],
    });

    const result = await buildSettlementSummary(store, { tripId });

    // listClaims was called once with an empty array (not skipped entirely)
    expect(store.calls.listClaims).toHaveLength(1);
    expect(store.calls.listClaims[0]).toEqual([]);

    // Zero-value expense produces no balances
    expect(result.balances).toHaveLength(0);
    expect(result.allSettled).toBe(true);
  });

  it("multiple finalized expenses: store methods called once each (batched, not N+1)", async () => {
    const expense1Id = randomUUID();
    const expense2Id = randomUUID();
    const item1Id = randomUUID();
    const item2Id = randomUUID();

    const store = createSettlementStoreMock({
      finalizedExpenses: [
        {
          id: expense1Id,
          payerUserId: alice,
          subtotalCents: 1000,
          taxCents: 0,
          tipCents: 0,
        },
        {
          id: expense2Id,
          payerUserId: bob,
          subtotalCents: 2000,
          taxCents: 0,
          tipCents: 0,
        },
      ],
      lineItems: [
        { id: item1Id, expenseId: expense1Id, lineTotalCents: 1000 },
        { id: item2Id, expenseId: expense2Id, lineTotalCents: 2000 },
      ],
      claims: [
        { lineItemId: item1Id, userId: bob },
        { lineItemId: item2Id, userId: alice },
      ],
      members: [
        { userId: alice, displayName: "Alice", venmoHandle: null },
        { userId: bob, displayName: "Bob", venmoHandle: null },
      ],
      activeSettlements: [],
    });

    await buildSettlementSummary(store, { tripId });

    // Each store method called exactly once (batched), regardless of how many expenses
    expect(store.calls.listFinalizedExpenses).toHaveLength(1);
    expect(store.calls.listLineItems).toHaveLength(1);
    expect(store.calls.listClaims).toHaveLength(1);
    expect(store.calls.listTripMembers).toHaveLength(1);
    expect(store.calls.listActiveSettlements).toHaveLength(1);

    // listLineItems received both expense ids in one call
    expect(store.calls.listLineItems[0]).toHaveLength(2);
    expect(store.calls.listLineItems[0]).toEqual(
      expect.arrayContaining([expense1Id, expense2Id]),
    );

    // listClaims received both item ids in one call
    expect(store.calls.listClaims[0]).toHaveLength(2);
    expect(store.calls.listClaims[0]).toEqual(
      expect.arrayContaining([item1Id, item2Id]),
    );
  });

  it("existing non-undone settlement reduces balances; fully settled trip returns allSettled: true", async () => {
    const expenseId = randomUUID();
    const itemId = randomUUID();

    const store = createSettlementStoreMock({
      finalizedExpenses: [
        {
          id: expenseId,
          payerUserId: alice,
          subtotalCents: 1000,
          taxCents: 0,
          tipCents: 0,
        },
      ],
      lineItems: [{ id: itemId, expenseId, lineTotalCents: 1000 }],
      claims: [
        { lineItemId: itemId, userId: bob }, // bob owes alice $10
      ],
      members: [
        { userId: alice, displayName: "Alice", venmoHandle: null },
        { userId: bob, displayName: "Bob", venmoHandle: null },
      ],
      activeSettlements: [
        // Bob already paid Alice back in full
        { fromUserId: bob, toUserId: alice, amountCents: 1000 },
      ],
    });

    const result = await buildSettlementSummary(store, { tripId });

    // After the settlement, balances zero out
    expect(result.balances).toHaveLength(0);
    expect(result.suggestedTransactions).toHaveLength(0);
    expect(result.allSettled).toBe(true);
  });
});
