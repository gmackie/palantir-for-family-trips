/**
 * POI Import Script — OpenStreetMap Overpass API
 *
 * Imports van-life amenities (fuel, campgrounds, water, dump stations, rest
 * areas, grocery) from OpenStreetMap along a given bounding box. Default
 * covers the Seattle → Des Moines corridor via I-90/I-35.
 *
 * Run: DATABASE_URL="..." npx tsx packages/db/scripts/import-ioverlander.ts
 *
 * iOverlander's API is auth-gated behind Cloudflare, so we use OSM Overpass
 * which is free, no auth, and has excellent amenity coverage.
 */

import { db } from "../src/client";
import { importedPois } from "../src/schema";

const SOURCE = "osm";
const BATCH_SIZE = 500;

// Seattle → Des Moines bounding box (with padding for I-90 corridor)
const SOUTH = 40.5;
const NORTH = 48.5;
const WEST = -123.0;
const EAST = -93.0;

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

// Narrower corridor around I-90 for high-density categories
const I90_SOUTH = 42.0;
const I90_NORTH = 48.0;

const QUERIES: Array<{ category: string; query: string }> = [
  {
    category: "fuel",
    query: `node["amenity"="fuel"](${I90_SOUTH},${WEST},${I90_NORTH},${EAST});`,
  },
  {
    category: "campsite",
    query: `(
      node["tourism"="camp_site"](${SOUTH},${WEST},${NORTH},${EAST});
      way["tourism"="camp_site"](${SOUTH},${WEST},${NORTH},${EAST});
      node["tourism"="caravan_site"](${SOUTH},${WEST},${NORTH},${EAST});
      way["tourism"="caravan_site"](${SOUTH},${WEST},${NORTH},${EAST});
    );`,
  },
  {
    category: "water",
    query: `(
      node["amenity"="drinking_water"](${SOUTH},${WEST},${NORTH},${EAST});
      node["amenity"="water_point"](${SOUTH},${WEST},${NORTH},${EAST});
    );`,
  },
  {
    category: "dump_station",
    query: `node["amenity"="sanitary_dump_station"](${SOUTH},${WEST},${NORTH},${EAST});`,
  },
  {
    category: "rest_area",
    query: `(
      node["highway"="rest_area"](${SOUTH},${WEST},${NORTH},${EAST});
      way["highway"="rest_area"](${SOUTH},${WEST},${NORTH},${EAST});
      node["highway"="services"](${SOUTH},${WEST},${NORTH},${EAST});
      way["highway"="services"](${SOUTH},${WEST},${NORTH},${EAST});
    );`,
  },
  {
    category: "grocery",
    query: `node["shop"="supermarket"](${SOUTH},${WEST},${NORTH},${EAST});`,
  },
  {
    category: "shower",
    query: `node["amenity"="shower"](${SOUTH},${WEST},${NORTH},${EAST});`,
  },
  {
    category: "propane",
    query: `node["fuel:lpg"="yes"](${SOUTH},${WEST},${NORTH},${EAST});`,
  },
  {
    category: "scenic",
    query: `node["tourism"="viewpoint"](${SOUTH},${WEST},${NORTH},${EAST});`,
  },
];

function getName(el: OsmElement, category: string): string {
  const tags = el.tags ?? {};
  return (
    tags.name ?? tags.brand ?? tags.operator ?? `${category} (OSM ${el.id})`
  );
}

async function fetchCategory(
  category: string,
  overpassQuery: string,
): Promise<
  Array<{
    source: string;
    externalId: string;
    name: string;
    category: string;
    lat: string;
    lng: string;
    data: unknown;
  }>
> {
  const query = `[out:json][timeout:90];${overpassQuery}out center;`;

  console.log(`  Fetching ${category}...`);
  const body = new URLSearchParams({ data: query });
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "User-Agent": "Sortie/1.0 (trip-planner)" },
    body,
  });

  if (!res.ok) {
    console.error(
      `  Failed to fetch ${category}: ${res.status} ${res.statusText}`,
    );
    return [];
  }

  const data = (await res.json()) as { elements: OsmElement[] };
  const elements = data.elements ?? [];

  const rows = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!lat || !lon) continue;

    rows.push({
      source: SOURCE,
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
  console.log("POI Import: OpenStreetMap Overpass API");
  console.log(
    `  Bounding box: ${SOUTH},${WEST} → ${NORTH},${EAST} (Seattle→Des Moines corridor)\n`,
  );

  const allRows: Array<{
    source: string;
    externalId: string;
    name: string;
    category: string;
    lat: string;
    lng: string;
    data: unknown;
  }> = [];

  for (const { category, query } of QUERIES) {
    const rows = await fetchCategory(category, query);
    allRows.push(...rows);
    // Overpass rate limit: 2 req/sec
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
