/**
 * Corridor POI Import — OpenStreetMap Overpass API
 *
 * Imports Van Life Amenities (fuel, campsites, water, dump stations, rest
 * areas, grocery, showers, propane, scenic) from OpenStreetMap into the
 * `imported_poi` table, where `corridor.searchImported` serves them to the
 * web + mobile map.
 *
 * The bounding box is selectable so you can import the corridor for *your*
 * actual route, not just the built-in Seattle → Des Moines demo box:
 *
 *   # Derive the box from a real trip's segments (origin/dest + route polyline):
 *   DATABASE_URL="..." pnpm -F @sortey/db tsx scripts/import-ioverlander.ts --trip <tripId>
 *
 *   # Explicit box (south,west,north,east):
 *   DATABASE_URL="..." pnpm -F @sortey/db tsx scripts/import-ioverlander.ts --bbox 40.5,-123,48.5,-93
 *
 *   # Default (Seattle → Des Moines I-90 corridor), all categories:
 *   DATABASE_URL="..." pnpm -F @sortey/db tsx scripts/import-ioverlander.ts
 *
 * Flags:
 *   --trip <id>            derive bbox from a trip's segments, padded by --pad
 *   --bbox <s,w,n,e>       explicit bounding box (decimal degrees)
 *   --pad <miles>          padding around a --trip box (default 30 = corridor radius)
 *   --categories <a,b,c>   restrict to a subset of categories
 *   --source <name>        source label stored on each row (default "osm")
 *
 * iOverlander's API is auth-gated behind Cloudflare, so we use OSM Overpass
 * which is free, no auth, and has excellent amenity coverage.
 */

import { eq } from "drizzle-orm";

import { db } from "../src/client";
import { importedPois, tripSegments, trips } from "../src/schema";

const BATCH_SIZE = 500;
// Overpass mirrors, tried in order. The public de instance frequently returns
// 504 on large boxes, so we fail over to community mirrors before giving up.
const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const MAX_ATTEMPTS_PER_CATEGORY = 4;
const MILES_PER_DEGREE_LAT = 69;

// Default bounding box: Seattle → Des Moines (with padding for the I-90 corridor).
const DEFAULT_BBOX: BBox = {
  south: 40.5,
  west: -123.0,
  north: 48.5,
  east: -93.0,
};

interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface PoiRow {
  source: string;
  externalId: string;
  name: string;
  category: string;
  lat: string;
  lng: string;
  data: unknown;
}

// Category → Overpass element selectors, evaluated against a bbox `(s,w,n,e)`.
const CATEGORY_SELECTORS: Record<string, (b: string) => string> = {
  fuel: (b) => `node["amenity"="fuel"](${b});`,
  campsite: (b) => `(
    node["tourism"="camp_site"](${b});
    way["tourism"="camp_site"](${b});
    node["tourism"="caravan_site"](${b});
    way["tourism"="caravan_site"](${b});
  );`,
  water: (b) => `(
    node["amenity"="drinking_water"](${b});
    node["amenity"="water_point"](${b});
  );`,
  dump_station: (b) => `node["amenity"="sanitary_dump_station"](${b});`,
  rest_area: (b) => `(
    node["highway"="rest_area"](${b});
    way["highway"="rest_area"](${b});
    node["highway"="services"](${b});
    way["highway"="services"](${b});
  );`,
  grocery: (b) => `node["shop"="supermarket"](${b});`,
  shower: (b) => `node["amenity"="shower"](${b});`,
  propane: (b) => `node["fuel:lpg"="yes"](${b});`,
  scenic: (b) => `node["tourism"="viewpoint"](${b});`,
  // Work spots (Starlink-clear / wifi / power) — for the day-map work window.
  cafe: (b) => `node["amenity"="cafe"](${b});`,
  library: (b) => `node["amenity"="library"](${b});`,
  coworking: (b) => `(
    node["office"="coworking"](${b});
    node["amenity"="coworking_space"](${b});
  );`,
  // Food + experiences — so the day-map pulls genuinely useful stops.
  restaurant: (b) => `node["amenity"="restaurant"](${b});`,
  trailhead: (b) => `(
    node["highway"="trailhead"](${b});
    node["information"="trailhead"](${b});
  );`,
};

/** Parse `--flag value` pairs and `--flag` booleans from argv. */
function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

/** Standard Google/Mapbox encoded-polyline decoder (precision 5). Zero-dep. */
function decodePolyline(str: string, precision = 5): Array<[number, number]> {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coordinates: Array<[number, number]> = [];
  const factor = 10 ** precision;

  while (index < str.length) {
    let result = 1;
    let shift = 0;
    let b: number;
    do {
      b = str.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 1;
    shift = 0;
    do {
      b = str.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coordinates.push([lat / factor, lng / factor]);
  }
  return coordinates;
}

/** Grow a bbox to include a point. */
function extend(box: BBox | null, lat: number, lng: number): BBox {
  if (!box) return { south: lat, north: lat, west: lng, east: lng };
  return {
    south: Math.min(box.south, lat),
    north: Math.max(box.north, lat),
    west: Math.min(box.west, lng),
    east: Math.max(box.east, lng),
  };
}

/** Pad a bbox by a number of miles (longitude scaled by latitude). */
function padBox(box: BBox, miles: number): BBox {
  const latPad = miles / MILES_PER_DEGREE_LAT;
  const midLat = (box.south + box.north) / 2;
  const lngPad =
    miles /
    (MILES_PER_DEGREE_LAT * Math.max(0.01, Math.cos((midLat * Math.PI) / 180)));
  return {
    south: box.south - latPad,
    north: box.north + latPad,
    west: box.west - lngPad,
    east: box.east + lngPad,
  };
}

/** Derive a corridor bbox from a trip's segments (endpoints + route polylines). */
async function bboxFromTrip(tripId: string, padMiles: number): Promise<BBox> {
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(eq(trips.id, tripId))
    .limit(1);
  if (!trip) {
    throw new Error(`Trip ${tripId} not found.`);
  }

  const segments = await db
    .select({
      originLat: tripSegments.originLat,
      originLng: tripSegments.originLng,
      destinationLat: tripSegments.destinationLat,
      destinationLng: tripSegments.destinationLng,
      routePolyline: tripSegments.routePolyline,
    })
    .from(tripSegments)
    .where(eq(tripSegments.tripId, tripId));

  let box: BBox | null = null;
  let pointCount = 0;
  const consider = (lat: string | null, lng: string | null) => {
    if (lat == null || lng == null) return;
    const latN = Number(lat);
    const lngN = Number(lng);
    if (!Number.isFinite(latN) || !Number.isFinite(lngN)) return;
    box = extend(box, latN, lngN);
    pointCount++;
  };

  for (const seg of segments) {
    consider(seg.originLat, seg.originLng);
    consider(seg.destinationLat, seg.destinationLng);
    if (seg.routePolyline) {
      for (const [lat, lng] of decodePolyline(seg.routePolyline)) {
        box = extend(box, lat, lng);
        pointCount++;
      }
    }
  }

  if (!box || pointCount === 0) {
    throw new Error(
      `Trip ${tripId} has no segment coordinates or route polylines to derive a corridor from. ` +
        `Plan the route first, or pass --bbox explicitly.`,
    );
  }

  console.log(
    `  Derived corridor from ${segments.length} segment(s), ${pointCount} point(s), padded ${padMiles}mi.`,
  );
  return padBox(box, padMiles);
}

function parseBboxFlag(value: string): BBox {
  const parts = value.split(",").map((s) => Number(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`--bbox must be "south,west,north,east", got "${value}"`);
  }
  const [south, west, north, east] = parts as [number, number, number, number];
  return { south, west, north, east };
}

function bboxToOverpass(box: BBox): string {
  // Overpass bbox order is (south,west,north,east).
  return `${box.south},${box.west},${box.north},${box.east}`;
}

function getName(el: OsmElement, category: string): string {
  const tags = el.tags ?? {};
  return (
    tags.name ?? tags.brand ?? tags.operator ?? `${category} (OSM ${el.id})`
  );
}

async function fetchCategory(
  category: string,
  bboxStr: string,
  source: string,
): Promise<PoiRow[]> {
  const selector = CATEGORY_SELECTORS[category];
  if (!selector) {
    console.error(`  Unknown category "${category}", skipping.`);
    return [];
  }
  const query = `[out:json][timeout:90];${selector(bboxStr)}out center;`;

  console.log(`  Fetching ${category}...`);

  // Retry across mirrors with backoff — public Overpass 504s on big boxes.
  let elements: OsmElement[] | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_CATEGORY; attempt++) {
    const url = OVERPASS_MIRRORS[attempt % OVERPASS_MIRRORS.length]!;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "User-Agent": "Sortey/1.0 (trip-planner)" },
        body: new URLSearchParams({ data: query }),
      });
      if (res.ok) {
        const data = (await res.json()) as { elements?: OsmElement[] };
        elements = data.elements ?? [];
        break;
      }
      console.error(
        `  ${category}: ${res.status} ${res.statusText} from ${new URL(url).host} (attempt ${attempt + 1})`,
      );
    } catch (err) {
      console.error(
        `  ${category}: ${(err as Error).message} from ${new URL(url).host} (attempt ${attempt + 1})`,
      );
    }
    // Backoff before the next mirror/attempt.
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }

  if (elements == null) {
    console.error(
      `  Gave up on ${category} after ${MAX_ATTEMPTS_PER_CATEGORY} attempts.`,
    );
    return [];
  }

  const rows: PoiRow[] = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    rows.push({
      source,
      externalId: `${el.type}/${el.id}`,
      name: getName(el, category),
      category,
      lat: lat.toString(),
      lng: lon.toString(),
      data: { tags: el.tags, type: el.type, id: el.id },
    });
  }

  console.log(
    `  ${category}: ${elements.length} elements → ${rows.length} valid`,
  );
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = typeof args.source === "string" ? args.source : "osm";
  const padMiles = typeof args.pad === "string" ? Number(args.pad) : 30;

  let box: BBox;
  if (typeof args.trip === "string") {
    box = await bboxFromTrip(args.trip, padMiles);
  } else if (typeof args.bbox === "string") {
    box = parseBboxFlag(args.bbox);
  } else {
    box = DEFAULT_BBOX;
  }

  const categories =
    typeof args.categories === "string"
      ? args.categories.split(",").map((c) => c.trim())
      : Object.keys(CATEGORY_SELECTORS);

  const bboxStr = bboxToOverpass(box);
  console.log("Corridor POI Import: OpenStreetMap Overpass API");
  console.log(`  Bounding box (S,W,N,E): ${bboxStr}`);
  console.log(`  Categories: ${categories.join(", ")}\n`);

  const allRows: PoiRow[] = [];
  for (const category of categories) {
    const rows = await fetchCategory(category, bboxStr, source);
    allRows.push(...rows);
    // Overpass rate limit: ~2 req/sec.
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log(`\nTotal POIs to import: ${allRows.length}\n`);
  if (allRows.length === 0) {
    console.log("Nothing to import.");
    process.exit(0);
  }

  let processed = 0;
  const totalBatches = Math.ceil(allRows.length / BATCH_SIZE);
  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const batch = allRows.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    await db
      .insert(importedPois)
      .values(batch)
      .onConflictDoNothing({
        target: [importedPois.source, importedPois.externalId],
      });
    processed += batch.length;
    console.log(
      `  Batch ${batchNum}/${totalBatches}: ${batch.length} rows (${processed}/${allRows.length})`,
    );
  }

  console.log(`\nImport complete!`);
  console.log(`  Total fetched: ${allRows.length}`);
  console.log(`  Duplicates silently skipped via ON CONFLICT DO NOTHING`);
  process.exit(0);
}

main().catch((err) => {
  console.error("POI import failed:", err);
  process.exit(1);
});
