/**
 * Real iOverlander importer — loads an iOverlander CSV export into `imported_poi`
 * (source = "ioverlander"), the gold-standard van-life dataset for legal
 * overnight camping (wild/informal/established), water, dump, propane, etc.
 *
 * iOverlander's API is Cloudflare-gated and the full-US export needs an
 * Unlimited subscription, so export the CSV from your account
 * (app.ioverlander.com/countries/places_by_country → CSV) and point this at it:
 *
 *   DATABASE_URL="..." pnpm -F @sortey/db exec tsx \
 *     scripts/import-ioverlander-csv.ts --file ~/Downloads/iOverlander.csv [--dry-run]
 *
 * onConflictDoNothing keeps OSM (source="osm") and iOverlander distinct, so this
 * layers cleanly on top of the existing corridor POIs.
 */

import { readFileSync } from "node:fs";

import { db } from "../src/client";
import { importedPois } from "../src/schema";

const SOURCE = "ioverlander";
const BATCH_SIZE = 500;

/** iOverlander category (lowercased) → our imported_poi category. */
const CATEGORY_MAP: Record<string, string> = {
  "wild camping": "wild_camping",
  "informal campsite": "wild_camping",
  "established campground": "campsite",
  campground: "campsite",
  water: "water",
  "drinking water": "water",
  propane: "propane",
  "dump station": "dump_station",
  "sanitation dump station": "dump_station",
  fuel: "fuel",
  "gas station": "fuel",
  groceries: "grocery",
  laundromat: "laundry",
  laundry: "laundry",
  showers: "shower",
  restaurant: "restaurant",
  mechanic: "mechanic",
};

function slug(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** RFC-4180-ish CSV parse (handles quoted fields, embedded commas/newlines). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function colIndex(header: string[], ...names: string[]): number {
  const lower = header.map((h) => h.toLowerCase().trim());
  for (const n of names) {
    const i = lower.indexOf(n.toLowerCase());
    if (i !== -1) return i;
  }
  return -1;
}

interface PoiRow {
  source: string;
  externalId: string;
  name: string;
  category: string;
  lat: string;
  lng: string;
  data: unknown;
  workspaceId: string | null;
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a?.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else out[key] = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = typeof args.file === "string" ? args.file : null;
  if (!file) throw new Error("--file <iOverlander.csv> is required");
  const dryRun = args["dry-run"] === true;
  // Scope this upload to a workspace (iOverlander can't be redistributed, so a
  // user's POIs stay private). Omit only for shared datasets.
  const workspaceId = typeof args.workspace === "string" ? args.workspace : null;
  const wsPrefix = workspaceId ? `${workspaceId}/` : "";

  const rows = parseCsv(readFileSync(file, "utf8"));
  if (rows.length < 2) throw new Error("CSV has no data rows");
  const header = rows[0]!;

  const iName = colIndex(header, "name", "title");
  const iCat = colIndex(header, "category", "type");
  const iLat = colIndex(header, "latitude", "lat");
  const iLng = colIndex(header, "longitude", "lon", "lng");
  const iId = colIndex(header, "id", "place id");
  if (iName < 0 || iCat < 0 || iLat < 0 || iLng < 0) {
    throw new Error(
      `CSV missing required columns. Found: ${header.join(", ")}`,
    );
  }

  const out: PoiRow[] = [];
  const catCounts: Record<string, number> = {};
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    const lat = Number(row[iLat]);
    const lng = Number(row[iLng]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const rawCat = (row[iCat] ?? "").trim();
    const category =
      CATEGORY_MAP[rawCat.toLowerCase()] ?? (slug(rawCat) || "poi");
    const name = (row[iName] ?? "").trim() || `${category} (iOverlander)`;
    const externalId =
      iId >= 0 && row[iId]
        ? `iov/${wsPrefix}${row[iId]}`
        : `iov/${wsPrefix}${lat},${lng}/${slug(name).slice(0, 40)}`;
    out.push({
      source: SOURCE,
      externalId,
      name,
      category,
      lat: lat.toString(),
      lng: lng.toString(),
      data: { rawCategory: rawCat },
      workspaceId,
    });
    catCounts[category] = (catCounts[category] ?? 0) + 1;
  }

  console.log(`Parsed ${out.length} iOverlander POIs.`);
  console.log(
    Object.entries(catCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `  ${c}: ${n}`)
      .join("\n"),
  );

  if (dryRun) {
    console.log("\n(dry run — nothing written)");
    process.exit(0);
  }

  let processed = 0;
  for (let i = 0; i < out.length; i += BATCH_SIZE) {
    const batch = out.slice(i, i + BATCH_SIZE);
    await db
      .insert(importedPois)
      .values(batch)
      .onConflictDoNothing({
        target: [importedPois.source, importedPois.externalId],
      });
    processed += batch.length;
    console.log(`  Batch: ${processed}/${out.length}`);
  }
  console.log(`\n✅ Imported ${out.length} iOverlander POIs (dupes skipped).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("iOverlander import failed:", err);
  process.exit(1);
});
