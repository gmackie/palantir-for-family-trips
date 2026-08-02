import { describe, expect, it } from "vitest";

import {
  applyCutIfBehind,
  type CuttableDay,
  describeCuts,
  isCuttable,
} from "../cut-if-behind";

function day(
  date: string,
  intent: string,
  cutIfBehind?: string | null,
  hasAnchor = false,
): CuttableDay {
  return { date, intent, cutIfBehind, hasAnchor };
}

describe("isCuttable", () => {
  it("requires the traveller to have opted in", () => {
    // Silence is not consent — an unmarked day is never dropped.
    expect(isCuttable(day("2026-08-03", "play"))).toBe(false);
    expect(isCuttable(day("2026-08-03", "play", null))).toBe(false);
    expect(isCuttable(day("2026-08-03", "play", "   "))).toBe(false);
    expect(isCuttable(day("2026-08-03", "play", "Skip the hot springs"))).toBe(
      true,
    );
  });

  it("never cuts a drive day — that strands the van, it does not save time", () => {
    expect(isCuttable(day("2026-08-03", "drive", "Skip the scenic loop"))).toBe(
      false,
    );
  });

  it("never cuts an event or an anchored day — those are promises to people", () => {
    expect(isCuttable(day("2026-08-03", "event", "Skip it"))).toBe(false);
    expect(isCuttable(day("2026-08-03", "play", "Skip it", true))).toBe(false);
  });
});

describe("applyCutIfBehind", () => {
  const PLAN = [
    day("2026-08-01", "drive", "Skip the detour"),
    day("2026-08-02", "play", "Skip Goblin Valley"),
    day("2026-08-03", "play"), // not marked
    day("2026-08-04", "play", "Skip the hot springs"),
    day("2026-08-05", "event", "Skip it"),
  ];

  it("changes nothing when the trip is on schedule", () => {
    const decision = applyCutIfBehind(PLAN, 0);
    expect(decision.cut).toEqual([]);
    expect(decision.kept).toHaveLength(PLAN.length);
    expect(decision.shortfallDays).toBe(0);
  });

  it("cuts from the far end first", () => {
    // The nearest days are already being lived; the far end is where the
    // traveller has the most warning.
    const decision = applyCutIfBehind(PLAN, 1);
    expect(decision.cut.map((c) => c.day.date)).toEqual(["2026-08-04"]);
    expect(decision.recoveredDays).toBe(1);
    expect(decision.kept.map((d) => d.date)).not.toContain("2026-08-04");
  });

  it("stops as soon as the deficit is covered", () => {
    // Recovering one day must never cost two.
    const decision = applyCutIfBehind(PLAN, 1);
    expect(decision.cut).toHaveLength(1);
    expect(decision.shortfallDays).toBe(0);
  });

  it("reports cuts in date order even though it chooses in reverse", () => {
    const decision = applyCutIfBehind(PLAN, 2);
    expect(decision.cut.map((c) => c.day.date)).toEqual([
      "2026-08-02",
      "2026-08-04",
    ]);
  });

  it("carries the traveller's own words as the reason", () => {
    const decision = applyCutIfBehind(PLAN, 1);
    expect(decision.cut[0]?.because).toBe("Skip the hot springs");
  });

  it("admits when cutting everything allowed still is not enough", () => {
    // Two cuttable days, four behind. Saying so beats silently deleting more.
    const decision = applyCutIfBehind(PLAN, 4);
    expect(decision.recoveredDays).toBe(2);
    expect(decision.shortfallDays).toBe(2);
    // The drive, the event, and the unmarked day all survive.
    expect(decision.kept.map((d) => d.date)).toEqual([
      "2026-08-01",
      "2026-08-03",
      "2026-08-05",
    ]);
  });

  it("treats a fractional slip conservatively", () => {
    // Half a day behind is not a day's worth of cutting.
    expect(applyCutIfBehind(PLAN, 0.9).cut).toEqual([]);
    expect(applyCutIfBehind(PLAN, 1.9).cut).toHaveLength(1);
  });

  it("ignores a negative deficit rather than cutting", () => {
    expect(applyCutIfBehind(PLAN, -3).cut).toEqual([]);
  });

  it("returns days in date order regardless of input order", () => {
    const shuffled = [PLAN[3]!, PLAN[0]!, PLAN[2]!, PLAN[1]!, PLAN[4]!];
    expect(applyCutIfBehind(shuffled, 0).kept.map((d) => d.date)).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
    ]);
  });
});

describe("describeCuts", () => {
  it("says what went and why", () => {
    const lines = describeCuts(
      applyCutIfBehind([day("2026-08-04", "play", "Skip the hot springs")], 1),
    );
    expect(lines).toEqual(["Cut 2026-08-04: Skip the hot springs"]);
  });

  it("names the shortfall so the traveller knows what has to move", () => {
    const lines = describeCuts(
      applyCutIfBehind([day("2026-08-04", "drive")], 2),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/Still 2 days behind/);
    expect(lines[0]).toMatch(/anchor or a drive day has to move/);
  });
});
