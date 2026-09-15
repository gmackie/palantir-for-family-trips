import { describe, expect, it } from "vitest";

import {
  assertWithinCastBudget,
  CastBudgetExceededError,
  castBudgetLimits,
  DEFAULT_CAST_BUDGET,
  monthStart,
  remainingCastBudget,
} from "../budget";

const LIMITS = { llmOutputTokens: 1000, ttsCharacters: 5000 };
const usage = (ttsCharacters: number, llmOutputTokens = 0) => ({
  ttsCharacters,
  llmOutputTokens,
  episodes: 1,
});

describe("assertWithinCastBudget", () => {
  it("allows a trip under both ceilings", () => {
    expect(() =>
      assertWithinCastBudget(usage(4999, 999), LIMITS),
    ).not.toThrow();
  });

  it("blocks AT the limit, not after crossing it", () => {
    // The next episode is what would overspend, so equality must already stop.
    expect(() => assertWithinCastBudget(usage(5000), LIMITS)).toThrow(
      CastBudgetExceededError,
    );
    expect(() => assertWithinCastBudget(usage(0, 1000), LIMITS)).toThrow(
      CastBudgetExceededError,
    );
  });

  it("names which ceiling was hit and what to do", () => {
    try {
      assertWithinCastBudget(usage(6000), LIMITS);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(CastBudgetExceededError);
      const budgetError = error as CastBudgetExceededError;
      expect(budgetError.kind).toBe("characters");
      expect(budgetError.message).toMatch(/voice characters/);
      expect(budgetError.message).toMatch(/CAST_MONTHLY_TTS_CHARACTERS/);
    }
  });

  it("reports the voice ceiling first — it is the expensive one", () => {
    const both = usage(6000, 2000);
    try {
      assertWithinCastBudget(both, LIMITS);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as CastBudgetExceededError).kind).toBe("characters");
    }
  });
});

describe("castBudgetLimits", () => {
  it("falls back to the defaults", () => {
    expect(castBudgetLimits({})).toEqual(DEFAULT_CAST_BUDGET);
  });

  it("reads overrides from the environment", () => {
    expect(
      castBudgetLimits({
        CAST_MONTHLY_TTS_CHARACTERS: "12345",
        CAST_MONTHLY_LLM_OUTPUT_TOKENS: "678",
      }),
    ).toEqual({ ttsCharacters: 12345, llmOutputTokens: 678 });
  });

  it("ignores junk rather than disabling the ceiling", () => {
    // A typo'd env var must not silently become an unlimited budget.
    for (const bad of ["", "0", "-5", "lots", "NaN"]) {
      expect(castBudgetLimits({ CAST_MONTHLY_TTS_CHARACTERS: bad })).toEqual(
        DEFAULT_CAST_BUDGET,
      );
    }
  });
});

describe("monthStart", () => {
  it("is the first instant of the UTC month", () => {
    expect(monthStart(new Date("2026-08-02T21:15:00Z")).toISOString()).toBe(
      "2026-08-01T00:00:00.000Z",
    );
    expect(monthStart(new Date("2026-01-31T23:59:59Z")).toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });
});

describe("remainingCastBudget", () => {
  it("never reports a negative remainder", () => {
    expect(remainingCastBudget(usage(6000, 1500), LIMITS)).toEqual({
      ttsCharacters: 0,
      llmOutputTokens: 0,
    });
    expect(remainingCastBudget(usage(1000, 100), LIMITS)).toEqual({
      ttsCharacters: 4000,
      llmOutputTokens: 900,
    });
  });
});
