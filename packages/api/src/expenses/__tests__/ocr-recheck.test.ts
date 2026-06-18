import { describe, expect, it } from "vitest";

import { recheckExpenseOcr } from "../ocr-recheck";

const baseAmounts = {
  merchant: "Corner Cafe",
  occurredAt: new Date("2026-04-15T13:42:00Z"),
  currency: "USD",
  subtotalCents: 2850,
  taxCents: 228,
  tipCents: 500,
  totalCents: 3578,
};

describe("recheckExpenseOcr", () => {
  it("returns high confidence + no warnings when the corrected math balances", () => {
    const result = recheckExpenseOcr(baseAmounts, []);
    expect(result.ocrStatus).toBe("success");
    expect(result.ocrWarnings).toEqual([]);
    expect(result.ocrConfidence).toBeGreaterThanOrEqual(0.9);
  });

  it("warns and drops confidence when subtotal+tax+tip != total", () => {
    const result = recheckExpenseOcr({ ...baseAmounts, totalCents: 9999 }, []);
    expect(result.ocrStatus).toBe("success");
    expect(result.ocrWarnings.length).toBeGreaterThan(0);
    expect(result.ocrConfidence).toBeLessThan(0.9);
  });

  it("flags a non-USD currency", () => {
    const result = recheckExpenseOcr({ ...baseAmounts, currency: "EUR" }, []);
    expect(result.ocrWarnings.some((w) => /currenc/i.test(w))).toBe(true);
  });

  it("coerces line-item quantities (numeric column comes back as string)", () => {
    const result = recheckExpenseOcr(baseAmounts, [
      {
        name: "Latte",
        quantity: "2",
        unitPriceCents: 600,
        lineTotalCents: 1200,
      },
    ]);
    expect(result.ocrStatus).toBe("success");
    expect(typeof result.ocrConfidence).toBe("number");
  });
});
