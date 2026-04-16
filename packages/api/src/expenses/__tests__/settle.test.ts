import { describe, expect, it } from "vitest";

import { computeNetBalances, minimizeTransactions } from "../settle";

describe("minimizeTransactions", () => {
  it("returns empty for zero balances", () => {
    const result = minimizeTransactions(new Map());
    expect(result).toEqual([]);
  });

  it("settles a simple 2-person debt", () => {
    const balances = new Map([
      ["alice", 500], // alice is owed $5
      ["bob", -500], // bob owes $5
    ]);
    const txns = minimizeTransactions(balances);
    expect(txns).toEqual([
      { fromUserId: "bob", toUserId: "alice", amountCents: 500 },
    ]);
  });

  it("settles 3 people with one creditor and two debtors", () => {
    const balances = new Map([
      ["alice", 1000], // alice is owed $10
      ["bob", -600], // bob owes $6
      ["carol", -400], // carol owes $4
    ]);
    const txns = minimizeTransactions(balances);
    expect(txns).toHaveLength(2);
    const totalToAlice = txns
      .filter((t) => t.toUserId === "alice")
      .reduce((s, t) => s + t.amountCents, 0);
    expect(totalToAlice).toBe(1000);
  });

  it("produces at most N-1 transactions for N people", () => {
    const balances = new Map([
      ["alice", 3000],
      ["bob", -1000],
      ["carol", -800],
      ["dave", -1200],
    ]);
    const txns = minimizeTransactions(balances);
    expect(txns.length).toBeLessThanOrEqual(3); // N-1 = 3
    const net = txns.reduce((s, t) => s + t.amountCents, 0);
    // All transactions are from debtors to creditors; net flow = sum of payments
    // Each debtor's total payments should match their debt
  });

  it("is deterministic: tied balances sort by userId ASC", () => {
    const balances = new Map([
      ["zoe", 500],
      ["alice", -250],
      ["bob", -250],
    ]);
    const txns1 = minimizeTransactions(balances);
    const txns2 = minimizeTransactions(balances);
    expect(txns1).toEqual(txns2);
    // alice should appear before bob in the output (userId ASC tiebreaker)
    expect(txns1[0]?.fromUserId).toBe("alice");
  });

  it("handles pre-existing settlements via computeNetBalances", () => {
    const balances = computeNetBalances({
      expenseShares: [
        {
          payerUserId: "alice",
          shares: [
            { userId: "alice", totalCents: 500 },
            { userId: "bob", totalCents: 500 },
          ],
        },
      ],
      settlements: [
        { fromUserId: "bob", toUserId: "alice", amountCents: 300 },
      ],
    });
    // bob owed 500, paid 300, still owes 200
    expect(balances.get("bob")).toBe(-200);
    expect(balances.get("alice")).toBe(200);

    const txns = minimizeTransactions(balances);
    expect(txns).toEqual([
      { fromUserId: "bob", toUserId: "alice", amountCents: 200 },
    ]);
  });

  it("handles fully settled trip (all balances zero)", () => {
    const balances = computeNetBalances({
      expenseShares: [
        {
          payerUserId: "alice",
          shares: [
            { userId: "alice", totalCents: 500 },
            { userId: "bob", totalCents: 500 },
          ],
        },
      ],
      settlements: [
        { fromUserId: "bob", toUserId: "alice", amountCents: 500 },
      ],
    });
    expect(balances.size).toBe(0);
    expect(minimizeTransactions(balances)).toEqual([]);
  });

  it("computeNetBalances excludes payer's self-share from debts", () => {
    const balances = computeNetBalances({
      expenseShares: [
        {
          payerUserId: "alice",
          shares: [
            { userId: "alice", totalCents: 700 },
            { userId: "bob", totalCents: 300 },
          ],
        },
      ],
      settlements: [],
    });
    // alice is owed 300 (bob's share), not 1000
    expect(balances.get("alice")).toBe(300);
    expect(balances.get("bob")).toBe(-300);
  });
});
