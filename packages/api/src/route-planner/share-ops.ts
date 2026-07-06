/**
 * Trip-share persistence + the sanitized public recap. A share is a capability
 * token; when enabled, anyone with the link sees a read-only journal.
 *
 * PRIVACY: the public payload is built ONLY from traveled segments + pin
 * titles + GPS track. It must NEVER include expenses, member PII, or
 * workspace-scoped iOverlander POIs (non-redistributable). Keep it that way.
 */

import { and, asc, eq } from "@sortey/db";
import { pins, tripSegments, tripShares, trips } from "@sortey/db/schema";

import { buildRecap, type TripRecap } from "./recap";
import { getTrackStats } from "./track-ops";

export interface ShareRow {
  token: string;
  enabled: boolean;
}

/** The trip's share, or null if none exists yet. */
export async function getShare(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  tripId: string,
): Promise<ShareRow | null> {
  const [row] = (await db
    .select({ token: tripShares.token, enabled: tripShares.enabled })
    .from(tripShares)
    .where(eq(tripShares.tripId, tripId))
    .limit(1)) as ShareRow[];
  return row ?? null;
}

/**
 * Enable sharing: create the share with a fresh random token if absent, or
 * re-enable (keeping the existing token so old links keep working). Returns the
 * active token.
 */
export async function enableShare(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  tripId: string,
): Promise<{ token: string }> {
  const existing = await getShare(db, tripId);
  if (existing) {
    if (!existing.enabled) {
      await db
        .update(tripShares)
        .set({ enabled: true })
        .where(eq(tripShares.tripId, tripId));
    }
    return { token: existing.token };
  }
  const token = crypto.randomUUID().replace(/-/g, "");
  await db.insert(tripShares).values({ tripId, token, enabled: true });
  return { token };
}

/** Disable sharing (keeps the token so it can be re-enabled later). */
export async function disableShare(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  tripId: string,
): Promise<void> {
  await db
    .update(tripShares)
    .set({ enabled: false })
    .where(eq(tripShares.tripId, tripId));
}

export interface PublicTraveledStop {
  name: string;
  date: string | null;
  miles: number;
}

export interface PublicRecap {
  tripName: string;
  recap: TripRecap;
  stops: PublicTraveledStop[];
}

/**
 * Resolve a share token to a sanitized public recap, or null if the token is
 * unknown or disabled. Only traveled (past) legs and pin titles are exposed.
 */
export async function resolveSharedRecap(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  token: string,
  today: string,
): Promise<PublicRecap | null> {
  const [share] = (await db
    .select({ tripId: tripShares.tripId, enabled: tripShares.enabled })
    .from(tripShares)
    .where(eq(tripShares.token, token))
    .limit(1)) as Array<{ tripId: string; enabled: boolean }>;
  if (!share || !share.enabled) return null;

  const [trip] = (await db
    .select({ name: trips.name })
    .from(trips)
    .where(eq(trips.id, share.tripId))
    .limit(1)) as Array<{ name: string }>;
  if (!trip) return null;

  const segRows = (await db
    .select({
      name: tripSegments.name,
      destinationName: tripSegments.destinationName,
      distanceMiles: tripSegments.distanceMiles,
      startDate: tripSegments.startDate,
    })
    .from(tripSegments)
    .where(eq(tripSegments.tripId, share.tripId))
    .orderBy(asc(tripSegments.sortOrder))) as Array<{
    name: string;
    destinationName: string | null;
    distanceMiles: string | null;
    startDate: string | null;
  }>;

  const pinRows = (await db
    .select({
      title: pins.title,
      type: pins.type,
      segmentDate: tripSegments.startDate,
    })
    .from(pins)
    .innerJoin(tripSegments, eq(pins.segmentId, tripSegments.id))
    .where(eq(pins.tripId, share.tripId))) as Array<{
    title: string;
    type: string;
    segmentDate: string | null;
  }>;

  const track = await getTrackStats(db, share.tripId);
  const recap = buildRecap(segRows, pinRows, today, track);

  const stops: PublicTraveledStop[] = segRows
    .filter((s) => s.startDate != null && s.startDate <= today)
    .map((s) => ({
      name: s.destinationName ?? s.name,
      date: s.startDate,
      miles: s.distanceMiles ? Math.round(Number(s.distanceMiles)) : 0,
    }));

  return { tripName: trip.name, recap, stops };
}
