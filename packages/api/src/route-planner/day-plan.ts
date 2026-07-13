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
  /**
   * Miles of pure driving before this visit. When set, replanDraft inserts
   * hour-budgeted lead-in `drive` days (see estimateDriveDays).
   */
  leadInMiles?: number;
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
  /**
   * When no must-visits are provided, pack the window as hour-aware drive days
   * covering this total mileage (plain A→B hour packer).
   */
  totalDriveMiles?: number;
  /** Max driving hours per day for hour packing (default 10). */
  maxDriveHours?: number;
  /** Average mph for hour packing (default 55). */
  avgMph?: number;
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

/** Default max driving hours for packing pure A→B drive days (CONTEXT / planner). */
export const DEFAULT_MAX_DRIVE_HOURS = 10;
export const DEFAULT_AVG_MPH = 55;

/**
 * How many calendar drive days are needed to cover `totalMiles` under a max
 * hours-per-day budget. Used by replanDraft when `totalDriveMiles` is set.
 */
export function estimateDriveDays(input: {
  totalMiles: number;
  maxDriveHours?: number;
  avgMph?: number;
}): number {
  if (!(input.totalMiles > 0)) return 0;
  const maxH = input.maxDriveHours ?? DEFAULT_MAX_DRIVE_HOURS;
  const mph = input.avgMph ?? DEFAULT_AVG_MPH;
  if (!(maxH > 0) || !(mph > 0)) return 1;
  const hours = input.totalMiles / mph;
  return Math.max(1, Math.ceil(hours / maxH));
}

/**
 * Pack must-visits across a date range. Play/event date overrides win on intent.
 * Days after the last packed visit default to `position` (stage for anchor).
 *
 * When `totalDriveMiles` is provided, leading days that would otherwise be
 * empty are marked `drive` with an estimated hours budget so plain A→B windows
 * respect max drive hours (P2 hour-aware packer).
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

  // Reserve leading drive days when a total mileage is known and no must-visits
  // claim the front of the window (hour-aware A→B packing).
  if (
    visits.length === 0 &&
    input.totalDriveMiles != null &&
    input.totalDriveMiles > 0
  ) {
    const needed = estimateDriveDays({
      totalMiles: input.totalDriveMiles,
      maxDriveHours: input.maxDriveHours,
      avgMph: input.avgMph,
    });
    const hoursPerDay =
      input.totalDriveMiles /
      (input.avgMph ?? DEFAULT_AVG_MPH) /
      Math.max(needed, 1);
    for (let i = 0; i < days.length; i++) {
      const day = days[i]!;
      if (day.intent === "event" || play.has(day.date)) continue;
      if (i < needed) {
        day.intent = "drive";
        day.title = day.title ?? `Drive day ${i + 1}`;
        day.note =
          day.note ??
          `~${Math.round(hoursPerDay * 10) / 10}h target (max ${input.maxDriveHours ?? DEFAULT_MAX_DRIVE_HOURS}h)`;
      } else {
        day.intent = "position";
      }
    }
    return days;
  }

  for (const visit of visits) {
    const nights = Math.max(1, visit.nights ?? 1);
    // Optional lead-in drive days before this visit based on leg miles.
    if (visit.leadInMiles != null && visit.leadInMiles > 0) {
      const leadDays = estimateDriveDays({
        totalMiles: visit.leadInMiles,
        maxDriveHours: input.maxDriveHours,
        avgMph: input.avgMph,
      });
      for (let d = 0; d < leadDays && cursor < days.length; d++) {
        const day = days[cursor]!;
        if (day.intent !== "event" && !play.has(day.date)) {
          day.intent = "drive";
          day.title = day.title ?? `Toward ${visit.name}`;
          day.note =
            day.note ??
            `Lead-in · ~${Math.round(visit.leadInMiles / leadDays)} mi/day`;
        }
        cursor++;
      }
    }

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
