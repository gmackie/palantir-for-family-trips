/**
 * Rank imported POIs (iOverlander etc.) near overnight endpoints or along a
 * corridor for long-term van planning — sleep, parking, dump, water, fuel, tolls.
 */

export interface SuggestablePoi {
  id: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  source: string;
  /** Optional free-text / rating from import data */
  note?: string | null;
  rating?: number | null;
}

export interface RankedPoi extends SuggestablePoi {
  milesAway: number;
  score: number;
}

export interface LatLng {
  lat: number;
  lng: number;
}

function haversineMiles(a: LatLng, b: LatLng): number {
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

/** Prefer free/wild sleep over paid campsites when distances are similar. */
const SLEEP_CATEGORY_BONUS: Record<string, number> = {
  wild_camping: 8,
  parking_overnight: 5,
  campsite: 3,
  rest_area: 1,
  parking: 0,
};

/**
 * Rank POIs by distance to `center`, with optional category preference bonuses.
 * Closer wins; within ~same band, preferred sleep types float up.
 */
export function rankPoisNear(
  center: LatLng,
  pois: SuggestablePoi[],
  opts?: {
    maxMiles?: number;
    limit?: number;
    categories?: string[];
    preferSleep?: boolean;
  },
): RankedPoi[] {
  const maxMiles = opts?.maxMiles ?? 30;
  const limit = opts?.limit ?? 20;
  const cats = opts?.categories ? new Set(opts.categories) : null;

  const ranked: RankedPoi[] = [];
  for (const p of pois) {
    if (cats && !cats.has(p.category)) continue;
    const milesAway =
      Math.round(haversineMiles(center, { lat: p.lat, lng: p.lng }) * 10) / 10;
    if (milesAway > maxMiles) continue;
    const catBonus = opts?.preferSleep
      ? (SLEEP_CATEGORY_BONUS[p.category] ?? 0)
      : 0;
    const ratingBonus =
      p.rating != null && Number.isFinite(p.rating)
        ? Math.min(5, Math.max(0, p.rating))
        : 0;
    // Lower score is better: distance dominates, bonuses reduce score.
    const score = milesAway - catBonus * 0.15 - ratingBonus * 0.2;
    ranked.push({ ...p, milesAway, score });
  }

  ranked.sort((a, b) => a.score - b.score || a.milesAway - b.milesAway);
  return ranked.slice(0, limit);
}

/**
 * Walk segment destinations (overnight endpoints) and attach top sleep POIs
 * near each — for multi-day long-term plan preview.
 */
export function suggestOvernightsAlongRoute(
  endpoints: Array<{ date: string; name: string; lat: number; lng: number }>,
  pois: SuggestablePoi[],
  opts?: { maxMiles?: number; perEndpoint?: number },
): Array<{
  date: string;
  endpointName: string;
  lat: number;
  lng: number;
  suggestions: RankedPoi[];
}> {
  const per = opts?.perEndpoint ?? 5;
  const maxMiles = opts?.maxMiles ?? 25;
  return endpoints.map((ep) => ({
    date: ep.date,
    endpointName: ep.name,
    lat: ep.lat,
    lng: ep.lng,
    suggestions: rankPoisNear(
      { lat: ep.lat, lng: ep.lng },
      pois,
      {
        maxMiles,
        limit: per,
        preferSleep: true,
        categories: [
          "wild_camping",
          "campsite",
          "parking_overnight",
          "rest_area",
          "parking",
        ],
      },
    ),
  }));
}
