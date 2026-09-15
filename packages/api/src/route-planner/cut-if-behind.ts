/**
 * Cut-if-behind — turning a note into an action (backlog R10).
 *
 * Every plan day can carry a `cutIfBehind` line: the thing the traveller
 * decided, calmly and in advance, that they would give up if the schedule
 * slipped. Until now that text was only ever displayed. Replanning "behind"
 * regenerated days and left the human to work out what to drop, which is
 * exactly the decision they had already made and written down.
 *
 * The rules are conservative, because dropping something from someone's trip
 * is not a decision to be clever about:
 *
 * - **Only days that opted in.** No `cutIfBehind` text, no cut. Silence is not
 *   consent.
 * - **Never a drive day.** Cutting the driving does not recover time, it
 *   strands the van.
 * - **Never an anchor day.** An anchor is a commitment to other people.
 * - **Cut the latest first.** The nearest days are already being lived; the
 *   plan gets shorter from the far end, which is also where the traveller has
 *   the most warning.
 * - **Stop as soon as the deficit is covered.** Recovering two days must never
 *   cost three.
 */

export interface CuttableDay {
  date: string;
  intent: string;
  /** What the traveller said they would give up. Absent means not cuttable. */
  cutIfBehind?: string | null;
  /** True when an anchor lands on this day — a commitment to other people. */
  hasAnchor?: boolean;
}

export interface CutDecision<T extends CuttableDay> {
  /** Days that survive, in date order. */
  kept: T[];
  /** Days dropped, each with the reason the traveller wrote. */
  cut: Array<{ day: T; because: string }>;
  /** Days of schedule recovered. */
  recoveredDays: number;
  /** Deficit still uncovered after every allowed cut. */
  shortfallDays: number;
}

/** Intents that never recover time by being dropped. */
const UNCUTTABLE_INTENTS = new Set(["drive", "event"]);

export function isCuttable(day: CuttableDay): boolean {
  if (!day.cutIfBehind || day.cutIfBehind.trim().length === 0) return false;
  if (UNCUTTABLE_INTENTS.has(day.intent)) return false;
  if (day.hasAnchor) return false;
  return true;
}

/**
 * Choose which days to drop to recover `daysBehind` of schedule.
 *
 * Returns the full picture rather than just the survivors: the caller has to
 * be able to tell the traveller what was dropped and why, and — when the plan
 * cannot absorb the slip — that cutting everything cuttable still is not
 * enough. A replan that quietly deletes days is worse than one that says it
 * could not save you.
 */
export function applyCutIfBehind<T extends CuttableDay>(
  days: T[],
  daysBehind: number,
): CutDecision<T> {
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const deficit = Math.max(Math.floor(daysBehind), 0);

  if (deficit === 0) {
    return { kept: ordered, cut: [], recoveredDays: 0, shortfallDays: 0 };
  }

  // Latest first: the far end of the plan is where there is most warning.
  const candidates = ordered.filter(isCuttable).reverse();
  const cutDates = new Set<string>();
  const cut: CutDecision<T>["cut"] = [];

  for (const day of candidates) {
    if (cut.length >= deficit) break;
    cutDates.add(day.date);
    cut.push({ day, because: day.cutIfBehind!.trim() });
  }

  return {
    kept: ordered.filter((day) => !cutDates.has(day.date)),
    // Report in date order — that is how the traveller reads their trip.
    cut: cut.reverse(),
    recoveredDays: cut.length,
    shortfallDays: Math.max(deficit - cut.length, 0),
  };
}

/** Human lines for the replan preview's warnings. */
export function describeCuts<T extends CuttableDay>(
  decision: CutDecision<T>,
): string[] {
  const lines = decision.cut.map(
    ({ day, because }) => `Cut ${day.date}: ${because}`,
  );
  if (decision.shortfallDays > 0) {
    lines.push(
      `Still ${decision.shortfallDays} day${decision.shortfallDays === 1 ? "" : "s"} behind after every cut — an anchor or a drive day has to move.`,
    );
  }
  return lines;
}
