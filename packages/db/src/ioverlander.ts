/**
 * iOverlander CSV parsing + scoped import, shared by the CLI importer, the
 * `corridor.importIoverlander` tRPC mutation, and the in-app upload route so
 * every path produces identical rows.
 *
 * LICENSING: iOverlander data can't be redistributed across users. Each user
 * uploads their OWN CSV export and the rows are scoped to their workspace
 * (workspaceId set, externalId prefixed `iov/<workspaceId>/…`). Never insert a
 * user's iOverlander rows without a workspaceId.
 */

import { importedPois } from "./schema";

const SOURCE = "ioverlander";
const BATCH_SIZE = 500;

/** iOverlander category (lowercased) → our imported_poi category. */
export const CATEGORY_MAP: Record<string, string> = {
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
  // Sleep / park / road amenities for long-term van planning
  parking: "parking",
  "day parking": "parking",
  "overnight parking": "parking_overnight",
  "parking lot": "parking",
  "car park": "parking",
  "rest area": "rest_area",
  "rest stop": "rest_area",
  "picnic area": "rest_area",
  "toll plaza": "toll",
  toll: "toll",
  "toll booth": "toll",
  "truck stop": "fuel",
  wifi: "wifi",
  "wifi hotspot": "wifi",
  hospital: "medical",
  pharmacy: "medical",
  "pet friendly": "pet",
};

/** Amenity groups used by the road-trip planner UI and corridor filters. */
export const AMENITY_GROUPS = {
  sleep: ["wild_camping", "campsite", "parking_overnight", "rest_area"],
  parking: ["parking", "parking_overnight", "rest_area"],
  service: ["water", "dump_station", "propane", "shower", "laundry", "mechanic"],
  fuel: ["fuel"],
  food: ["grocery", "restaurant"],
  road: ["toll", "rest_area", "parking"],
} as const;

export type AmenityGroup = keyof typeof AMENITY_GROUPS;

export const OVERNIGHT_CATEGORIES = [
  "wild_camping",
  "campsite",
  "parking_overnight",
  "rest_area",
] as const;

export function overnightKindFromCategory(
  category: string,
): "dispersed" | "campground" | "hotel" | "unknown" {
  if (category === "wild_camping" || category === "parking_overnight") {
    return "dispersed";
  }
  if (category === "campsite") return "campground";
  if (category === "rest_area" || category === "parking") return "unknown";
  return "unknown";
}

export interface IoverlanderPoiRow {
  source: string;
  externalId: string;
  name: string;
  category: string;
  lat: string;
  lng: string;
  data: unknown;
  workspaceId: string | null;
}

export interface ParsedIoverlander {
  rows: IoverlanderPoiRow[];
  catCounts: Record<string, number>;
  total: number;
  /** data rows dropped for missing/invalid coordinates */
  skipped: number;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** RFC-4180-ish CSV parse (handles quoted fields, embedded commas/newlines). */
export function parseCsv(text: string): string[][] {
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

/**
 * Parse an iOverlander CSV export into scoped `imported_poi` rows. Throws on a
 * malformed file (no data rows / missing required columns) so callers can
 * surface a clear error to the uploader.
 */
export function parseIoverlanderCsv(
  text: string,
  workspaceId: string | null,
): ParsedIoverlander {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("CSV has no data rows");
  const header = rows[0]!;

  const iName = colIndex(header, "name", "title");
  const iCat = colIndex(header, "category", "type");
  const iLat = colIndex(header, "latitude", "lat");
  const iLng = colIndex(header, "longitude", "lon", "lng");
  const iId = colIndex(header, "id", "place id");
  if (iName < 0 || iCat < 0 || iLat < 0 || iLng < 0) {
    throw new Error(`CSV missing required columns. Found: ${header.join(", ")}`);
  }

  const wsPrefix = workspaceId ? `${workspaceId}/` : "";
  const out: IoverlanderPoiRow[] = [];
  const catCounts: Record<string, number> = {};
  let skipped = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    const rawLat = (row[iLat] ?? "").trim();
    const rawLng = (row[iLng] ?? "").trim();
    const lat = Number(rawLat);
    const lng = Number(rawLng);
    // Reject blank cells explicitly — Number("") is 0, which would otherwise
    // plant a bogus "null island" (0,0) POI.
    if (
      rawLat === "" ||
      rawLng === "" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      skipped++;
      continue;
    }
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

  return { rows: out, catCounts, total: out.length, skipped };
}

export interface ImportIoverlanderResult {
  imported: number;
  skipped: number;
  catCounts: Record<string, number>;
}

/**
 * Parse + batch-insert an iOverlander CSV, de-duping on (source, externalId)
 * via onConflictDoNothing so re-uploading the same export is idempotent. Rows
 * are scoped to `workspaceId` (required for user uploads — never redistribute).
 */
export async function importIoverlanderCsv(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  p: { text: string; workspaceId: string | null },
): Promise<ImportIoverlanderResult> {
  const parsed = parseIoverlanderCsv(p.text, p.workspaceId);
  for (let i = 0; i < parsed.rows.length; i += BATCH_SIZE) {
    const batch = parsed.rows.slice(i, i + BATCH_SIZE);
    await db
      .insert(importedPois)
      .values(batch)
      .onConflictDoNothing({
        target: [importedPois.source, importedPois.externalId],
      });
  }
  return {
    imported: parsed.total,
    skipped: parsed.skipped,
    catCounts: parsed.catCounts,
  };
}
