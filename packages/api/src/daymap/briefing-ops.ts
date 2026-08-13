/**
 * Daily-briefing operation shared by the `daymap` router and the CLI. Assembles
 * real data — the day's drive, weather, predictive service alerts, curated
 * nearby POIs, and sunset — into a time-blocked day via `assembleBriefing`.
 */

import { and, eq, gte, inArray, isNull, lte, or } from "@sortey/db";
import { importedPois, tripDays, tripSegments } from "@sortey/db/schema";
import SunCalc from "suncalc";

import { computeNextAnchor } from "../route-planner/anchor-ops";
import {
  resolveCurrentPoint,
  type SegmentLike,
} from "../route-planner/journey-logic";
import { haversineMiles } from "../trips/driving-summary";
import { fetchAirQuality } from "../weather/air-quality";
import { fetchDailyForecast } from "../weather/open-meteo";
import {
  assembleBriefing,
  type BriefingPoi,
  type DayBriefing,
  type DrivePlan,
  type PlannedDayBrief,
  type ScheduleBlock,
  type WeatherBrief,
} from "./briefing";
import { computeServiceAlerts, type ServiceLevels } from "./service-ops";

// Categories the briefing pulls (work / food / experience / camp / fuel).
const USEFUL_CATEGORIES = [
  "coworking",
  "cafe",
  "library",
  "restaurant",
  "grocery",
  "trailhead",
  "scenic",
  "wild_camping",
  "campsite",
  "fuel",
  "rest_area",
];
const NEARBY_DEGREES = 1.0; // ~70mi box for day-of POIs
const DEFAULT_TZ = "America/Los_Angeles";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function clock(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  }).format(d);
}

// biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
export async function computeBriefing(
  db: any,
  p: {
    tripId: string;
    workspaceId?: string;
    date?: string;
    levels?: ServiceLevels;
  },
): Promise<DayBriefing | null> {
  const date = p.date ?? today();

  const segments = (await db
    .select({
      id: tripSegments.id,
      sortOrder: tripSegments.sortOrder,
      originLat: tripSegments.originLat,
      originLng: tripSegments.originLng,
      originName: tripSegments.originName,
      destinationLat: tripSegments.destinationLat,
      destinationLng: tripSegments.destinationLng,
      destinationName: tripSegments.destinationName,
      startDate: tripSegments.startDate,
      distanceMiles: tripSegments.distanceMiles,
      durationMinutes: tripSegments.durationMinutes,
      tz: tripSegments.tz,
    })
    .from(tripSegments)
    .where(eq(tripSegments.tripId, p.tripId))) as Array<
    SegmentLike & {
      distanceMiles: string | null;
      durationMinutes: number | null;
      tz: string | null;
    }
  >;

  // Planned Trip Day for this calendar date (may exist before segments do).
  const [plannedRow] = (await db
    .select({
      intent: tripDays.intent,
      title: tripDays.title,
      overnightName: tripDays.overnightName,
      overnightLat: tripDays.overnightLat,
      overnightLng: tripDays.overnightLng,
      heroTitle: tripDays.heroTitle,
      heroDetail: tripDays.heroDetail,
      cutIfBehind: tripDays.cutIfBehind,
      blocksJson: tripDays.blocksJson,
    })
    .from(tripDays)
    .where(and(eq(tripDays.tripId, p.tripId), eq(tripDays.date, date)))
    .limit(1)) as Array<{
    intent: string;
    title: string | null;
    overnightName: string | null;
    overnightLat: string | null;
    overnightLng: string | null;
    heroTitle: string | null;
    heroDetail: string | null;
    cutIfBehind: string | null;
    blocksJson: ScheduleBlock[] | null;
  }>;

  const plannedDay: PlannedDayBrief | null = plannedRow
    ? {
        intent: plannedRow.intent,
        title: plannedRow.title,
        overnightName: plannedRow.overnightName,
        heroTitle: plannedRow.heroTitle,
        heroDetail: plannedRow.heroDetail,
        cutIfBehind: plannedRow.cutIfBehind,
        blocks: plannedRow.blocksJson,
      }
    : null;

  let position = resolveCurrentPoint(segments, date);
  // Fall back to planned overnight coords when segments aren't logged yet.
  if (
    !position &&
    plannedRow?.overnightLat != null &&
    plannedRow.overnightLng != null
  ) {
    position = {
      lat: Number(plannedRow.overnightLat),
      lng: Number(plannedRow.overnightLng),
      name: plannedRow.overnightName ?? plannedRow.title ?? "Planned stop",
    };
  }
  if (!position) return null;

  // Today's drive = the segment whose startDate is exactly `date`.
  const todaySeg = segments.find((s) => s.startDate === date);
  const drive: DrivePlan | null =
    todaySeg && todaySeg.distanceMiles && Number(todaySeg.distanceMiles) > 5
      ? {
          fromName: todaySeg.originName ?? position.name,
          toName: todaySeg.destinationName ?? "next stop",
          miles: Math.round(Number(todaySeg.distanceMiles)),
          hours: Math.round(((todaySeg.durationMinutes ?? 0) / 60) * 10) / 10,
        }
      : null;
  const tz = todaySeg?.tz ?? DEFAULT_TZ;

  // Weather + sunset for where the day ends (destination) or current position.
  const focus =
    drive && todaySeg?.destinationLat != null && todaySeg.destinationLng != null
      ? {
          lat: Number(todaySeg.destinationLat),
          lng: Number(todaySeg.destinationLng),
          name: drive.toName,
        }
      : plannedRow?.overnightLat != null && plannedRow.overnightLng != null
        ? {
            lat: Number(plannedRow.overnightLat),
            lng: Number(plannedRow.overnightLng),
            name: plannedRow.overnightName ?? plannedRow.title ?? position.name,
          }
        : position;
  const forecast = await fetchDailyForecast({
    lat: focus.lat,
    lng: focus.lng,
    date,
  });
  const weather: WeatherBrief | null = forecast
    ? {
        highF: forecast.highF,
        lowF: forecast.lowF,
        precipProbability: forecast.precipProbability,
        label: forecast.label,
      }
    : null;
  const sunset = clock(
    SunCalc.getTimes(new Date(`${date}T12:00:00Z`), focus.lat, focus.lng)
      .sunset,
    tz,
  );
  const airQuality = await fetchAirQuality({ lat: focus.lat, lng: focus.lng });

  // Curated POIs near the current position.
  const rows = (await db
    .select({
      id: importedPois.id,
      name: importedPois.name,
      category: importedPois.category,
      lat: importedPois.lat,
      lng: importedPois.lng,
    })
    .from(importedPois)
    .where(
      and(
        inArray(importedPois.category, USEFUL_CATEGORIES),
        gte(importedPois.lat, position.lat - NEARBY_DEGREES),
        lte(importedPois.lat, position.lat + NEARBY_DEGREES),
        gte(importedPois.lng, position.lng - NEARBY_DEGREES),
        lte(importedPois.lng, position.lng + NEARBY_DEGREES),
        p.workspaceId
          ? or(
              isNull(importedPois.workspaceId),
              eq(importedPois.workspaceId, p.workspaceId),
            )
          : isNull(importedPois.workspaceId),
      ),
    )
    .limit(2000)) as Array<{
    id: string;
    name: string;
    category: string;
    lat: string;
    lng: string;
  }>;

  const pois: BriefingPoi[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    lat: Number(r.lat),
    lng: Number(r.lng),
    milesAway:
      Math.round(
        haversineMiles(position, { lat: Number(r.lat), lng: Number(r.lng) }) *
          10,
      ) / 10,
  }));

  const { alerts } = await computeServiceAlerts(db, {
    tripId: p.tripId,
    workspaceId: p.workspaceId,
    levels: p.levels,
  });

  const anchor = await computeNextAnchor(db, {
    tripId: p.tripId,
    from: position,
    today: date,
  });

  return assembleBriefing({
    date,
    positionName: position.name,
    drive,
    plannedDay,
    stopName: drive?.toName ?? position.name,
    weather,
    airQuality,
    serviceAlerts: alerts,
    pois,
    sunset,
    anchor,
  });
}
