import { describe, expect, it } from "vitest";

import {
  clampExpenseListLimit,
  MAX_EXPENSE_LIST_LIMIT,
} from "../list-pagination";

describe("clampExpenseListLimit", () => {
  it("passes through a value within range", () => {
    expect(clampExpenseListLimit(25)).toBe(25);
  });

  it("caps at the maximum", () => {
    expect(clampExpenseListLimit(MAX_EXPENSE_LIST_LIMIT + 500)).toBe(
      MAX_EXPENSE_LIST_LIMIT,
    );
  });

  it("floors at 1 for zero/negative", () => {
    expect(clampExpenseListLimit(0)).toBe(1);
    expect(clampExpenseListLimit(-10)).toBe(1);
  });

  it("truncates fractional limits", () => {
    expect(clampExpenseListLimit(10.9)).toBe(10);
  });

  it("falls back to the max for non-finite input", () => {
    expect(clampExpenseListLimit(Number.NaN)).toBe(MAX_EXPENSE_LIST_LIMIT);
    expect(clampExpenseListLimit(Number.POSITIVE_INFINITY)).toBe(
      MAX_EXPENSE_LIST_LIMIT,
    );
  });
});
