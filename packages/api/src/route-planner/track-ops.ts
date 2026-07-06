/**
 * GPS breadcrumb persistence — record position batches into `gps_track_point`
 * and read them back as stats/path. Shared by the `location` router and the
 * CLI. Append-only (distinct from `member_location`, which is live presence).
 */

import { and, asc, eq, gte } from "@sortey/db";
import { gpsTrackPoints } from "@sortey/db/schema";

import { buildTrackStats, type TrackPoint, type TrackStats } from "./track";

export interface BreadcrumbInput {
  lat: number;
  lng: number;
  speed?: number | null;
  /** ISO-8601; defaults to now if omitted. */
  recordedAt?: string;
}

/** Append a batch of breadcrumbs for a trip. Returns how many were stored. */
export async function recordBreadcrumbs(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  p: { tripId: string; segmentId?: string | null; points: BreadcrumbInput[] },
): Promise<{ stored: number }> {
  const rows = p.points
    .filter((pt) => Number.isFinite(pt.lat) && Number.isFinite(pt.lng))
    .map((pt) => ({
      tripId: p.tripId,
      segmentId: p.segmentId ?? null,
      lat: pt.lat.toString(),
      lng: pt.lng.toString(),
      speed: pt.speed != null ? pt.speed.toString() : null,
      recordedAt: pt.recordedAt ? new Date(pt.recordedAt) : new Date(),
    }));
  if (rows.length === 0) return { stored: 0 };

  for (let i = 0; i < rows.length; i += 500) {
    await db.insert(gpsTrackPoints).values(rows.slice(i, i + 500));
  }
  return { stored: rows.length };
}

async function loadPoints(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  tripId: string,
  since?: string,
): Promise<TrackPoint[]> {
  const conds = [eq(gpsTrackPoints.tripId, tripId)];
  if (since) conds.push(gte(gpsTrackPoints.recordedAt, new Date(since)));
  const rows = (await db
    .select({
      lat: gpsTrackPoints.lat,
      lng: gpsTrackPoints.lng,
      recordedAt: gpsTrackPoints.recordedAt,
    })
    .from(gpsTrackPoints)
    .where(and(...conds))
    .orderBy(asc(gpsTrackPoints.recordedAt))
    .limit(50_000)) as Array<{ lat: string; lng: string; recordedAt: Date }>;
  return rows.map((r) => ({
    lat: Number(r.lat),
    lng: Number(r.lng),
    recordedAt: r.recordedAt.toISOString(),
  }));
}

/** Distance/bounds/span for a trip's breadcrumbs (optionally since a date). */
export async function getTrackStats(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  tripId: string,
  opts?: { since?: string },
): Promise<TrackStats> {
  return buildTrackStats(await loadPoints(db, tripId, opts?.since));
}

/** The raw ordered path (for map display; downsample on the client). */
export async function getTrackPath(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  tripId: string,
  opts?: { since?: string },
): Promise<TrackPoint[]> {
  return loadPoints(db, tripId, opts?.since);
}
