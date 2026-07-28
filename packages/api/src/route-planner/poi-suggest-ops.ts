/**
 * DB-backed POI suggestions for trip days (iOverlander overnight picks, amenity
 * strips along the route).
 */

import { and, eq, gte, inArray, isNull, lte, or } from "@sortey/db";
import { overnightKindFromCategory } from "@sortey/db/ioverlander";
import { importedPois } from "@sortey/db/schema";

import { haversineMiles } from "../trips/driving-summary";
import { listDays, upsertDay } from "./day-plan-ops";
import {
  type RankedPoi,
  rankPoisNear,
  type SuggestablePoi,
  suggestOvernightsAlongRoute,
} from "./poi-suggest";

const MILES_TO_DEGREES_LAT = 1 / 69;
const MILES_TO_DEGREES_LNG = 1 / 49;

export async function loadNearbyImportedPois(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  p: {
    workspaceId: string;
    centerLat: number;
    centerLng: number;
    radiusMiles: number;
    categories?: string[];
    limit?: number;
  },
): Promise<SuggestablePoi[]> {
  const latDelta = p.radiusMiles * MILES_TO_DEGREES_LAT;
  const lngDelta = p.radiusMiles * MILES_TO_DEGREES_LNG;
  const conditions = [
    gte(importedPois.lat, (p.centerLat - latDelta).toString()),
    lte(importedPois.lat, (p.centerLat + latDelta).toString()),
    gte(importedPois.lng, (p.centerLng - lngDelta).toString()),
    lte(importedPois.lng, (p.centerLng + lngDelta).toString()),
    or(
      isNull(importedPois.workspaceId),
      eq(importedPois.workspaceId, p.workspaceId),
    ),
  ];
  if (p.categories && p.categories.length > 0) {
    conditions.push(inArray(importedPois.category, p.categories));
  }

  const rows = (await db
    .select({
      id: importedPois.id,
      name: importedPois.name,
      category: importedPois.category,
      lat: importedPois.lat,
      lng: importedPois.lng,
      source: importedPois.source,
      data: importedPois.data,
    })
    .from(importedPois)
    .where(and(...conditions))
    .limit(p.limit ?? 500)) as Array<{
    id: string;
    name: string;
    category: string;
    lat: string;
    lng: string;
    source: string;
    data: unknown;
  }>;

  return rows.map((r) => {
    const data =
      r.data && typeof r.data === "object"
        ? (r.data as Record<string, unknown>)
        : {};
    const rating =
      typeof data.rating === "number"
        ? data.rating
        : typeof data.Rating === "number"
          ? data.Rating
          : null;
    const note =
      typeof data.description === "string"
        ? data.description.slice(0, 200)
        : typeof data.rawCategory === "string"
          ? data.rawCategory
          : null;
    return {
      id: r.id,
      name: r.name,
      category: r.category,
      lat: Number(r.lat),
      lng: Number(r.lng),
      source: r.source,
      rating,
      note,
    };
  });
}

export async function suggestOvernightsForDay(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  p: {
    tripId: string;
    workspaceId: string;
    date: string;
    maxMiles?: number;
    limit?: number;
  },
): Promise<{
  center: { lat: number; lng: number; name: string } | null;
  suggestions: RankedPoi[];
}> {
  const days = await listDays(db, p.tripId);
  const day = days.find((d) => d.date === p.date);
  if (!day) return { center: null, suggestions: [] };

  let lat = day.overnightLat != null ? Number(day.overnightLat) : Number.NaN;
  let lng = day.overnightLng != null ? Number(day.overnightLng) : Number.NaN;
  let name = day.overnightName ?? day.title ?? day.date;

  // Fall back to same-date segment destination if day has no coords yet.
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { center: null, suggestions: [] };
  }

  const maxMiles = p.maxMiles ?? 25;
  const pois = await loadNearbyImportedPois(db, {
    workspaceId: p.workspaceId,
    centerLat: lat,
    centerLng: lng,
    radiusMiles: maxMiles,
    categories: [
      "wild_camping",
      "campsite",
      "parking_overnight",
      "rest_area",
      "parking",
    ],
    limit: 400,
  });

  const suggestions = rankPoisNear({ lat, lng }, pois, {
    maxMiles,
    limit: p.limit ?? 15,
    preferSleep: true,
  });

  return {
    center: { lat, lng, name },
    suggestions,
  };
}

export async function suggestAmenitiesNearDay(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  p: {
    tripId: string;
    workspaceId: string;
    date: string;
    categories: string[];
    maxMiles?: number;
    limit?: number;
  },
): Promise<{
  center: { lat: number; lng: number; name: string } | null;
  suggestions: RankedPoi[];
}> {
  const days = await listDays(db, p.tripId);
  const day = days.find((d) => d.date === p.date);
  if (!day || day.overnightLat == null || day.overnightLng == null) {
    return { center: null, suggestions: [] };
  }
  const lat = Number(day.overnightLat);
  const lng = Number(day.overnightLng);
  const maxMiles = p.maxMiles ?? 20;
  const pois = await loadNearbyImportedPois(db, {
    workspaceId: p.workspaceId,
    centerLat: lat,
    centerLng: lng,
    radiusMiles: maxMiles,
    categories: p.categories,
    limit: 400,
  });
  return {
    center: {
      lat,
      lng,
      name: day.overnightName ?? day.title ?? day.date,
    },
    suggestions: rankPoisNear({ lat, lng }, pois, {
      maxMiles,
      limit: p.limit ?? 20,
    }),
  };
}

export async function suggestOvernightsForTrip(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  p: {
    tripId: string;
    workspaceId: string;
    maxMiles?: number;
    perDay?: number;
  },
) {
  const days = await listDays(db, p.tripId);
  const endpoints = days
    .filter((d) => d.overnightLat != null && d.overnightLng != null)
    .map((d) => ({
      date: d.date,
      name: d.overnightName ?? d.title ?? d.date,
      lat: Number(d.overnightLat),
      lng: Number(d.overnightLng),
    }));

  if (endpoints.length === 0) return [];

  // One bbox around all endpoints (padded) would be huge; load per endpoint.
  const out = [];
  for (const ep of endpoints) {
    const pois = await loadNearbyImportedPois(db, {
      workspaceId: p.workspaceId,
      centerLat: ep.lat,
      centerLng: ep.lng,
      radiusMiles: p.maxMiles ?? 25,
      categories: [
        "wild_camping",
        "campsite",
        "parking_overnight",
        "rest_area",
        "parking",
      ],
      limit: 300,
    });
    const ranked = suggestOvernightsAlongRoute([ep], pois, {
      maxMiles: p.maxMiles,
      perEndpoint: p.perDay ?? 5,
    })[0]!;
    out.push(ranked);
  }
  return out;
}

export async function applyOvernightFromPoi(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  p: {
    tripId: string;
    workspaceId: string;
    date: string;
    poiId: string;
  },
): Promise<{ ok: true; id: string }> {
  const [poi] = (await db
    .select({
      id: importedPois.id,
      name: importedPois.name,
      category: importedPois.category,
      lat: importedPois.lat,
      lng: importedPois.lng,
      source: importedPois.source,
      workspaceId: importedPois.workspaceId,
    })
    .from(importedPois)
    .where(eq(importedPois.id, p.poiId))
    .limit(1)) as Array<{
    id: string;
    name: string;
    category: string;
    lat: string;
    lng: string;
    source: string;
    workspaceId: string | null;
  }>;

  if (!poi) {
    throw new Error("POI not found");
  }
  if (poi.workspaceId != null && poi.workspaceId !== p.workspaceId) {
    throw new Error("POI not available for this workspace");
  }

  const days = await listDays(db, p.tripId);
  const day = days.find((d) => d.date === p.date);
  if (!day) {
    throw new Error("Trip day not found for date");
  }

  const kind = overnightKindFromCategory(poi.category);
  const result = await upsertDay(db, {
    tripId: p.tripId,
    date: p.date,
    intent: day.intent as "play" | "drive" | "position" | "event" | "recovery",
    title: day.title,
    overnightName: poi.name,
    overnightKind: kind,
    overnightLat: Number(poi.lat),
    overnightLng: Number(poi.lng),
    heroTitle: day.heroTitle,
    heroDetail: day.heroDetail,
    cutIfBehind: day.cutIfBehind,
    note: day.note
      ? `${day.note}\nSleep: ${poi.name} (${poi.category})`
      : `Sleep: ${poi.name} (${poi.category}) · ${poi.source}`,
    sortOrder: day.sortOrder,
  });

  return { ok: true, id: result.id };
}

/** Distance helper re-export for callers that already have coords. */
export function milesBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  return Math.round(haversineMiles(a, b) * 10) / 10;
}

/**
 * After a multi-day plan is written, pick the best nearby iOverlander sleep
 * POI for each night (skip hotel nights / already-applied sleeps).
 */
export async function autoAssignOvernightsForTrip(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  p: {
    tripId: string;
    workspaceId: string;
    maxMiles?: number;
    /** Skip days whose overnightKind is hotel (default true). */
    skipHotels?: boolean;
  },
): Promise<{ assigned: number; skipped: number; none: number }> {
  const days = await listDays(db, p.tripId);
  let assigned = 0;
  let skipped = 0;
  let none = 0;
  const maxMiles = p.maxMiles ?? 20;
  const skipHotels = p.skipHotels !== false;

  for (const day of days) {
    if (skipHotels && day.overnightKind === "hotel") {
      skipped++;
      continue;
    }
    if (day.note?.includes("Sleep:")) {
      skipped++;
      continue;
    }
    if (day.overnightLat == null || day.overnightLng == null) {
      none++;
      continue;
    }

    const { suggestions } = await suggestOvernightsForDay(db, {
      tripId: p.tripId,
      workspaceId: p.workspaceId,
      date: day.date,
      maxMiles,
      limit: 5,
    });
    const best = suggestions[0];
    if (!best || best.milesAway > maxMiles) {
      none++;
      continue;
    }

    await applyOvernightFromPoi(db, {
      tripId: p.tripId,
      workspaceId: p.workspaceId,
      date: day.date,
      poiId: best.id,
    });
    assigned++;
  }

  return { assigned, skipped, none };
}

export interface DayAmenityScan {
  date: string;
  placeName: string;
  lat: number;
  lng: number;
  overnight: RankedPoi | null;
  dump: RankedPoi | null;
  water: RankedPoi | null;
  fuel: RankedPoi | null;
  parking: RankedPoi | null;
  tolls: RankedPoi[];
  warnings: string[];
}

/** Per-day amenity density + warnings for long-term planning. */
export async function scanTripAmenities(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  p: {
    tripId: string;
    workspaceId: string;
    maxMiles?: number;
  },
): Promise<DayAmenityScan[]> {
  const days = await listDays(db, p.tripId);
  const maxMiles = p.maxMiles ?? 25;
  const out: DayAmenityScan[] = [];

  for (const day of days) {
    if (day.overnightLat == null || day.overnightLng == null) continue;
    const lat = Number(day.overnightLat);
    const lng = Number(day.overnightLng);
    const placeName = day.overnightName ?? day.title ?? day.date;

    const all = await loadNearbyImportedPois(db, {
      workspaceId: p.workspaceId,
      centerLat: lat,
      centerLng: lng,
      radiusMiles: maxMiles,
      categories: [
        "wild_camping",
        "campsite",
        "parking_overnight",
        "rest_area",
        "parking",
        "dump_station",
        "water",
        "fuel",
        "toll",
      ],
      limit: 400,
    });

    const center = { lat, lng };
    const sleep =
      rankPoisNear(center, all, {
        maxMiles,
        limit: 1,
        preferSleep: true,
        categories: [
          "wild_camping",
          "campsite",
          "parking_overnight",
          "rest_area",
        ],
      })[0] ?? null;
    const dump =
      rankPoisNear(center, all, {
        maxMiles: 30,
        limit: 1,
        categories: ["dump_station"],
      })[0] ?? null;
    const water =
      rankPoisNear(center, all, {
        maxMiles: 20,
        limit: 1,
        categories: ["water"],
      })[0] ?? null;
    const fuel =
      rankPoisNear(center, all, {
        maxMiles: 25,
        limit: 1,
        categories: ["fuel"],
      })[0] ?? null;
    const parking =
      rankPoisNear(center, all, {
        maxMiles: 15,
        limit: 1,
        categories: ["parking", "parking_overnight", "rest_area"],
      })[0] ?? null;
    const tolls = rankPoisNear(center, all, {
      maxMiles: 40,
      limit: 5,
      categories: ["toll"],
    });

    const warnings: string[] = [];
    if (!sleep) warnings.push("No sleep POI within range");
    else if (sleep.milesAway > 15)
      warnings.push(`Nearest sleep ${sleep.milesAway} mi out`);
    if (day.intent === "drive" || day.intent === "position") {
      if (!fuel) warnings.push("No fuel POI nearby");
      if (tolls.length > 0)
        warnings.push(
          `${tolls.length} toll area(s) within ~40 mi of overnight`,
        );
    }
    if (!dump && day.intent !== "event")
      warnings.push("No dump station nearby");
    if (!water && day.intent === "play")
      warnings.push("No water fill nearby (play day)");

    out.push({
      date: day.date,
      placeName,
      lat,
      lng,
      overnight: sleep,
      dump,
      water,
      fuel,
      parking,
      tolls,
      warnings,
    });
  }

  return out;
}
