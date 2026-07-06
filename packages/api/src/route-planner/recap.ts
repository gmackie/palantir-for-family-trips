/**
 * Trip recap — a shareable summary of the journey *traveled so far* (the
 * OpenTripReport idea), built from logged segments + pins. Pure + testable.
 * Planned/future legs are excluded so a recap reflects what actually happened.
 */

export interface RecapSegment {
  name: string;
  destinationName: string | null;
  distanceMiles: string | null;
  startDate: string | null;
}

export interface RecapPin {
  title: string;
  type: string;
  /** The pin's segment startDate — planned (future) camps are excluded. */
  segmentDate?: string | null;
}

export interface TripRecap {
  from: string | null;
  to: string | null;
  dateStart: string | null;
  dateEnd: string | null;
  days: number;
  totalMiles: number;
  stopCount: number;
  /** 2-letter states/provinces touched, in order first-seen. */
  states: string[];
  campCount: number;
  camps: string[];
  longestLeg: { name: string; miles: number } | null;
  /** Actual GPS-driven miles (from breadcrumbs), when a track exists. */
  actualMiles: number | null;
  highlights: string[];
}

function stateOf(name: string | null): string | null {
  if (!name) return null;
  // Last ", XX" 2-letter uppercase token (e.g. "Lyle, WA" → WA).
  const matches = [...name.matchAll(/,\s*([A-Z]{2})\b/g)];
  return matches.length > 0 ? matches[matches.length - 1]![1]! : null;
}

function dayDiff(start: string, end: string): number {
  const d = (Date.parse(end) - Date.parse(start)) / 86_400_000;
  return Number.isFinite(d) ? Math.max(0, Math.round(d)) : 0;
}

/**
 * Build a recap of the traveled journey (segments with `startDate <= today`).
 */
export function buildRecap(
  segments: RecapSegment[],
  pins: RecapPin[],
  today: string,
  track?: { actualMiles: number; points: number } | null,
): TripRecap {
  const traveled = segments
    .filter((s) => s.startDate != null && s.startDate <= today)
    .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));

  const totalMiles = Math.round(
    traveled.reduce(
      (sum, s) => sum + (s.distanceMiles ? Number(s.distanceMiles) : 0),
      0,
    ),
  );

  const dates = traveled
    .map((s) => s.startDate)
    .filter((d): d is string => d != null);
  const dateStart = dates[0] ?? null;
  const dateEnd = dates[dates.length - 1] ?? null;

  const states: string[] = [];
  for (const s of traveled) {
    const st = stateOf(s.destinationName ?? s.name);
    if (st && !states.includes(st)) states.push(st);
  }

  const camps = pins
    .filter(
      (p) =>
        p.type === "campsite" &&
        (p.segmentDate == null || p.segmentDate <= today),
    )
    .map((p) => p.title);

  let longestLeg: TripRecap["longestLeg"] = null;
  for (const s of traveled) {
    const miles = s.distanceMiles ? Number(s.distanceMiles) : 0;
    if (!longestLeg || miles > longestLeg.miles) {
      longestLeg = {
        name: s.destinationName ?? s.name,
        miles: Math.round(miles),
      };
    }
  }

  const actualMiles =
    track && track.points > 1 ? Math.round(track.actualMiles) : null;

  const highlights: string[] = [];
  if (states.length > 0)
    highlights.push(`${states.length} states: ${states.join(" → ")}`);
  if (camps.length > 0) highlights.push(`${camps.length} camps`);
  if (longestLeg)
    highlights.push(`longest leg ${longestLeg.miles} mi to ${longestLeg.name}`);
  if (actualMiles != null) highlights.push(`${actualMiles} mi driven (GPS)`);

  return {
    from: traveled[0]?.name?.split(" → ")[0] ?? null,
    to: traveled[traveled.length - 1]?.destinationName ?? null,
    dateStart,
    dateEnd,
    days: dateStart && dateEnd ? dayDiff(dateStart, dateEnd) + 1 : 0,
    totalMiles,
    stopCount: traveled.length,
    states,
    campCount: camps.length,
    camps,
    longestLeg,
    actualMiles,
    highlights,
  };
}
