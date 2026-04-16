import { describe, expect, it } from "vitest";

import { reconcileReceipt } from "../reconcile";
import type { ReceiptExtraction } from "../schema";

function baseExtraction(
  overrides: Partial<ReceiptExtraction> = {},
): ReceiptExtraction {
  return {
    merchant: "Test Cafe",
    occurredAt: "2026-04-15T13:00:00Z",
    currency: "USD",
    subtotalCents: 1000,
    taxCents: 80,
    tipCents: 200,
    totalCents: 1280,
    lineItems: [
      {
        name: "Burger",
        quantity: 1,
        unitPriceCents: 1000,
        lineTotalCents: 1000,
      },
    ],
    ...overrides,
  };
}

describe("reconcileReceipt", () => {
  it("accepts a perfect-reconciliation USD receipt", () => {
    const result = reconcileReceipt(baseExtraction());
    expect(result.arithmeticOk).toBe(true);
    expect(result.arithmeticDeltaCents).toBe(0);
    expect(result.currencyIsUsd).toBe(true);
    expect(result.confidence).toBe(1.0);
    expect(result.warnings).toEqual([]);
  });

  it("tolerates 1-cent arithmetic drift (rounding)", () => {
    const result = reconcileReceipt(
      baseExtraction({
        subtotalCents: 1000,
        taxCents: 80,
        tipCents: 200,
        totalCents: 1281, // off by 1¢
      }),
    );
    expect(result.arithmeticOk).toBe(true);
    expect(result.arithmeticDeltaCents).toBe(1);
    expect(result.confidence).toBe(1.0);
  });

  it("flags arithmetic mismatch beyond tolerance", () => {
    const result = reconcileReceipt(
      baseExtraction({
        subtotalCents: 1000,
        taxCents: 80,
        tipCents: 200,
        totalCents: 1500, // off by 220¢
      }),
    );
    expect(result.arithmeticOk).toBe(false);
    expect(result.arithmeticDeltaCents).toBe(220);
    expect(result.confidence).toBeLessThan(1.0);
    expect(result.warnings.some((w) => w.includes("reconcile"))).toBe(true);
  });

  it("warns when currency is not USD but still reconciles", () => {
    const result = reconcileReceipt(
      baseExtraction({
        currency: "JPY",
      }),
    );
    expect(result.currencyIsUsd).toBe(false);
    expect(result.arithmeticOk).toBe(true);
    expect(result.confidence).toBeLessThan(1.0);
    expect(result.warnings.some((w) => w.includes("JPY"))).toBe(true);
  });

  it("strips **** 1234 card patterns from merchant", () => {
    const result = reconcileReceipt(
      baseExtraction({
        merchant: "Target **** 1234",
      }),
    );
    expect(result.sanitized.merchant).not.toContain("1234");
    expect(result.sanitized.merchant).toContain("[REDACTED]");
    expect(result.warnings.some((w) => w.toLowerCase().includes("card"))).toBe(
      true,
    );
  });

  it("strips XXXX1234 card patterns", () => {
    const result = reconcileReceipt(
      baseExtraction({
        merchant: "Amazon XXXX1234",
      }),
    );
    expect(result.sanitized.merchant).not.toContain("1234");
  });

  it("strips 'Card ending 1234' phrasing", () => {
    const result = reconcileReceipt(
      baseExtraction({
        merchant: "Corner Store Card ending 9876",
      }),
    );
    expect(result.sanitized.merchant).not.toContain("9876");
  });

  it("strips card digits from line item names too", () => {
    const result = reconcileReceipt(
      baseExtraction({
        lineItems: [
          {
            name: "Receipt ref **** 1234",
            quantity: 1,
            unitPriceCents: 1000,
            lineTotalCents: 1000,
          },
        ],
      }),
    );
    expect(result.sanitized.lineItems[0]?.name).not.toContain("1234");
  });

  it("leaves item quantities and prices that look like digits alone", () => {
    const result = reconcileReceipt(
      baseExtraction({
        merchant: "Store 1234",
        lineItems: [
          {
            name: "Item 123",
            quantity: 2,
            unitPriceCents: 500,
            lineTotalCents: 1000,
          },
        ],
      }),
    );
    // "Store 1234" and "Item 123" don't match any card pattern — left alone
    expect(result.sanitized.merchant).toBe("Store 1234");
    expect(result.sanitized.lineItems[0]?.name).toBe("Item 123");
  });

  it("lowers confidence proportionally to arithmetic mismatch", () => {
    const small = reconcileReceipt(
      baseExtraction({
        subtotalCents: 1000,
        taxCents: 80,
        tipCents: 200,
        totalCents: 1300, // 20¢ off
      }),
    );
    const large = reconcileReceipt(
      baseExtraction({
        subtotalCents: 1000,
        taxCents: 80,
        tipCents: 200,
        totalCents: 5000, // 3720¢ off
      }),
    );
    expect(large.confidence).toBeLessThan(small.confidence);
  });

  it("stacks confidence penalties for multiple issues", () => {
    const result = reconcileReceipt(
      baseExtraction({
        currency: "EUR",
        merchant: "Cafe **** 1234",
        totalCents: 2000, // mismatch
      }),
    );
    expect(result.confidence).toBeLessThan(0.5);
    expect(result.warnings.length).toBeGreaterThanOrEqual(3);
  });
});
