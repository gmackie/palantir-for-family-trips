import { describe, expect, it } from "vitest";

import { formatCents, formatMoney } from "../money";

describe("formatMoney", () => {
  it("formats cents as USD by default", () => {
    expect(formatMoney(3578)).toBe("$35.78");
    expect(formatMoney(0)).toBe("$0.00");
  });

  it("respects the currency argument", () => {
    expect(formatMoney(3578, "EUR")).toBe("€35.78");
    expect(formatMoney(1000, "gbp")).toBe("£10.00");
  });

  it("renders negative amounts", () => {
    expect(formatMoney(-500)).toBe("-$5.00");
  });
});

describe("formatCents", () => {
  it("formats cents as a bare two-decimal string", () => {
    expect(formatCents(3578)).toBe("35.78");
    expect(formatCents(0)).toBe("0.00");
    expect(formatCents(5)).toBe("0.05");
  });
});
