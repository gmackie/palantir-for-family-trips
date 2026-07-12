/**
 * Leave-by math for Today Command — pure, deterministic.
 *
 * Estimate when to leave to hit an overnight / anchor with daylight and a
 * max-drive budget. Not a navigator ETA.
 */

export interface LeaveByInput {
  /** Miles still to cover to the target (road estimate). */
  milesRemaining: number;
  /** Average speed mph (default 45 for mountain/coast). */
  avgMph?: number;
  /** Extra hours buffer before desired arrival (default 0.5). */
  bufferHours?: number;
  /** Desired arrival as Date (e.g. sunset − 1h). */
  desiredArrival: Date;
  /** Current time. */
  now: Date;
}

export interface LeaveByResult {
  leaveBy: Date;
  leaveByLocal: string;
  minutesSlack: number;
  driveHours: number;
  late: boolean;
  reason: string;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Format HH:mm in a given IANA timezone. */
export function formatLocalHm(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(d);
}

/**
 * Compute leave-by from miles + desired arrival.
 * minutesSlack < 0 means already past leave-by (late).
 */
export function computeLeaveBy(input: LeaveByInput): LeaveByResult {
  const avgMph = input.avgMph && input.avgMph > 0 ? input.avgMph : 45;
  const bufferHours = input.bufferHours ?? 0.5;
  const miles = Math.max(0, input.milesRemaining);
  const driveHours = miles / avgMph;
  const totalHours = driveHours + bufferHours;
  const leaveBy = new Date(
    input.desiredArrival.getTime() - totalHours * 3_600_000,
  );
  const minutesSlack = Math.round(
    (leaveBy.getTime() - input.now.getTime()) / 60_000,
  );
  const late = minutesSlack < 0;
  const reason =
    miles <= 0
      ? "Already at target"
      : `~${Math.round(miles)} mi · ~${driveHours.toFixed(1)}h drive + ${bufferHours}h buffer`;

  return {
    leaveBy,
    leaveByLocal: `${pad2(leaveBy.getUTCHours())}:${pad2(leaveBy.getUTCMinutes())}`,
    minutesSlack,
    driveHours: Math.round(driveHours * 10) / 10,
    late,
    reason,
  };
}

/**
 * Desired arrival: local 18:00 today if no sunset, else sunset − 1h.
 * `sunset` is a Date at the target location.
 */
export function desiredArrivalFromSunset(
  sunset: Date | null,
  dayDate: string,
  fallbackHourLocal = 18,
): Date {
  if (sunset && Number.isFinite(sunset.getTime())) {
    return new Date(sunset.getTime() - 3_600_000);
  }
  // noon UTC proxy for the calendar day + fallback hour as UTC (good enough
  // for relative leave-by; callers with tz should pass real sunset).
  const [y, m, d] = dayDate.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, fallbackHourLocal, 0, 0));
}
