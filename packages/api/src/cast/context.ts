import { decode } from "@googlemaps/polyline-codec";
import { and, asc, desc, eq, gte, isNull, lte, or } from "@sortey/db";
import {
  type CastGroundingFact,
  castGroundingBriefs,
  importedPois,
  tripAnchors,
  tripDays,
  tripSegments,
  trips,
} from "@sortey/db/schema";

import {
  rankPoisNear,
  type SuggestablePoi,
} from "../route-planner/poi-suggest";

/**
 * Corridor Cast context pack — everything the script generator is allowed to
 * treat as ground truth for one drive day. Operational facts (roads, towns,
 * distances, stops, anchors, POIs) come ONLY from here; anything else the
 * script says is explicitly model-knowledge color (see prompt.ts).
 */

const POI_SAMPLE_RADIUS_MILES = 15;
const POI_PER_SAMPLE = 6;
const POI_TOTAL_LIMIT = 20;
const MILES_TO_DEGREES_LAT = 1 / 69;
const MILES_TO_DEGREES_LNG_AT_45 = 1 / 49;

export type CastContextPoi = {
  name: string;
  category: string;
  milesAway: number;
  /** Which sampled corridor point this POI is near (0 = origin … 1 = destination). */
  routeFraction: number;
};

export type CastDayContext = {
  tripName: string;
  tz: string;
  targetDate: string; // YYYY-MM-DD in the trip's tz
  hasDriveLeg: boolean;
  /** Segment exists but has no route geometry — generate without corridor POIs. */
  degraded: boolean;
  segment: {
    name: string;
    originName: string | null;
    destinationName: string | null;
    distanceMiles: number | null;
    durationMinutes: number | null;
    hasGeometry: boolean;
  } | null;
  day: {
    intent: string;
    title: string | null;
    heroTitle: string | null;
    heroDetail: string | null;
    overnightName: string | null;
    overnightKind: string | null;
    cutIfBehind: string | null;
    note: string | null;
    blocks: Array<{ part: string; title: string; detail: string }>;
  } | null;
  anchors: Array<{
    title: string;
    kind: string;
    placeName: string | null;
    startDate: string;
    endDate: string | null;
    note: string | null;
  }>;
  pois: CastContextPoi[];
  /**
   * Provenance-tracked corridor research from an OODA thread (latest brief
   * for this segment). Verified facts may be narrated with soft attribution;
   * unverified ones stay hedged. Null when no research has been pushed.
   */
  grounding: {
    title: string;
    facts: CastGroundingFact[];
  } | null;
};

/** Keep the prompt payload bounded even if a huge brief is pushed. */
const GROUNDING_FACT_LIMIT = 40;

/**
 * "Tomorrow" as a YYYY-MM-DD calendar date in the trip's timezone. The night-
 * before tap targets the NEXT day in the tz the traveler is actually living
 * in — a UTC-defaulted trip row makes this visibly wrong on the button, which
 * is the tripwire for the tz misconfiguration (eng-review Issue 9.8).
 */
export function resolveCastTargetDate(tz: string, now: Date): string {
  // Advance today-in-tz by one calendar day in UTC space (calendar
  // arithmetic — DST shifts can't skew a date+24h by a whole day).
  return addDays(castTodayInTz(tz, now), 1);
}

/** Today's YYYY-MM-DD calendar date in the trip's timezone. */
export function castTodayInTz(tz: string, now: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Drive-leg resolution precedence (eng-review Issue 9.12) — the ONE copy both
 * the cheap probe and the full context pack use:
 * 1. A trip_day row that links a segment IS the drive leg.
 * 2. A trip_day row with a non-driving intent and no segment link means no
 *    drive leg — a multi-day segment spanning a play day must not claim it.
 * 3. No trip_day row: fall back to a segment whose date range covers the day.
 */
async function resolveDriveLegSegment(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  input: {
    tripId: string;
    targetDate: string;
    day: { intent: string; segmentId: string | null } | null;
  },
): Promise<SegmentRow | null> {
  if (input.day?.segmentId) {
    return findSegmentById(db, input.day.segmentId);
  }
  if (
    !input.day ||
    input.day.intent === "drive" ||
    input.day.intent === "position"
  ) {
    return findSegmentByDate(db, input.tripId, input.targetDate);
  }
  return null;
}

/**
 * Cheap drive-leg probe for button rendering and server-side enqueue
 * validation — same resolution precedence as the full context pack, without
 * the corridor POI queries.
 */
export async function probeCastDriveLeg(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  input: { tripId: string; targetDate: string },
): Promise<{ hasDriveLeg: boolean; degraded: boolean }> {
  const [day] = (await db
    .select({
      intent: tripDays.intent,
      segmentId: tripDays.segmentId,
    })
    .from(tripDays)
    .where(
      and(
        eq(tripDays.tripId, input.tripId),
        eq(tripDays.date, input.targetDate),
      ),
    )
    .limit(1)) as Array<{ intent: string; segmentId: string | null }>;

  const segmentRow = await resolveDriveLegSegment(db, {
    tripId: input.tripId,
    targetDate: input.targetDate,
    day: day ?? null,
  });

  return {
    hasDriveLeg: segmentRow != null,
    degraded: segmentRow != null && !segmentRow.routePolyline,
  };
}

export async function buildCastDayContext(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  input: { tripId: string; targetDate: string },
): Promise<CastDayContext> {
  const [trip] = (await db
    .select({
      name: trips.name,
      tz: trips.tz,
      workspaceId: trips.workspaceId,
    })
    .from(trips)
    .where(eq(trips.id, input.tripId))
    .limit(1)) as Array<{ name: string; tz: string; workspaceId: string }>;

  if (!trip) {
    throw new Error(`Trip not found: ${input.tripId}`);
  }

  const [day] = (await db
    .select()
    .from(tripDays)
    .where(
      and(
        eq(tripDays.tripId, input.tripId),
        eq(tripDays.date, input.targetDate),
      ),
    )
    .limit(1)) as Array<{
    intent: string;
    title: string | null;
    heroTitle: string | null;
    heroDetail: string | null;
    overnightName: string | null;
    overnightKind: string | null;
    cutIfBehind: string | null;
    note: string | null;
    blocksJson: Array<{ part: string; title: string; detail: string }> | null;
    segmentId: string | null;
  }>;

  const segmentRow = await resolveDriveLegSegment(db, {
    tripId: input.tripId,
    targetDate: input.targetDate,
    day: day ?? null,
  });

  const hasGeometry = !!segmentRow?.routePolyline;
  const hasDriveLeg = segmentRow != null;

  const anchors = (await db
    .select({
      title: tripAnchors.title,
      kind: tripAnchors.kind,
      placeName: tripAnchors.placeName,
      startDate: tripAnchors.startDate,
      endDate: tripAnchors.endDate,
      note: tripAnchors.note,
    })
    .from(tripAnchors)
    .where(
      and(
        eq(tripAnchors.tripId, input.tripId),
        lte(tripAnchors.startDate, addDays(input.targetDate, 3)),
        or(
          gte(tripAnchors.startDate, input.targetDate),
          gte(tripAnchors.endDate, input.targetDate),
        ),
      ),
    )
    .orderBy(asc(tripAnchors.startDate))
    .limit(6)) as CastDayContext["anchors"];

  const pois =
    hasDriveLeg && hasGeometry && segmentRow
      ? await collectCorridorPois(db, trip.workspaceId, segmentRow)
      : [];

  const grounding = segmentRow
    ? await loadGroundingBrief(db, input.tripId, segmentRow.id)
    : null;

  return {
    tripName: trip.name,
    tz: trip.tz,
    targetDate: input.targetDate,
    hasDriveLeg,
    degraded: hasDriveLeg && !hasGeometry,
    segment: segmentRow
      ? {
          name: segmentRow.name,
          originName: segmentRow.originName,
          destinationName: segmentRow.destinationName,
          distanceMiles: segmentRow.distanceMiles
            ? Number(segmentRow.distanceMiles)
            : null,
          durationMinutes: segmentRow.durationMinutes,
          hasGeometry,
        }
      : null,
    day: day
      ? {
          intent: day.intent,
          title: day.title,
          heroTitle: day.heroTitle,
          heroDetail: day.heroDetail,
          overnightName: day.overnightName,
          overnightKind: day.overnightKind,
          cutIfBehind: day.cutIfBehind,
          note: day.note,
          blocks: day.blocksJson ?? [],
        }
      : null,
    anchors,
    pois,
    grounding,
  };
}

async function loadGroundingBrief(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  tripId: string,
  segmentId: string,
): Promise<CastDayContext["grounding"]> {
  const [brief] = (await db
    .select({
      title: castGroundingBriefs.title,
      facts: castGroundingBriefs.facts,
    })
    .from(castGroundingBriefs)
    .where(
      and(
        eq(castGroundingBriefs.tripId, tripId),
        eq(castGroundingBriefs.segmentId, segmentId),
      ),
    )
    .orderBy(desc(castGroundingBriefs.createdAt))
    .limit(1)) as Array<{ title: string; facts: CastGroundingFact[] }>;

  if (!brief) return null;
  return {
    title: brief.title,
    facts: brief.facts.slice(0, GROUNDING_FACT_LIMIT),
  };
}

type SegmentRow = {
  id: string;
  name: string;
  originName: string | null;
  destinationName: string | null;
  routePolyline: string | null;
  distanceMiles: string | null;
  durationMinutes: number | null;
};

const segmentColumns = {
  id: tripSegments.id,
  name: tripSegments.name,
  originName: tripSegments.originName,
  destinationName: tripSegments.destinationName,
  routePolyline: tripSegments.routePolyline,
  distanceMiles: tripSegments.distanceMiles,
  durationMinutes: tripSegments.durationMinutes,
};

// biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
async function findSegmentById(
  db: any,
  id: string,
): Promise<SegmentRow | null> {
  const [row] = (await db
    .select(segmentColumns)
    .from(tripSegments)
    .where(eq(tripSegments.id, id))
    .limit(1)) as SegmentRow[];
  return row ?? null;
}

async function findSegmentByDate(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  tripId: string,
  date: string,
): Promise<SegmentRow | null> {
  const [row] = (await db
    .select(segmentColumns)
    .from(tripSegments)
    .where(
      and(
        eq(tripSegments.tripId, tripId),
        lte(tripSegments.startDate, date),
        or(
          gte(tripSegments.endDate, date),
          and(isNull(tripSegments.endDate), eq(tripSegments.startDate, date)),
        ),
      ),
    )
    .orderBy(asc(tripSegments.sortOrder))
    .limit(1)) as SegmentRow[];
  return row ?? null;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

async function collectCorridorPois(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  workspaceId: string,
  segment: SegmentRow & { routePolyline: string | null },
): Promise<CastContextPoi[]> {
  if (!segment.routePolyline) return [];

  let points: Array<[number, number]>;
  try {
    points = decode(segment.routePolyline, 5);
  } catch {
    return [];
  }
  if (points.length === 0) return [];

  const fractions = [0, 0.25, 0.5, 0.75, 1];
  const samples = fractions.map((f) => {
    const idx = Math.min(
      points.length - 1,
      Math.round(f * (points.length - 1)),
    );
    const [lat, lng] = points[idx] as [number, number];
    return { fraction: f, lat, lng };
  });

  // One concurrent wave of bounding-box queries instead of 5 serial
  // Hyperdrive round-trips; ranking/dedupe stays ordered by route position.
  const sampleRows = await Promise.all(
    samples.map((sample) => {
      const latDelta = POI_SAMPLE_RADIUS_MILES * MILES_TO_DEGREES_LAT;
      const lngDelta = POI_SAMPLE_RADIUS_MILES * MILES_TO_DEGREES_LNG_AT_45;
      return db
        .select({
          id: importedPois.id,
          name: importedPois.name,
          category: importedPois.category,
          lat: importedPois.lat,
          lng: importedPois.lng,
          source: importedPois.source,
        })
        .from(importedPois)
        .where(
          and(
            gte(importedPois.lat, (sample.lat - latDelta).toString()),
            lte(importedPois.lat, (sample.lat + latDelta).toString()),
            gte(importedPois.lng, (sample.lng - lngDelta).toString()),
            lte(importedPois.lng, (sample.lng + lngDelta).toString()),
            // Shared (OSM) POIs OR this workspace's private uploads — never
            // another workspace's non-redistributable data.
            or(
              isNull(importedPois.workspaceId),
              eq(importedPois.workspaceId, workspaceId),
            ),
          ),
        )
        .limit(200) as Promise<
        Array<{
          id: string;
          name: string;
          category: string;
          lat: string;
          lng: string;
          source: string;
        }>
      >;
    }),
  );

  const seen = new Set<string>();
  const out: CastContextPoi[] = [];

  for (const [i, sample] of samples.entries()) {
    const suggestable: SuggestablePoi[] = (sampleRows[i] ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      lat: Number(r.lat),
      lng: Number(r.lng),
      source: r.source,
    }));

    const ranked = rankPoisNear(
      { lat: sample.lat, lng: sample.lng },
      suggestable,
      { maxMiles: POI_SAMPLE_RADIUS_MILES, limit: POI_PER_SAMPLE },
    );

    for (const poi of ranked) {
      if (seen.has(poi.id)) continue;
      seen.add(poi.id);
      out.push({
        name: poi.name,
        category: poi.category,
        milesAway: Math.round(poi.milesAway * 10) / 10,
        routeFraction: sample.fraction,
      });
      if (out.length >= POI_TOTAL_LIMIT) return out;
    }
  }

  return out;
}
