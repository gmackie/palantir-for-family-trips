import type { BriefingPoi, DrivePlan, ScheduleBlock } from "./briefing";

/**
 * Work-window finder — DayMap Feature B1.
 *
 * "When and where does today's work block fit?" is a scheduling question with
 * three hard constraints a van imposes and an office does not: you cannot work
 * while driving, you cannot work without power, and you cannot work without
 * connectivity. This ranks the day's parts against all three.
 *
 * Deliberately input-driven rather than DriftPort-driven. The spec's own open
 * question is that the metric names for Starlink and house power are
 * unconfirmed, so this consumes a plain typed reading the caller maps from
 * whatever it has — a manual entry, a telemetry snapshot, or nothing at all.
 * Inventing an interface to a system nobody has inspected would be a guess
 * wearing a type signature.
 *
 * When no window works it says which constraint failed. "No window today" is
 * useless; "no window today — battery below reserve after noon" is a plan.
 */

export type DayPart = ScheduleBlock["part"];

export const DAY_PARTS: DayPart[] = [
  "morning",
  "midday",
  "afternoon",
  "evening",
];

/** Hours of usable work each part of the day nominally offers. */
const PART_HOURS: Record<DayPart, number> = {
  morning: 3,
  midday: 2,
  afternoon: 3,
  evening: 2,
};

export interface PowerState {
  /** House battery state of charge, percent. */
  batterySoc: number;
  /** True while shore power or the alternator is carrying the load. */
  charging?: boolean;
}

export interface ConnectivityState {
  /** "up" is workable, "degraded" is a gamble, "down" is not a window. */
  status: "up" | "degraded" | "down";
  /** Where the connection came from, for the explanation. */
  source?: string;
}

/** Below this the work session eats into the reserve you sleep on. */
export const DEFAULT_BATTERY_RESERVE_PCT = 40;

export interface WorkWindow {
  part: DayPart;
  hours: number;
  /** Where to be. Null means "wherever you are" — no fixed anchor needed. */
  place: BriefingPoi | null;
  /** Why this window ranks where it does. */
  because: string;
}

export interface WorkWindowPlan {
  windows: WorkWindow[];
  /** Why the day yielded nothing, when it did. */
  blockers: string[];
}

function drivingParts(drive: DrivePlan | null): Set<DayPart> {
  if (!drive || drive.hours <= 0) return new Set();
  // Drives start in the morning and consume parts in order. A six-hour day
  // eats morning and midday; nobody works through either.
  const consumed: DayPart[] = [];
  let remaining = drive.hours;
  for (const part of DAY_PARTS) {
    if (remaining <= 0) break;
    consumed.push(part);
    remaining -= PART_HOURS[part];
  }
  return new Set(consumed);
}

/**
 * Rank today's workable windows, best first.
 *
 * Power is treated as a hard gate rather than a preference: a window that
 * drains the battery below reserve is not a window, it is a decision to have a
 * cold night. Connectivity `degraded` is ranked but not excluded — plenty of
 * work survives a bad connection, and the traveller can judge.
 */
export function findWorkWindows(params: {
  drive: DrivePlan | null;
  power: PowerState | null;
  connectivity: ConnectivityState | null;
  /** A cafe, library, or coworking POI pulled for today, if any. */
  workPlace?: BriefingPoi | null;
  batteryReservePct?: number;
}): WorkWindowPlan {
  const reserve = params.batteryReservePct ?? DEFAULT_BATTERY_RESERVE_PCT;
  const blockers: string[] = [];

  if (!params.power) {
    blockers.push("No power reading — log the house battery to plan work.");
  }
  if (!params.connectivity) {
    blockers.push("No connectivity reading — log signal to plan work.");
  }
  if (params.connectivity?.status === "down") {
    blockers.push(
      `No connection${params.connectivity.source ? ` (${params.connectivity.source})` : ""} — nothing to plan around until it is back.`,
    );
  }
  const powerShort =
    params.power != null &&
    !params.power.charging &&
    params.power.batterySoc <= reserve;
  if (powerShort) {
    blockers.push(
      `Battery at ${Math.round(params.power!.batterySoc)}% is at or below the ${reserve}% reserve — charge before working.`,
    );
  }

  if (blockers.length > 0) return { windows: [], blockers };

  const driving = drivingParts(params.drive);
  if (driving.size === DAY_PARTS.length) {
    return {
      windows: [],
      blockers: ["Driving all day — no window that is not the wheel."],
    };
  }

  const degraded = params.connectivity?.status === "degraded";
  const windows: WorkWindow[] = [];

  for (const part of DAY_PARTS) {
    if (driving.has(part)) continue;
    const reasons: string[] = [];
    if (params.power?.charging) reasons.push("charging");
    else reasons.push(`battery ${Math.round(params.power!.batterySoc)}%`);
    if (degraded) reasons.push("signal is patchy");
    if (params.workPlace && (part === "midday" || part === "afternoon")) {
      reasons.push(
        `${params.workPlace.name} is ${params.workPlace.milesAway} mi away`,
      );
    }

    windows.push({
      part,
      hours: PART_HOURS[part],
      // A named place is only worth the detour mid-day; mornings and evenings
      // are worked from wherever the van already is.
      place:
        params.workPlace && (part === "midday" || part === "afternoon")
          ? params.workPlace
          : null,
      because: reasons.join(", "),
    });
  }

  // Longest first — a three-hour block beats two two-hour ones — then by the
  // order of the day, so ties resolve to "sooner".
  windows.sort((a, b) => {
    if (b.hours !== a.hours) return b.hours - a.hours;
    return DAY_PARTS.indexOf(a.part) - DAY_PARTS.indexOf(b.part);
  });

  return { windows, blockers: [] };
}
