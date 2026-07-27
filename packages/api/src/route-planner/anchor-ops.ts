/**
 * Anchor persistence + status, shared by the `anchors` router and the CLI.
 * CRUD over `trip_anchor`, plus `computeNextAnchor` which resolves the current
 * position and paces the soonest commitment for the day-map briefing.
 */

import { asc, eq } from "@sortey/db";
import { tripAnchors } from "@sortey/db/schema";

import {
  type AnchorLike,
  type AnchorPacing,
  anchorPacing,
  nextAnchor,
} from "./anchors";

export interface AnchorInput {
  title: string;
  kind?: string;
  placeName?: string | null;
  lat?: number | null;
  lng?: number | null;
  startDate: string;
  endDate?: string | null;
  confirmationCode?: string | null;
  url?: string | null;
  note?: string | null;
}

function rowToAnchor(r: {
  id: string;
  title: string;
  kind: string;
  placeName: string | null;
  lat: string | null;
  lng: string | null;
  startDate: string;
  endDate: string | null;
}): AnchorLike {
  return {
    id: r.id,
    title: r.title,
    kind: r.kind,
    placeName: r.placeName,
    lat: r.lat != null ? Number(r.lat) : null,
    lng: r.lng != null ? Number(r.lng) : null,
    startDate: r.startDate,
    endDate: r.endDate,
  };
}

const SELECT = {
  id: tripAnchors.id,
  title: tripAnchors.title,
  kind: tripAnchors.kind,
  placeName: tripAnchors.placeName,
  lat: tripAnchors.lat,
  lng: tripAnchors.lng,
  startDate: tripAnchors.startDate,
  endDate: tripAnchors.endDate,
  confirmationCode: tripAnchors.confirmationCode,
  url: tripAnchors.url,
  note: tripAnchors.note,
};

/** All anchors for a trip, soonest first. */
export async function listAnchors(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  tripId: string,
) {
  return (await db
    .select(SELECT)
    .from(tripAnchors)
    .where(eq(tripAnchors.tripId, tripId))
    .orderBy(asc(tripAnchors.startDate))) as Array<
    Record<string, string | null>
  >;
}

export async function createAnchor(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  p: { tripId: string } & AnchorInput,
): Promise<{ id: string }> {
  const [row] = (await db
    .insert(tripAnchors)
    .values({
      tripId: p.tripId,
      title: p.title,
      kind: p.kind ?? "event",
      placeName: p.placeName ?? null,
      lat: p.lat != null ? p.lat.toString() : null,
      lng: p.lng != null ? p.lng.toString() : null,
      startDate: p.startDate,
      endDate: p.endDate ?? null,
      confirmationCode: p.confirmationCode ?? null,
      url: p.url ?? null,
      note: p.note ?? null,
    })
    .returning({ id: tripAnchors.id })) as Array<{ id: string }>;
  return row!;
}

export async function updateAnchor(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  p: { tripId: string; anchorId: string } & Partial<AnchorInput>,
): Promise<void> {
  const set: Record<string, unknown> = {};
  if (p.title !== undefined) set.title = p.title;
  if (p.kind !== undefined) set.kind = p.kind;
  if (p.placeName !== undefined) set.placeName = p.placeName;
  if (p.lat !== undefined) set.lat = p.lat != null ? p.lat.toString() : null;
  if (p.lng !== undefined) set.lng = p.lng != null ? p.lng.toString() : null;
  if (p.startDate !== undefined) set.startDate = p.startDate;
  if (p.endDate !== undefined) set.endDate = p.endDate;
  if (p.confirmationCode !== undefined)
    set.confirmationCode = p.confirmationCode;
  if (p.url !== undefined) set.url = p.url;
  if (p.note !== undefined) set.note = p.note;
  if (Object.keys(set).length === 0) return;
  await db.update(tripAnchors).set(set).where(eq(tripAnchors.id, p.anchorId));
}

export async function deleteAnchor(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  anchorId: string,
): Promise<void> {
  await db.delete(tripAnchors).where(eq(tripAnchors.id, anchorId));
}

/**
 * The next upcoming anchor paced from a reference point (current position), or
 * null when there are no upcoming anchors.
 */
export async function computeNextAnchor(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  p: {
    tripId: string;
    from: { lat: number; lng: number } | null;
    today: string;
  },
): Promise<AnchorPacing | null> {
  const rows = await listAnchors(db, p.tripId);
  const anchors = rows.map((r) =>
    // biome-ignore lint/suspicious/noExplicitAny: narrow row shape
    rowToAnchor(r as any),
  );
  const next = nextAnchor(anchors, p.today);
  if (!next) return null;
  return anchorPacing(next, p.from, p.today);
}
