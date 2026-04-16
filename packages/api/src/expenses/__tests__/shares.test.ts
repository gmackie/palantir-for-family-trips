import { describe, expect, it } from "vitest";

import {
  ExpenseShareError,
  computeExpenseShares,
} from "../shares";

describe("computeExpenseShares", () => {
  it("single-payer, solo claimed item, no tax or tip", () => {
    const result = computeExpenseShares({
      payerUserId: "alice",
      subtotalCents: 1000,
      taxCents: 0,
      tipCents: 0,
      participantUserIds: ["alice", "bob"],
      lineItems: [{ id: "li1", lineTotalCents: 1000, claimantUserIds: ["alice"] }],
    });

    expect(result.shares).toEqual([
      { userId: "alice", subtotalCents: 1000, taxCents: 0, tipCents: 0, totalCents: 1000 },
    ]);
    expect(result.payerRoundingAbsorptionCents).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it("two people split a shared line item evenly (even cents)", () => {
    const result = computeExpenseShares({
      payerUserId: "alice",
      subtotalCents: 1200,
      taxCents: 0,
      tipCents: 0,
      participantUserIds: ["alice", "bob"],
      lineItems: [{ id: "li1", lineTotalCents: 1200, claimantUserIds: ["alice", "bob"] }],
    });

    const alice = result.shares.find((s) => s.userId === "alice");
    const bob = result.shares.find((s) => s.userId === "bob");
    expect(alice?.subtotalCents).toBe(600);
    expect(bob?.subtotalCents).toBe(600);
    expect(result.payerRoundingAbsorptionCents).toBe(0);
  });

  it("three-way split of an odd-cent line item gives remainder to the last sorted claimant", () => {
    const result = computeExpenseShares({
      payerUserId: "alice",
      subtotalCents: 100,
      taxCents: 0,
      tipCents: 0,
      participantUserIds: ["alice", "bob", "carol"],
      lineItems: [{ id: "li1", lineTotalCents: 100, claimantUserIds: ["alice", "bob", "carol"] }],
    });

    // 100 / 3 = 33 remainder 1 → last sorted (carol) gets 34
    expect(result.shares).toEqual([
      { userId: "alice", subtotalCents: 33, taxCents: 0, tipCents: 0, totalCents: 33 },
      { userId: "bob", subtotalCents: 33, taxCents: 0, tipCents: 0, totalCents: 33 },
      { userId: "carol", subtotalCents: 34, taxCents: 0, tipCents: 0, totalCents: 34 },
    ]);
  });

  it("prorates tax + tip across participants by subtotal share", () => {
    // alice has $8, bob has $2, $10 subtotal. Tax = $1 (10%), tip = $2 (20%).
    // alice: 80% × $1 = $0.80 tax, 80% × $2 = $1.60 tip. total = $10.40
    // bob:  20% × $1 = $0.20 tax, 20% × $2 = $0.40 tip. total = $2.60
    const result = computeExpenseShares({
      payerUserId: "alice",
      subtotalCents: 1000,
      taxCents: 100,
      tipCents: 200,
      participantUserIds: ["alice", "bob"],
      lineItems: [
        { id: "li1", lineTotalCents: 800, claimantUserIds: ["alice"] },
        { id: "li2", lineTotalCents: 200, claimantUserIds: ["bob"] },
      ],
    });

    const alice = result.shares.find((s) => s.userId === "alice")!;
    const bob = result.shares.find((s) => s.userId === "bob")!;
    expect(alice.subtotalCents).toBe(800);
    expect(alice.taxCents).toBe(80);
    expect(alice.tipCents).toBe(160);
    expect(alice.totalCents).toBe(1040);

    expect(bob.subtotalCents).toBe(200);
    expect(bob.taxCents).toBe(20);
    expect(bob.tipCents).toBe(40);
    expect(bob.totalCents).toBe(260);

    // Allocated total = 1040 + 260 = 1300 = subtotal 1000 + tax 100 + tip 200
    expect(result.payerRoundingAbsorptionCents).toBe(0);
  });

  it("tax + tip rounding residuals land on the last sorted user (not the payer) — but the sum always reconciles", () => {
    // alice: $3.33, bob: $3.33, carol: $3.34 (sum $10)
    // tax = $1.00 → each ideal share ≈ 33.3¢. Last sorted (carol) gets the remainder.
    const result = computeExpenseShares({
      payerUserId: "alice",
      subtotalCents: 1000,
      taxCents: 100,
      tipCents: 0,
      participantUserIds: ["alice", "bob", "carol"],
      lineItems: [
        { id: "li1", lineTotalCents: 1000, claimantUserIds: ["alice", "bob", "carol"] },
      ],
    });

    const totalTax = result.shares.reduce((a, b) => a + b.taxCents, 0);
    expect(totalTax).toBe(100);
    // Last sorted user absorbs the residual
    const carol = result.shares.find((s) => s.userId === "carol")!;
    expect(carol.taxCents).toBeGreaterThanOrEqual(33);
  });

  it("unclaimed line items split equally among participants and warn", () => {
    const result = computeExpenseShares({
      payerUserId: "alice",
      subtotalCents: 600,
      taxCents: 0,
      tipCents: 0,
      participantUserIds: ["alice", "bob", "carol"],
      lineItems: [{ id: "li1", lineTotalCents: 600, claimantUserIds: [] }],
    });

    expect(result.shares).toEqual([
      { userId: "alice", subtotalCents: 200, taxCents: 0, tipCents: 0, totalCents: 200 },
      { userId: "bob", subtotalCents: 200, taxCents: 0, tipCents: 0, totalCents: 200 },
      { userId: "carol", subtotalCents: 200, taxCents: 0, tipCents: 0, totalCents: 200 },
    ]);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
  });

  it("unclaimed line items with no participants fall back to the payer", () => {
    const result = computeExpenseShares({
      payerUserId: "alice",
      subtotalCents: 500,
      taxCents: 0,
      tipCents: 0,
      participantUserIds: [],
      lineItems: [{ id: "li1", lineTotalCents: 500, claimantUserIds: [] }],
    });

    expect(result.shares).toEqual([
      { userId: "alice", subtotalCents: 500, taxCents: 0, tipCents: 0, totalCents: 500 },
    ]);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
  });

  it("zero tax and zero tip produces zero tax/tip shares", () => {
    const result = computeExpenseShares({
      payerUserId: "alice",
      subtotalCents: 1000,
      taxCents: 0,
      tipCents: 0,
      participantUserIds: ["alice", "bob"],
      lineItems: [
        { id: "li1", lineTotalCents: 500, claimantUserIds: ["alice"] },
        { id: "li2", lineTotalCents: 500, claimantUserIds: ["bob"] },
      ],
    });

    for (const share of result.shares) {
      expect(share.taxCents).toBe(0);
      expect(share.tipCents).toBe(0);
    }
  });

  it("output is deterministic — sorted by userId", () => {
    const result = computeExpenseShares({
      payerUserId: "zoe",
      subtotalCents: 300,
      taxCents: 0,
      tipCents: 0,
      participantUserIds: ["zoe", "alice", "marvin"],
      lineItems: [
        { id: "li1", lineTotalCents: 300, claimantUserIds: ["zoe", "alice", "marvin"] },
      ],
    });

    const userIds = result.shares.map((s) => s.userId);
    expect(userIds).toEqual(["alice", "marvin", "zoe"]);
  });

  it("line-item sum mismatch with subtotal is used as-is and warned", () => {
    const result = computeExpenseShares({
      payerUserId: "alice",
      subtotalCents: 1000, // lies — line items sum to 900
      taxCents: 100,
      tipCents: 0,
      participantUserIds: ["alice", "bob"],
      lineItems: [
        { id: "li1", lineTotalCents: 500, claimantUserIds: ["alice"] },
        { id: "li2", lineTotalCents: 400, claimantUserIds: ["bob"] },
      ],
    });

    expect(result.warnings.some((w) => w.includes("sum to"))).toBe(true);
    // Still produces valid shares using reconstructed subtotal 900
    const total = result.shares.reduce((a, b) => a + b.subtotalCents, 0);
    expect(total).toBe(900);
  });

  it("rejects negative amounts", () => {
    expect(() =>
      computeExpenseShares({
        payerUserId: "alice",
        subtotalCents: -100,
        taxCents: 0,
        tipCents: 0,
        participantUserIds: ["alice"],
        lineItems: [],
      }),
    ).toThrow(ExpenseShareError);
  });
});
