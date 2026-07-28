/**
 * Apply a multi-stop itinerary: route legs, write segments + trip days + anchors.
 */

import * as polylineCodec from "@googlemaps/polyline-codec";

// Dual CJS/ESM interop (vinext named export + tsx/node default).
const encode: (path: Array<[number, number]>, precision?: number) => string =
  // biome-ignore lint/suspicious/noExplicitAny: dual package shape
  (polylineCodec as any).encode ??
  // biome-ignore lint/suspicious/noExplicitAny: dual package shape
  (polylineCodec as any).default?.encode;

import { and, asc, eq, gte, isNull, lt, or } from "@sortey/db";
import { tripAnchors, tripDays, tripSegments, trips } from "@sortey/db/schema";

import { haversineMiles } from "../trips/driving-summary";
import { createAnchor, listAnchors } from "./anchor-ops";
import type { DayPlanDraft } from "./day-plan";
import { applyDraft, listDays } from "./day-plan-ops";
import {
  expandStopDays,
  type ItineraryStopDef,
  injectLiveOrigin,
  itineraryLegs,
  type LiveOrigin,
  openSauceFullStops,
  remainingStopsFromDate,
} from "./itinerary-template";
import { autoAssignOvernightsForTrip } from "./poi-suggest-ops";
import { routeLeg } from "./routing";

export type ItineraryTemplateId = "open_sauce_full";

export function resolveTemplate(id: ItineraryTemplateId): ItineraryStopDef[] {
  if (id === "open_sauce_full") return openSauceFullStops();
  return openSauceFullStops();
}

function straightLeg(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): { miles: number; minutes: number; polyline: string } {
  const miles = Math.round(haversineMiles(a, b) * 10) / 10;
  const minutes = Math.max(15, Math.round((miles / 45) * 60));
  // Encode a straight line so the map always has a path (fallback when Routes API is down).
  const polyline = encode(
    [
      [a.lat, a.lng],
      [b.lat, b.lng],
    ],
    5,
  );
  return { miles, minutes, polyline };
}

export async function planItineraryOp(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  p: {
    tripId: string;
    workspaceId?: string;
    stops: ItineraryStopDef[];
    replaceExisting?: boolean;
    /**
     * When set, only rewrite days/segments/anchors on or after this date.
     * Past days stay put (replan-from-today).
     */
    fromDate?: string;
    /** Live GPS — anchors the next leg at your real position. */
    origin?: LiveOrigin;
    /**
     * After writing days, pick best iOverlander sleep POI per night
     * (skips hotel nights). Requires workspaceId.
     */
    autoAssignOvernights?: boolean;
  },
): Promise<{
  segmentCount: number;
  dayCount: number;
  anchorCount: number;
  totalMiles: number;
  routedLegs: number;
  fallbackLegs: number;
  keptPastDays: number;
  usedLiveOrigin: boolean;
  overnightsAssigned: number;
}> {
  let stops = p.stops;
  const fromDate = p.fromDate;
  if (fromDate) {
    stops = remainingStopsFromDate(stops, fromDate);
  }
  let usedLiveOrigin = false;
  if (p.origin && fromDate) {
    stops = injectLiveOrigin(stops, p.origin, fromDate);
    usedLiveOrigin = true;
  } else if (p.origin && !fromDate) {
    // Full rebuild from GPS: treat today as fromDate for origin injection only
    // on the first stop of the full template.
    const today = new Date().toISOString().slice(0, 10);
    stops = injectLiveOrigin(stops, p.origin, today);
    usedLiveOrigin = true;
  }

  if (stops.length < 1) {
    return {
      segmentCount: 0,
      dayCount: 0,
      anchorCount: 0,
      totalMiles: 0,
      routedLegs: 0,
      fallbackLegs: 0,
      keptPastDays: 0,
      usedLiveOrigin: false,
      overnightsAssigned: 0,
    };
  }

  let keptPastDays = 0;
  if (p.replaceExisting !== false) {
    if (fromDate) {
      const past = (await db
        .select({ id: tripDays.id })
        .from(tripDays)
        .where(
          and(eq(tripDays.tripId, p.tripId), lt(tripDays.date, fromDate)),
        )) as Array<{ id: string }>;
      keptPastDays = past.length;

      await db
        .delete(tripDays)
        .where(
          and(eq(tripDays.tripId, p.tripId), gte(tripDays.date, fromDate)),
        );
      // Drop future + undated segments; keep past dated legs.
      await db
        .delete(tripSegments)
        .where(
          and(
            eq(tripSegments.tripId, p.tripId),
            or(
              isNull(tripSegments.startDate),
              gte(tripSegments.startDate, fromDate),
            ),
          ),
        );
      await db
        .delete(tripAnchors)
        .where(
          and(
            eq(tripAnchors.tripId, p.tripId),
            gte(tripAnchors.startDate, fromDate),
          ),
        );
    } else {
      await db.delete(tripSegments).where(eq(tripSegments.tripId, p.tripId));
      await db.delete(tripDays).where(eq(tripDays.tripId, p.tripId));
      await db.delete(tripAnchors).where(eq(tripAnchors.tripId, p.tripId));
    }
  }

  const last = stops[stops.length - 1]!;
  const lastDays = expandStopDays(last);
  const tripPatch: Record<string, unknown> = {
    destinationName: last.name,
    destinationLat: last.lat.toString(),
    destinationLng: last.lng.toString(),
    endDate: lastDays[lastDays.length - 1]?.date ?? last.date,
  };
  // Only set trip startDate on a full rebuild so replan-from-today keeps history.
  if (!fromDate) {
    tripPatch.startDate = stops[0]!.date;
  }
  await db.update(trips).set(tripPatch).where(eq(trips.id, p.tripId));

  const legs = itineraryLegs(stops);
  let sortOrder = 0;
  if (fromDate) {
    const existingSegs = (await db
      .select({ sortOrder: tripSegments.sortOrder })
      .from(tripSegments)
      .where(eq(tripSegments.tripId, p.tripId))) as Array<{
      sortOrder: number;
    }>;
    sortOrder = existingSegs.reduce((m, s) => Math.max(m, s.sortOrder), -1) + 1;
  }
  let totalMiles = 0;
  let routedLegs = 0;
  let fallbackLegs = 0;
  let segmentCount = 0;

  for (const leg of legs) {
    const dist = Math.hypot(
      leg.from.lat - leg.to.lat,
      leg.from.lng - leg.to.lng,
    );
    if (dist < 0.02) continue;

    const routed = await routeLeg(
      { lat: leg.from.lat, lng: leg.from.lng },
      { lat: leg.to.lat, lng: leg.to.lng },
    );
    const stats = routed
      ? {
          miles: routed.miles,
          minutes: routed.minutes,
          polyline: routed.polyline,
        }
      : straightLeg(leg.from, leg.to);

    if (routed) routedLegs++;
    else fallbackLegs++;
    totalMiles += stats.miles;

    await db.insert(tripSegments).values({
      tripId: p.tripId,
      name: `${leg.from.name} → ${leg.to.name}`,
      originName: leg.from.name,
      originLat: leg.from.lat.toString(),
      originLng: leg.from.lng.toString(),
      destinationName: leg.to.name,
      destinationLat: leg.to.lat.toString(),
      destinationLng: leg.to.lng.toString(),
      routePolyline: stats.polyline,
      distanceMiles: stats.miles.toString(),
      durationMinutes: stats.minutes,
      startDate: leg.driveDate,
      endDate: leg.driveDate,
      tz: "America/Los_Angeles",
      sortOrder: sortOrder++,
    });
    segmentCount++;
  }

  const dayDrafts: DayPlanDraft[] = [];
  const dayCoords = new Map<string, { lat: number; lng: number }>();
  for (const stop of stops) {
    // Synthetic GPS origin is routing-only — don't add a "Current location" day.
    if (stop.heroTitle === "Live position") continue;
    for (const d of expandStopDays(stop)) {
      const blocks =
        d.heroTitle != null
          ? [
              {
                part: "morning" as const,
                title:
                  d.intent === "drive"
                    ? `Drive · ${d.title}`
                    : `★ ${d.heroTitle}`,
                detail:
                  d.intent === "drive"
                    ? (d.heroDetail ??
                      "Bank daylight; optional stops if ahead.")
                    : (d.heroDetail ?? "One hero effort today."),
              },
              {
                part: "evening" as const,
                title: `Overnight · ${d.overnightName ?? d.title}`,
                detail: d.cutIfBehind
                  ? `Cut if behind: ${d.cutIfBehind}`
                  : "Settle before dark.",
              },
            ]
          : [];
      dayDrafts.push({
        date: d.date,
        intent: d.intent,
        title: d.title,
        overnightName: d.overnightName,
        overnightKind: d.overnightKind,
        heroTitle: d.heroTitle,
        heroDetail: d.heroDetail,
        cutIfBehind: d.cutIfBehind,
        blocks,
        note: null,
      });
      dayCoords.set(d.date, { lat: d.lat, lng: d.lng });
    }
  }
  const byDate = new Map<string, DayPlanDraft>();
  for (const d of dayDrafts) byDate.set(d.date, d);
  const uniqueDays = [...byDate.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  await applyDraft(db, { tripId: p.tripId, days: uniqueDays });

  for (const [date, coords] of dayCoords) {
    await db
      .update(tripDays)
      .set({
        overnightLat: coords.lat.toString(),
        overnightLng: coords.lng.toString(),
      })
      .where(and(eq(tripDays.tripId, p.tripId), eq(tripDays.date, date)));
  }

  let anchorCount = 0;
  for (const stop of stops) {
    if (!stop.anchor) continue;
    await createAnchor(db, {
      tripId: p.tripId,
      title: stop.anchor.title,
      kind: stop.anchor.kind,
      placeName: stop.name,
      lat: stop.lat,
      lng: stop.lng,
      startDate: stop.date,
      endDate: stop.anchor.endDate ?? null,
    });
    anchorCount++;
  }

  let overnightsAssigned = 0;
  if (p.autoAssignOvernights !== false && p.workspaceId) {
    const result = await autoAssignOvernightsForTrip(db, {
      tripId: p.tripId,
      workspaceId: p.workspaceId,
      maxMiles: 20,
      skipHotels: true,
    });
    overnightsAssigned = result.assigned;
  }

  return {
    segmentCount,
    dayCount: uniqueDays.length + keptPastDays,
    anchorCount,
    totalMiles: Math.round(totalMiles * 10) / 10,
    routedLegs,
    fallbackLegs,
    keptPastDays,
    usedLiveOrigin,
    overnightsAssigned,
  };
}

export async function getPlanMapOp(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  tripId: string,
) {
  const days = await listDays(db, tripId);
  const anchors = await listAnchors(db, tripId);
  const segs = (await db
    .select({
      id: tripSegments.id,
      startDate: tripSegments.startDate,
      routePolyline: tripSegments.routePolyline,
      distanceMiles: tripSegments.distanceMiles,
      originLat: tripSegments.originLat,
      originLng: tripSegments.originLng,
      originName: tripSegments.originName,
      destinationLat: tripSegments.destinationLat,
      destinationLng: tripSegments.destinationLng,
      destinationName: tripSegments.destinationName,
      sortOrder: tripSegments.sortOrder,
    })
    .from(tripSegments)
    .where(eq(tripSegments.tripId, tripId))
    .orderBy(asc(tripSegments.sortOrder))) as Array<{
    id: string;
    startDate: string | null;
    routePolyline: string | null;
    distanceMiles: string | null;
    originLat: string | null;
    originLng: string | null;
    originName: string | null;
    destinationLat: string | null;
    destinationLng: string | null;
    destinationName: string | null;
    sortOrder: number;
  }>;

  const markers: Array<{
    id: string;
    kind: "day" | "anchor" | "origin" | "destination";
    label: string;
    date: string | null;
    intent: string | null;
    lat: number;
    lng: number;
  }> = [];

  const seenPlaces = new Set<string>();
  for (const d of days) {
    if (d.overnightLat == null || d.overnightLng == null) continue;
    const key = `${d.overnightName ?? d.title ?? d.date}`;
    if (seenPlaces.has(key)) continue;
    seenPlaces.add(key);
    markers.push({
      id: `day-${d.id}`,
      kind: "day",
      label: d.title ?? d.overnightName ?? d.date,
      date: d.date,
      intent: d.intent,
      lat: Number(d.overnightLat),
      lng: Number(d.overnightLng),
    });
  }

  for (const a of anchors) {
    if (a.lat == null || a.lng == null) continue;
    markers.push({
      id: `anchor-${String(a.id)}`,
      kind: "anchor",
      label: String(a.title),
      date: String(a.startDate),
      intent: null,
      lat: Number(a.lat),
      lng: Number(a.lng),
    });
  }

  if (segs[0]?.originLat && segs[0]?.originLng) {
    markers.push({
      id: "origin",
      kind: "origin",
      label: segs[0].originName ?? "Start",
      date: null,
      intent: null,
      lat: Number(segs[0].originLat),
      lng: Number(segs[0].originLng),
    });
  }
  const lastSeg = segs[segs.length - 1];
  if (lastSeg?.destinationLat && lastSeg?.destinationLng) {
    markers.push({
      id: "destination",
      kind: "destination",
      label: lastSeg.destinationName ?? "End",
      date: null,
      intent: null,
      lat: Number(lastSeg.destinationLat),
      lng: Number(lastSeg.destinationLng),
    });
  }

  const totalMiles = segs.reduce(
    (s, g) => s + (g.distanceMiles ? Number(g.distanceMiles) : 0),
    0,
  );

  const legs = segs
    .filter((s) => s.startDate && s.routePolyline)
    .map((s) => ({
      segmentId: s.id,
      date: s.startDate!,
      polyline: s.routePolyline!,
      originLat: s.originLat != null ? Number(s.originLat) : null,
      originLng: s.originLng != null ? Number(s.originLng) : null,
      destLat: s.destinationLat != null ? Number(s.destinationLat) : null,
      destLng: s.destinationLng != null ? Number(s.destinationLng) : null,
      name: `${s.originName ?? "?"} → ${s.destinationName ?? "?"}`,
      distanceMiles: s.distanceMiles ? Number(s.distanceMiles) : 0,
    }));

  return {
    markers,
    days: days.map((d) => ({
      id: d.id,
      date: d.date,
      intent: d.intent,
      title: d.title,
      overnightName: d.overnightName,
      heroTitle: d.heroTitle,
      heroDetail: d.heroDetail,
      cutIfBehind: d.cutIfBehind,
      lat: d.overnightLat != null ? Number(d.overnightLat) : null,
      lng: d.overnightLng != null ? Number(d.overnightLng) : null,
    })),
    legs,
    segmentCount: segs.length,
    totalMiles: Math.round(totalMiles * 10) / 10,
  };
}
