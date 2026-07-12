/**
 * Trip Day planning — pure logic.
 *
 * The planning unit is the calendar day (intent, overnight, hero), not the
 * route polyline. See docs/plans/2026-07-09-itinerary-planner.md.
 */

export const DAY_INTENTS = [
  "play",
  "drive",
  "position",
  "event",
  "recovery",
] as const;
export type DayIntent = (typeof DAY_INTENTS)[number];

export const OVERNIGHT_KINDS = [
  "dispersed",
  "campground",
  "hotel",
  "unknown",
] as const;
export type OvernightKind = (typeof OVERNIGHT_KINDS)[number];

export type DayPart = "morning" | "midday" | "afternoon" | "evening";

export interface DayBlock {
  part: DayPart;
  title: string;
  detail: string;
}

export interface DayPlanDraft {
  date: string;
  intent: DayIntent;
  title: string | null;
  overnightName: string | null;
  overnightKind: OvernightKind | null;
  heroTitle: string | null;
  heroDetail: string | null;
  cutIfBehind: string | null;
  blocks: DayBlock[];
  note: string | null;
}

export interface MustVisit {
  name: string;
  /** Nights to spend ending at this place (default 1). */
  nights?: number;
  intent?: DayIntent;
  heroTitle?: string;
  heroDetail?: string;
  overnightKind?: OvernightKind;
  cutIfBehind?: string;
}

export interface ReplanDraftInput {
  /** First day to plan (inclusive), YYYY-MM-DD. */
  fromDate: string;
  /** Last day to plan (inclusive), YYYY-MM-DD. */
  untilDate: string;
  /** Ordered stops to pack left-to-right across the range. */
  mustVisits?: MustVisit[];
  /** Force play intent on these dates. */
  playDates?: string[];
  /** Force event intent on these dates (e.g. festival days). */
  eventDates?: string[];
  defaultOvernightKind?: OvernightKind;
}

/** Inclusive list of YYYY-MM-DD from `from` to `to`. Empty if inverted. */
export function eachDateInclusive(from: string, to: string): string[] {
  if (from > to) return [];
  const out: string[] = [];
  // Parse as UTC noon to avoid DST edge issues on date-only strings.
  let t = Date.parse(`${from}T12:00:00Z`);
  const end = Date.parse(`${to}T12:00:00Z`);
  if (!Number.isFinite(t) || !Number.isFinite(end)) return [];
  while (t <= end) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86_400_000;
  }
  return out;
}

function emptyDay(date: string, intent: DayIntent = "drive"): DayPlanDraft {
  return {
    date,
    intent,
    title: null,
    overnightName: null,
    overnightKind: null,
    heroTitle: null,
    heroDetail: null,
    cutIfBehind: null,
    blocks: [],
    note: null,
  };
}

/**
 * Pack must-visits across a date range. Play/event date overrides win on intent.
 * Days after the last packed visit default to `position` (stage for anchor).
 */
export function replanDraft(input: ReplanDraftInput): DayPlanDraft[] {
  const dates = eachDateInclusive(input.fromDate, input.untilDate);
  if (dates.length === 0) return [];

  const play = new Set(input.playDates ?? []);
  const events = new Set(input.eventDates ?? []);
  const defaultKind = input.defaultOvernightKind ?? null;

  const days = dates.map((d) => {
    const day = emptyDay(d, "drive");
    if (events.has(d)) day.intent = "event";
    else if (play.has(d)) day.intent = "play";
    if (defaultKind) day.overnightKind = defaultKind;
    return day;
  });

  const visits = input.mustVisits ?? [];
  let cursor = 0;

  for (const visit of visits) {
    const nights = Math.max(1, visit.nights ?? 1);
    for (let n = 0; n < nights && cursor < days.length; n++) {
      const day = days[cursor]!;
      // Don't overwrite forced event days with visit packing.
      if (day.intent !== "event") {
        day.intent = visit.intent ?? (play.has(day.date) ? "play" : "drive");
        if (play.has(day.date)) day.intent = "play";
      }
      day.title = visit.name;
      day.overnightName = visit.name;
      day.overnightKind = visit.overnightKind ?? defaultKind;
      if (visit.heroTitle) day.heroTitle = visit.heroTitle;
      if (visit.heroDetail) day.heroDetail = visit.heroDetail ?? null;
      if (visit.cutIfBehind) day.cutIfBehind = visit.cutIfBehind;
      cursor++;
    }
  }

  // Trailing days with no visit → position (buffer toward next anchor).
  for (let i = cursor; i < days.length; i++) {
    const day = days[i]!;
    if (day.intent === "event") continue;
    if (!play.has(day.date)) day.intent = "position";
  }

  return days;
}

/**
 * Golden dogfood draft: Jul 11–15 play window on the Open Sauce approach.
 * Used in tests and as a seed template for the real trip.
 */
export function openSauceApproachDraft(): DayPlanDraft[] {
  return replanDraft({
    fromDate: "2026-07-11",
    untilDate: "2026-07-15",
    playDates: ["2026-07-11", "2026-07-14"],
    mustVisits: [
      {
        name: "Bend",
        nights: 1,
        intent: "play",
        overnightKind: "unknown",
        heroTitle: "Smith Rock",
        heroDetail: "Morning rock; afternoon Cascade Lakes or Newberry",
        cutIfBehind: "Skip Newberry; keep Smith Rock or lakes only",
      },
      {
        name: "Crater Lake",
        nights: 1,
        intent: "drive",
        overnightKind: "campground",
        heroTitle: "Rim Drive",
        heroDetail: "Short walks; skip Cleetwood if tired",
        cutIfBehind: "Overlook only, no long rim walk",
      },
      {
        name: "Port Orford",
        nights: 1,
        intent: "drive",
        overnightKind: "unknown",
        heroTitle: "First ocean",
        heroDetail: "Port Orford Heads or Cape Blanco if time",
        cutIfBehind: "Drive to coast, skip cape",
      },
      {
        name: "Redwoods corridor",
        nights: 1,
        intent: "play",
        overnightKind: "dispersed",
        heroTitle: "One grove hike",
        heroDetail: "Stout Grove / Jedediah Smith or Prairie Creek — pick one",
        cutIfBehind: "Avenue of the Giants drive-through only",
      },
      {
        name: "North Bay",
        nights: 1,
        intent: "position",
        overnightKind: "unknown",
        heroTitle: "Stage for San Mateo",
        heroDetail: "Avenue of the Giants if not done; no late night into SF",
        cutIfBehind: "Pure drive to Petaluma/Santa Rosa",
      },
    ],
  });
}
