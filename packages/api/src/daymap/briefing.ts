/**
 * Daily briefing assembly — "what does today look like physically?"
 * (Projects/Sortey.md). Pure + testable: given the day's drive, weather, service
 * alerts, and curated nearby POIs, produce a time-blocked schedule + the useful
 * stops to pull. The `daymap` router feeds real data in.
 *
 * The schedule is *influenced* by the inputs: rain pushes work indoors, urgent
 * service gets a block, a big drive lands in the morning, camp before sunset.
 */

import type { AirQuality } from "../weather/air-quality";
import type { ServiceAlert } from "./service";

export interface BriefingPoi {
  id: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  milesAway: number;
}

export interface WeatherBrief {
  highF: number;
  lowF: number;
  precipProbability: number;
  label: string;
}

export interface DrivePlan {
  fromName: string;
  toName: string;
  miles: number;
  hours: number;
}

export interface ScheduleBlock {
  part: "morning" | "midday" | "afternoon" | "evening";
  title: string;
  detail: string;
}

export interface DayBriefing {
  date: string;
  positionName: string;
  drive: DrivePlan | null;
  stopName: string | null;
  weather: WeatherBrief | null;
  airQuality: AirQuality | null;
  schedule: ScheduleBlock[];
  /** The useful POIs pulled for today, one per role. */
  pois: {
    work?: BriefingPoi;
    food?: BriefingPoi;
    experience?: BriefingPoi;
    camp?: BriefingPoi;
    fuel?: BriefingPoi;
  };
  serviceAlerts: ServiceAlert[];
  notes: string[];
}

/** Nearest POI whose category is in `cats`, preferring earlier categories. */
export function pickPoi(
  pois: BriefingPoi[],
  cats: string[],
): BriefingPoi | undefined {
  let best: BriefingPoi | undefined;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const p of pois) {
    const rank = cats.indexOf(p.category);
    if (rank === -1) continue;
    // Prefer higher-priority category; within a category, nearer wins.
    if (
      rank < bestRank ||
      (rank === bestRank && best && p.milesAway < best.milesAway)
    ) {
      best = p;
      bestRank = rank;
    }
  }
  return best;
}

export interface BriefingInput {
  date: string;
  positionName: string;
  drive: DrivePlan | null;
  stopName: string | null;
  weather: WeatherBrief | null;
  serviceAlerts: ServiceAlert[];
  /** Curated nearby POIs (already distance-tagged). */
  pois: BriefingPoi[];
  /** Sunset clock time for the destination, e.g. "20:41", if known. */
  sunset?: string;
  airQuality?: AirQuality | null;
}

const WET = 50; // precip % above which we push work indoors

export function assembleBriefing(input: BriefingInput): DayBriefing {
  const rainy = (input.weather?.precipProbability ?? 0) >= WET;
  const smoky =
    input.airQuality?.concern === "unhealthy" ||
    input.airQuality?.concern === "hazardous";
  // Rain OR smoke pushes work (and life) indoors.
  const indoors = rainy || smoky;

  // Pull the useful POIs (roles), weather/smoke steering the work spot indoors.
  const workCats = indoors
    ? ["library", "cafe", "coworking"]
    : ["coworking", "cafe", "library", "scenic", "rest_area"];
  const work = pickPoi(input.pois, workCats);
  const food = pickPoi(input.pois, ["restaurant", "grocery"]);
  const experience = pickPoi(input.pois, ["trailhead", "scenic"]);
  const camp = pickPoi(input.pois, ["campsite"]);
  const fuel = pickPoi(input.pois, ["fuel"]);

  const urgent = input.serviceAlerts
    .filter((a) => a.urgency === "now" || a.urgency === "soon")
    .sort((a, b) => a.daysUntil - b.daysUntil);

  const schedule: ScheduleBlock[] = [];
  const notes: string[] = [];

  // ── Morning ──
  if (input.drive && input.drive.miles > 40) {
    schedule.push({
      part: "morning",
      title: `Drive → ${input.drive.toName}`,
      detail: `${input.drive.miles} mi · ~${input.drive.hours}h. Leave after pack-up to bank daylight.`,
    });
  } else if (indoors && work) {
    const why = smoky
      ? `Smoke (AQI ${input.airQuality?.usAqi})`
      : `Rain likely (${input.weather?.precipProbability}%)`;
    schedule.push({
      part: "morning",
      title: `Indoor work block — ${work.name}`,
      detail: `${why}; grab power + a table (${work.milesAway} mi).`,
    });
  } else if (work) {
    schedule.push({
      part: "morning",
      title: `Work block — ${work.name}`,
      detail: `${work.category} · ${work.milesAway} mi.`,
    });
  }

  // ── Midday: service (if urgent) + food ──
  const topService = urgent[0];
  if (topService?.stop) {
    schedule.push({
      part: "midday",
      title: `Service: ${topService.label} (${topService.levelPct}%)`,
      detail: `${topService.urgency === "now" ? "Due now" : `~${topService.daysUntil}d`} → ${topService.stop.name} (${topService.stop.milesAway} mi).`,
    });
  }
  if (food) {
    schedule.push({
      part: "midday",
      title: `Food — ${food.name}`,
      detail: `${food.category} · ${food.milesAway} mi.`,
    });
  }

  // ── Afternoon: experience, or work if not done in the morning ──
  if (experience && !indoors) {
    schedule.push({
      part: "afternoon",
      title: `Experience — ${experience.name}`,
      detail: `${experience.category} · ${experience.milesAway} mi.`,
    });
  } else if (work && input.drive && input.drive.miles > 40) {
    schedule.push({
      part: "afternoon",
      title: `Work block — ${work.name}`,
      detail: `After the drive; ${work.milesAway} mi.`,
    });
  }

  // ── Evening: camp before dark ──
  const campName = camp?.name ?? input.stopName;
  if (campName) {
    schedule.push({
      part: "evening",
      title: `Camp — ${campName}`,
      detail: input.sunset
        ? `Arrive before sunset (${input.sunset}).`
        : "Settle in; solar tops up for tomorrow.",
    });
  }

  if (smoky)
    notes.push(
      `⚠️ Air ${input.airQuality?.category} (AQI ${input.airQuality?.usAqi}, PM2.5 ${input.airQuality?.pm25}) — limit outdoor time; consider moving to cleaner air.`,
    );
  if (rainy)
    notes.push(
      `Rain likely (${input.weather?.precipProbability}%) — indoor work, dry camp.`,
    );
  if (urgent.length > 0)
    notes.push(`${urgent.length} service need(s) coming due — see midday.`);
  if (!input.drive)
    notes.push("Parked day — no drive; work/service/experience here.");

  return {
    date: input.date,
    positionName: input.positionName,
    drive: input.drive,
    stopName: input.stopName,
    weather: input.weather,
    airQuality: input.airQuality ?? null,
    schedule,
    pois: { work, food, experience, camp, fuel },
    serviceAlerts: urgent,
    notes,
  };
}
