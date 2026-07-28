/**
 * VanState persistence — records resource-level readings (grey/black/fresh/
 * propane/fuel) and turns their history into the inputs predictive service
 * alerts need: the *latest* level per resource (current state) and *learned*
 * consumption rates (this van's real %/day). Shared by the `daymap` router and
 * the CLI so app + agents compute identical state.
 */

import { desc, eq } from "@sortey/db";
import { vanStateReadings } from "@sortey/db/schema";

import type { Reading } from "./consumption";
import { learnRates } from "./consumption";
import { DEFAULT_RATES_PCT_PER_DAY, DEFAULT_RESOURCE_MODELS } from "./service";
import type { ServiceLevels } from "./service-ops";

/** Resources we track, and which way each moves (fill = waste, drain = supply). */
export const RESOURCE_DIRECTIONS: Record<string, "fill" | "drain"> = {
  ...Object.fromEntries(
    DEFAULT_RESOURCE_MODELS.map((m) => [m.resource, m.direction]),
  ),
  fuel: "drain",
};

export const TRACKED_RESOURCES = Object.keys(RESOURCE_DIRECTIONS);

// How far back readings still count toward the current level / rate learning.
// A reading older than this is stale (levels drift, refills happen unlogged).
const FRESHNESS_DAYS = 14;

export interface VanStateReadingRow {
  resource: string;
  levelPct: number;
  recordedAt: string;
  source: string;
  note: string | null;
}

/**
 * Record a resource reading (0–100%). Returns the inserted row. `recordedAt`
 * defaults to now; callers may backfill an older reading by passing it.
 */
export async function recordReading(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  p: {
    tripId: string;
    resource: string;
    levelPct: number;
    source?: string;
    note?: string;
    recordedAt?: Date;
  },
): Promise<{ id: string }> {
  const [row] = (await db
    .insert(vanStateReadings)
    .values({
      tripId: p.tripId,
      resource: p.resource,
      levelPct: p.levelPct.toString(),
      source: p.source ?? "manual",
      note: p.note ?? null,
      ...(p.recordedAt ? { recordedAt: p.recordedAt } : {}),
    })
    .returning({ id: vanStateReadings.id })) as Array<{ id: string }>;
  return row!;
}

/** All readings for a trip, newest first, within the freshness window. */
async function recentReadings(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  tripId: string,
  now: Date,
): Promise<VanStateReadingRow[]> {
  const rows = (await db
    .select({
      resource: vanStateReadings.resource,
      levelPct: vanStateReadings.levelPct,
      recordedAt: vanStateReadings.recordedAt,
      source: vanStateReadings.source,
      note: vanStateReadings.note,
    })
    .from(vanStateReadings)
    .where(eq(vanStateReadings.tripId, tripId))
    .orderBy(desc(vanStateReadings.recordedAt))
    .limit(500)) as Array<{
    resource: string;
    levelPct: string;
    recordedAt: Date;
    source: string;
    note: string | null;
  }>;

  const cutoff = now.getTime() - FRESHNESS_DAYS * 86_400_000;
  return rows
    .filter((r) => r.recordedAt.getTime() >= cutoff)
    .map((r) => ({
      resource: r.resource,
      levelPct: Number(r.levelPct),
      recordedAt: r.recordedAt.toISOString(),
      source: r.source,
      note: r.note,
    }));
}

export interface VanState {
  /** Latest level per resource (the current state). */
  levels: ServiceLevels;
  /** Learned %/day rates (falls back to defaults when history is thin). */
  rates: Record<string, number>;
  /** Most-recent reading timestamp per resource, for display. */
  updatedAt: Record<string, string>;
}

/**
 * Resolve the trip's current van state: latest level per resource + consumption
 * rates learned from the reading history. Returns null when there are no recent
 * readings (nothing to report).
 */
export async function resolveVanState(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  tripId: string,
  now: Date = new Date(),
): Promise<VanState | null> {
  const rows = await recentReadings(db, tripId, now);
  if (rows.length === 0) return null;

  // rows are newest-first, so the first seen per resource is the latest level.
  const levels: ServiceLevels = {};
  const updatedAt: Record<string, string> = {};
  const histories: Record<string, Reading[]> = {};
  for (const r of rows) {
    if (!(r.resource in updatedAt)) {
      updatedAt[r.resource] = r.recordedAt;
      if (r.resource in RESOURCE_DIRECTIONS) {
        (levels as Record<string, number>)[r.resource] = r.levelPct;
      }
    }
    (histories[r.resource] ??= []).push({
      levelPct: r.levelPct,
      recordedAt: r.recordedAt,
    });
  }

  const rates = learnRates(
    histories,
    RESOURCE_DIRECTIONS,
    DEFAULT_RATES_PCT_PER_DAY,
  );

  return { levels, rates, updatedAt };
}
