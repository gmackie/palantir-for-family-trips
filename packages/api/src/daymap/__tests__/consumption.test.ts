import { describe, expect, it } from "vitest";

import {
  estimateRatePctPerDay,
  learnRates,
  type Reading,
} from "../consumption";

function reading(day: number, levelPct: number): Reading {
  // day 0 = 2026-07-01T00:00Z, +1 per day
  const t = new Date(Date.parse("2026-07-01T00:00:00Z") + day * 86_400_000);
  return { levelPct, recordedAt: t.toISOString() };
}

describe("estimateRatePctPerDay", () => {
  it("learns a grey fill rate (+%/day) from a rising history", () => {
    const rate = estimateRatePctPerDay(
      [reading(0, 20), reading(1, 45), reading(2, 70)], // +25%/day
      "fill",
    );
    expect(rate).toBeCloseTo(25, 1);
  });

  it("learns a fresh drain rate from a falling history", () => {
    const rate = estimateRatePctPerDay(
      [reading(0, 90), reading(1, 65), reading(2, 40)], // -25%/day
      "drain",
    );
    expect(rate).toBeCloseTo(25, 1);
  });

  it("returns null with too few readings", () => {
    expect(estimateRatePctPerDay([reading(0, 50)], "fill")).toBeNull();
    expect(estimateRatePctPerDay([], "drain")).toBeNull();
  });

  it("returns null when the trend runs opposite to the direction (e.g. a refill)", () => {
    // level rose, but we asked for a drain → don't trust it
    expect(
      estimateRatePctPerDay([reading(0, 20), reading(1, 80)], "drain"),
    ).toBeNull();
  });

  it("returns null when the span is too short to trust", () => {
    const a: Reading = { levelPct: 20, recordedAt: "2026-07-01T00:00:00Z" };
    const b: Reading = { levelPct: 22, recordedAt: "2026-07-01T01:00:00Z" }; // 1h
    expect(estimateRatePctPerDay([a, b], "fill")).toBeNull();
  });
});

describe("learnRates", () => {
  it("overrides defaults with learned rates, keeps defaults otherwise", () => {
    const rates = learnRates(
      {
        grey: [reading(0, 10), reading(2, 70)], // +30%/day learned
        fresh: [reading(0, 50)], // too little → default
      },
      { grey: "fill", fresh: "drain" },
      { grey: 20, fresh: 30, propane: 10 },
    );
    expect(rates.grey).toBeCloseTo(30, 1); // learned, not default 20
    expect(rates.fresh).toBe(30); // default kept
    expect(rates.propane).toBe(10); // untouched default
  });
});
