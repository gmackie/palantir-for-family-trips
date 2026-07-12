/**
 * Multi-day itinerary stops with real coordinates — dogfood templates that
 * match the Open Sauce 2026 road trip map (Cascades → coast → Bay → Yosemite
 * → Tahoe/Reno → Bryce → Moab).
 */

import type { DayIntent, OvernightKind } from "./day-plan";

export interface ItineraryStopDef {
  name: string;
  lat: number;
  lng: number;
  /** Overnight date YYYY-MM-DD (arrival day / sleep night). */
  date: string;
  intent: DayIntent;
  /** Extra stay nights after the arrival date (0 = one night only). */
  extraNights?: number;
  heroTitle?: string;
  heroDetail?: string;
  cutIfBehind?: string;
  overnightKind?: OvernightKind;
  /** Also create a trip_anchor. */
  anchor?: {
    title: string;
    kind: "event" | "reservation" | "lodging" | "must_see";
    endDate?: string;
  };
  /** Stay put — no drive leg into this stop (first stop / current position). */
  isOrigin?: boolean;
}

/** Full map arc: Mt Hood area → Moab (as drawn on the trip map). */
export function openSauceFullStops(): ItineraryStopDef[] {
  return [
    {
      name: "Mt Hood / Zigzag",
      lat: 45.342,
      lng: -121.943,
      date: "2026-07-09",
      intent: "drive",
      isOrigin: true,
      overnightKind: "campground",
      heroTitle: "West Hood base",
      heroDetail: "Zigzag Mountain Farm",
    },
    {
      name: "Bend",
      lat: 44.058,
      lng: -121.315,
      date: "2026-07-10",
      intent: "drive",
      extraNights: 1, // Jul 10 arrive + Jul 11 play
      overnightKind: "unknown",
      heroTitle: "Deschutes / Smith Rock",
      heroDetail: "Jul 11 play: Smith Rock AM; Cascade Lakes or Newberry PM",
      cutIfBehind: "One hero only — rock or lakes",
    },
    {
      name: "Crater Lake",
      lat: 42.944,
      lng: -122.109,
      date: "2026-07-12",
      intent: "drive",
      overnightKind: "campground",
      heroTitle: "Rim Drive",
      heroDetail: "Short walks; Cleetwood only if fresh",
      cutIfBehind: "Overlook pass only",
      anchor: { title: "Crater Lake", kind: "must_see" },
    },
    {
      name: "Port Orford",
      lat: 42.746,
      lng: -124.497,
      date: "2026-07-13",
      intent: "drive",
      overnightKind: "unknown",
      heroTitle: "Oregon coast landfall",
      heroDetail: "Port Orford Heads or Cape Blanco",
      cutIfBehind: "Beach sunset only",
    },
    {
      name: "Redwoods / Crescent City",
      lat: 41.756,
      lng: -124.202,
      date: "2026-07-14",
      intent: "play",
      overnightKind: "dispersed",
      heroTitle: "One grove hike",
      heroDetail: "Jedediah Smith / Stout Grove or Prairie Creek — pick one",
      cutIfBehind: "Viewpoint drive-through",
      anchor: { title: "Redwoods", kind: "must_see" },
    },
    {
      name: "North Bay staging",
      lat: 38.440,
      lng: -122.714,
      date: "2026-07-15",
      intent: "position",
      overnightKind: "unknown",
      heroTitle: "Avenue of the Giants → stage",
      heroDetail: "Petaluma / Santa Rosa — not late into SF",
      cutIfBehind: "Pure 101 south",
    },
    {
      name: "San Mateo",
      lat: 37.547,
      lng: -122.315,
      date: "2026-07-16",
      intent: "position",
      extraNights: 3, // 16 buffer + 17–19 Open Sauce
      overnightKind: "hotel",
      heroTitle: "Open Sauce buffer + festival",
      heroDetail: "Jul 16 restock; Jul 17–19 San Mateo County Event Center",
      anchor: {
        title: "Open Sauce",
        kind: "event",
        endDate: "2026-07-19",
      },
    },
    {
      name: "Yosemite Valley area",
      lat: 37.746,
      lng: -119.594,
      date: "2026-07-20",
      intent: "play",
      extraNights: 2, // 20–22 park days; 23 Ahwahnee is separate stay intent
      overnightKind: "dispersed",
      heroTitle: "Valley + Tioga",
      heroDetail:
        "Mon Valley intro; Tue Mist Trail; Wed Tioga/Tuolumne — one hero/day",
      cutIfBehind: "Tunnel View + one short walk only",
      anchor: { title: "Yosemite park days", kind: "must_see", endDate: "2026-07-22" },
    },
    {
      name: "Ahwahnee / Yosemite Valley",
      lat: 37.746,
      lng: -119.574,
      date: "2026-07-23",
      intent: "recovery",
      overnightKind: "hotel",
      heroTitle: "Valley dusk + dawn",
      heroDetail: "Hotel night; light Valley only — hero hikes already done",
      anchor: {
        title: "Ahwahnee",
        kind: "lodging",
        endDate: "2026-07-23",
      },
    },
    {
      name: "Reno / Tahoe approach",
      lat: 39.530,
      lng: -119.814,
      date: "2026-07-24",
      intent: "drive",
      overnightKind: "unknown",
      heroTitle: "Tioga → 395 → Reno",
      heroDetail: "Exit high Sierra east; optional Tahoe dip",
      cutIfBehind: "Straight to Reno",
    },
    {
      name: "Eastern Nevada",
      lat: 39.250,
      lng: -114.880,
      date: "2026-07-25",
      intent: "drive",
      overnightKind: "unknown",
      heroTitle: "Basin & Range transit",
      heroDetail: "US-50 / I-80 corridor night — keep drive sane",
      cutIfBehind: "Long I-80 day",
    },
    {
      name: "Bryce Canyon area",
      lat: 37.628,
      lng: -112.168,
      date: "2026-07-26",
      intent: "drive",
      extraNights: 1, // 26 arrive + 27 play
      overnightKind: "campground",
      heroTitle: "Bryce amphitheater",
      heroDetail: "Jul 27: Navajo / Queen's Garden or rim — one hero",
      cutIfBehind: "Sunrise Point overlook only",
      anchor: { title: "Bryce Canyon", kind: "must_see", endDate: "2026-07-27" },
    },
    {
      name: "Moab",
      lat: 38.573,
      lng: -109.550,
      date: "2026-07-28",
      intent: "play",
      extraNights: 1,
      overnightKind: "unknown",
      heroTitle: "Moab base",
      heroDetail: "Arches or trail day; trip end buffer",
      cutIfBehind: "Town only",
      anchor: { title: "Moab", kind: "must_see", endDate: "2026-07-29" },
    },
  ];
}

/** Expand stay (date + extraNights) into one calendar day per night. */
export function expandStopDays(stop: ItineraryStopDef): Array<{
  date: string;
  intent: DayIntent;
  title: string;
  overnightName: string;
  overnightKind: OvernightKind | null;
  heroTitle: string | null;
  heroDetail: string | null;
  cutIfBehind: string | null;
  lat: number;
  lng: number;
}> {
  const nights = 1 + (stop.extraNights ?? 0);
  const out: Array<{
    date: string;
    intent: DayIntent;
    title: string;
    overnightName: string;
    overnightKind: OvernightKind | null;
    heroTitle: string | null;
    heroDetail: string | null;
    cutIfBehind: string | null;
    lat: number;
    lng: number;
  }> = [];

  let t = Date.parse(`${stop.date}T12:00:00Z`);
  for (let i = 0; i < nights; i++) {
    const date = new Date(t).toISOString().slice(0, 10);
    let intent = stop.intent;
    // Multi-night San Mateo: buffer day then event days
    if (stop.name === "San Mateo") {
      if (date === "2026-07-16") intent = "position";
      else if (date >= "2026-07-17" && date <= "2026-07-19") intent = "event";
    }
    // Yosemite park block: all play
    if (stop.name === "Yosemite Valley area") intent = "play";
    // Bend: first night drive-in, second play
    if (stop.name === "Bend") {
      intent = i === 0 ? "drive" : "play";
    }
    // Bryce: first drive-in, second play
    if (stop.name === "Bryce Canyon area") {
      intent = i === 0 ? "drive" : "play";
    }

    out.push({
      date,
      intent,
      title: stop.name,
      overnightName: stop.name,
      overnightKind: stop.overnightKind ?? null,
      heroTitle: i === 0 || intent === "play" || intent === "event"
        ? (stop.heroTitle ?? null)
        : null,
      heroDetail: stop.heroDetail ?? null,
      cutIfBehind: stop.cutIfBehind ?? null,
      lat: stop.lat,
      lng: stop.lng,
    });
    t += 86_400_000;
  }
  return out;
}

function lastNightOf(stop: ItineraryStopDef): string {
  const nights = 1 + (stop.extraNights ?? 0);
  const t =
    Date.parse(`${stop.date}T12:00:00Z`) + (nights - 1) * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function nightsBetween(fromDate: string, toDate: string): number {
  const a = Date.parse(`${fromDate}T12:00:00Z`);
  const b = Date.parse(`${toDate}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Slice a full template to only the remaining trip from `fromDate` (inclusive).
 * Multi-night stays that already started are clamped so their first planned
 * night is `fromDate`. The first remaining stop is marked `isOrigin` so we
 * don't invent a drive leg into "where you already are."
 */
export function remainingStopsFromDate(
  stops: ItineraryStopDef[],
  fromDate: string,
): ItineraryStopDef[] {
  const out: ItineraryStopDef[] = [];
  for (const stop of stops) {
    const last = lastNightOf(stop);
    if (last < fromDate) continue;

    if (stop.date >= fromDate) {
      out.push({ ...stop, isOrigin: out.length === 0 ? true : stop.isOrigin });
      continue;
    }

    // Stay already started: clamp to remaining nights from fromDate.
    const remainingNights = nightsBetween(fromDate, last) + 1;
    out.push({
      ...stop,
      date: fromDate,
      extraNights: Math.max(0, remainingNights - 1),
      isOrigin: true,
      // Still here — no fresh drive-in hero unless play/event day.
      intent: stop.intent === "drive" ? "play" : stop.intent,
    });
  }
  if (out.length > 0) {
    out[0] = { ...out[0]!, isOrigin: true };
    for (let i = 1; i < out.length; i++) {
      out[i] = { ...out[i]!, isOrigin: false };
    }
  }
  return out;
}

/** Approx great-circle miles (template helper; fine for 15mi "near" checks). */
function approxMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 3959;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinLng *
      sinLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export interface LiveOrigin {
  lat: number;
  lng: number;
  name?: string;
}

/**
 * Anchor remaining stops on live GPS. If you're within `nearMiles` of the
 * first remaining overnight, update its coords (you're "there"). Otherwise
 * prepend a synthetic origin so the next leg routes from GPS → first stop.
 */
export function injectLiveOrigin(
  stops: ItineraryStopDef[],
  origin: LiveOrigin,
  fromDate: string,
  nearMiles = 20,
): ItineraryStopDef[] {
  if (stops.length === 0) return stops;

  const rest = stops.map((s, i) => ({
    ...s,
    isOrigin: false,
  }));
  const first = rest[0]!;
  const dist = approxMiles(origin, first);

  if (dist <= nearMiles) {
    // Already at / near the planned overnight.
    return [
      {
        ...first,
        lat: origin.lat,
        lng: origin.lng,
        isOrigin: true,
        date: first.date < fromDate ? fromDate : first.date,
      },
      ...rest.slice(1),
    ];
  }

  // En route — drive from GPS to the next planned stop.
  const live: ItineraryStopDef = {
    name: origin.name?.trim() || "Current location",
    lat: origin.lat,
    lng: origin.lng,
    date: fromDate,
    intent: "drive",
    isOrigin: true,
    overnightKind: "unknown",
    heroTitle: "Live position",
    heroDetail: "Replanned from GPS",
  };
  return [live, ...rest];
}

/** Ordered drive legs: from stop[i] → stop[i+1] when not origin-only. */
export function itineraryLegs(stops: ItineraryStopDef[]): Array<{
  from: ItineraryStopDef;
  to: ItineraryStopDef;
  /** Date of the driving day (arrival date at `to`). */
  driveDate: string;
}> {
  const legs: Array<{
    from: ItineraryStopDef;
    to: ItineraryStopDef;
    driveDate: string;
  }> = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const from = stops[i]!;
    const to = stops[i + 1]!;
    if (to.isOrigin) continue;
    // Same coords (Ahwahnee after Valley): still a "leg" of 0 — skip routing later
    legs.push({ from, to, driveDate: to.date });
  }
  return legs;
}
