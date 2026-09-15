import { eq } from "@sortey/db";
import { tripAnchors, tripSegments } from "@sortey/db/schema";

import type { CopilotAnchor, CopilotLeg, CopilotWorld } from "./types";

/**
 * Build the co-pilot's world from the trip it is actually advising.
 *
 * The P0 co-pilot answered every trip out of `defaultSeedWorld` — a hardcoded
 * July-2026 dogfood run with Denver and Lake Forest anchors and Costco Manteca
 * in the POI list. Ask about a trip through Maine and it would happily reason
 * about a California fuel stop and a Denver deadline that belong to somebody
 * else's summer. That is worse than an empty answer: it is a confident one,
 * and the whole premise of the co-pilot is that it never invents miles or
 * places.
 *
 * So: real anchors, real segments, and an empty world when the trip has
 * neither. A co-pilot that says "I don't know your route yet" is trustworthy.
 * One that borrows a stranger's is not.
 */

export interface CopilotWorldOptions {
  /** Preferences the traveller has expressed; merged into the brief. */
  brief?: Partial<CopilotWorld["brief"]>;
}

export async function buildCopilotWorld(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  tripId: string,
  options: CopilotWorldOptions = {},
): Promise<CopilotWorld> {
  const [anchorRows, segmentRows] = await Promise.all([
    db
      .select({
        id: tripAnchors.id,
        title: tripAnchors.title,
        kind: tripAnchors.kind,
        placeName: tripAnchors.placeName,
        lat: tripAnchors.lat,
        lng: tripAnchors.lng,
        startDate: tripAnchors.startDate,
      })
      .from(tripAnchors)
      .where(eq(tripAnchors.tripId, tripId)) as Promise<
      Array<{
        id: string;
        title: string;
        kind: string | null;
        placeName: string | null;
        lat: string | null;
        lng: string | null;
        startDate: string;
      }>
    >,
    db
      .select({
        id: tripSegments.id,
        name: tripSegments.name,
        originName: tripSegments.originName,
        destinationName: tripSegments.destinationName,
        distanceMiles: tripSegments.distanceMiles,
        durationMinutes: tripSegments.durationMinutes,
        sortOrder: tripSegments.sortOrder,
      })
      .from(tripSegments)
      .where(eq(tripSegments.tripId, tripId)) as Promise<
      Array<{
        id: string;
        name: string;
        originName: string | null;
        destinationName: string | null;
        distanceMiles: string | null;
        durationMinutes: number | null;
        sortOrder: number;
      }>
    >,
  ]);

  const anchors: CopilotAnchor[] = anchorRows
    .map((row) => ({
      id: row.id,
      title: row.title,
      date: String(row.startDate),
      ...(row.lat != null && row.lng != null
        ? { lat: Number(row.lat), lng: Number(row.lng) }
        : {}),
      ...(row.kind ? { kind: row.kind } : {}),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Only segments with both endpoints and a real duration become legs — the
  // co-pilot quotes drive hours, and a leg with a guessed duration is exactly
  // the invented mileage it must never produce.
  const legs: CopilotLeg[] = segmentRows
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter(
      (row) =>
        row.originName != null &&
        row.destinationName != null &&
        row.durationMinutes != null &&
        row.durationMinutes > 0,
    )
    .map((row) => ({
      fromKey: row.originName!,
      toKey: row.destinationName!,
      hours: Math.round((row.durationMinutes! / 60) * 10) / 10,
      ...(row.distanceMiles != null
        ? { miles: Number(row.distanceMiles) }
        : {}),
    }));

  return {
    // POIs are corridor-scoped and loaded per question by the caller; an
    // empty list is honest rather than a stand-in.
    pois: [],
    legs,
    brief: {
      tripId,
      ...options.brief,
      anchors,
    },
  };
}
