/**
 * Journey-logging operations, shared by the `journey` tRPC router and the
 * `journey` CLI so agents and the app behave identically. These take a Drizzle
 * `db` (or transaction) and plain params — no trpc context — and assume the
 * caller has already authorized access to the trip.
 */

import { and, eq } from "@sortey/db";
import { pins, tripSegments } from "@sortey/db/schema";

import {
  fallbackMiles,
  kindToPinType,
  nextSortOrder,
  planHeal,
  resolvePrevPoint,
  type SegmentLike,
  type StopKind,
} from "./journey-logic";
import { routeLeg } from "./routing";

const DEFAULT_TZ = "America/Los_Angeles";

/** Today's date (YYYY-MM-DD) in a tz — the soft, editable default. */
export function todayInTz(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

const SEGMENT_COLUMNS = {
  id: tripSegments.id,
  sortOrder: tripSegments.sortOrder,
  originLat: tripSegments.originLat,
  originLng: tripSegments.originLng,
  originName: tripSegments.originName,
  destinationLat: tripSegments.destinationLat,
  destinationLng: tripSegments.destinationLng,
  destinationName: tripSegments.destinationName,
};

// biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client or tx
type Db = any;

export async function loadSegments(
  db: Db,
  tripId: string,
): Promise<SegmentLike[]> {
  return db
    .select(SEGMENT_COLUMNS)
    .from(tripSegments)
    .where(eq(tripSegments.tripId, tripId));
}

export interface LogStopParams {
  tripId: string;
  userId: string;
  name: string;
  lat: number;
  lng: number;
  date?: string;
  kind?: StopKind;
  note?: string;
  tz?: string;
}

export async function logStopOp(db: Db, p: LogStopParams) {
  const segments = await loadSegments(db, p.tripId);
  const stop = { lat: p.lat, lng: p.lng, name: p.name };
  const prev = resolvePrevPoint(segments);
  const origin = prev ?? stop; // the first stop originates at itself
  const tz = p.tz ?? DEFAULT_TZ;

  const routed = prev ? await routeLeg(prev, stop) : null;
  const miles = routed?.miles ?? (prev ? fallbackMiles(prev, stop) : 0);

  const [seg] = await db
    .insert(tripSegments)
    .values({
      tripId: p.tripId,
      name: `${origin.name} → ${stop.name}`,
      originName: origin.name,
      originLat: origin.lat.toString(),
      originLng: origin.lng.toString(),
      destinationName: stop.name,
      destinationLat: stop.lat.toString(),
      destinationLng: stop.lng.toString(),
      routePolyline: routed?.polyline ?? null,
      distanceMiles: miles.toString(),
      durationMinutes: routed?.minutes ?? null,
      tz,
      startDate: p.date ?? todayInTz(tz),
      sortOrder: nextSortOrder(segments),
    })
    .returning({ id: tripSegments.id });

  if (!seg) throw new Error("Failed to log stop.");

  await db.insert(pins).values({
    tripId: p.tripId,
    segmentId: seg.id,
    title: stop.name,
    lat: stop.lat.toString(),
    lng: stop.lng.toString(),
    type: kindToPinType(p.kind ?? "custom"),
    notes: p.note ?? null,
    createdByUserId: p.userId,
  });

  return { segmentId: seg.id as string, miles, routed: routed != null };
}

export interface UpdateStopParams {
  tripId: string;
  segmentId: string;
  name?: string;
  date?: string;
  lat?: number;
  lng?: number;
  kind?: StopKind;
  note?: string;
}

/** Returns null if the stop wasn't found (caller maps to NOT_FOUND). */
export async function updateStopOp(db: Db, p: UpdateStopParams) {
  const segments = await loadSegments(db, p.tripId);
  const ordered = [...segments].sort((a, b) => a.sortOrder - b.sortOrder);
  const idx = ordered.findIndex((s) => s.id === p.segmentId);
  const target = ordered[idx];
  if (!target) return null;

  const moved = p.lat != null && p.lng != null;
  const newName = p.name ?? target.destinationName ?? "Stop";
  const dest = moved
    ? { lat: p.lat!, lng: p.lng!, name: newName }
    : {
        lat: target.destinationLat != null ? Number(target.destinationLat) : 0,
        lng: target.destinationLng != null ? Number(target.destinationLng) : 0,
        name: newName,
      };

  // biome-ignore lint/suspicious/noExplicitAny: partial drizzle update
  const segUpdate: Record<string, any> = {};
  if (p.name != null) {
    segUpdate.destinationName = p.name;
    segUpdate.name = `${target.originName ?? "Start"} → ${p.name}`;
  }
  if (p.date != null) segUpdate.startDate = p.date;
  if (moved) {
    segUpdate.destinationLat = dest.lat.toString();
    segUpdate.destinationLng = dest.lng.toString();
    if (target.originLat != null && target.originLng != null) {
      const routed = await routeLeg(
        { lat: Number(target.originLat), lng: Number(target.originLng) },
        dest,
      );
      if (routed) {
        segUpdate.routePolyline = routed.polyline;
        segUpdate.distanceMiles = routed.miles.toString();
        segUpdate.durationMinutes = routed.minutes;
      }
    }
  }
  if (Object.keys(segUpdate).length > 0) {
    await db
      .update(tripSegments)
      .set(segUpdate)
      .where(eq(tripSegments.id, p.segmentId));
  }

  const next = ordered[idx + 1];
  if (moved && next) {
    const nextDest =
      next.destinationLat != null && next.destinationLng != null
        ? { lat: Number(next.destinationLat), lng: Number(next.destinationLng) }
        : null;
    const routed = nextDest ? await routeLeg(dest, nextDest) : null;
    await db
      .update(tripSegments)
      .set({
        originName: dest.name,
        originLat: dest.lat.toString(),
        originLng: dest.lng.toString(),
        ...(routed
          ? {
              routePolyline: routed.polyline,
              distanceMiles: routed.miles.toString(),
              durationMinutes: routed.minutes,
            }
          : {}),
      })
      .where(eq(tripSegments.id, next.id));
  }

  // biome-ignore lint/suspicious/noExplicitAny: partial drizzle update
  const pinUpdate: Record<string, any> = {};
  if (p.name != null) pinUpdate.title = p.name;
  if (moved) {
    pinUpdate.lat = dest.lat.toString();
    pinUpdate.lng = dest.lng.toString();
  }
  if (p.kind != null) pinUpdate.type = kindToPinType(p.kind);
  if (p.note != null) pinUpdate.notes = p.note;
  if (Object.keys(pinUpdate).length > 0) {
    await db
      .update(pins)
      .set(pinUpdate)
      .where(and(eq(pins.tripId, p.tripId), eq(pins.segmentId, p.segmentId)));
  }

  return { ok: true as const };
}

/** Returns null if the stop wasn't found. */
export async function deleteStopOp(
  db: Db,
  p: { tripId: string; segmentId: string },
) {
  const segments = await loadSegments(db, p.tripId);
  if (!segments.some((s) => s.id === p.segmentId)) return null;

  const heal = planHeal(segments, p.segmentId);

  await db.delete(tripSegments).where(eq(tripSegments.id, p.segmentId));

  if (heal?.next) {
    const nextDest =
      heal.next.destinationLat != null && heal.next.destinationLng != null
        ? {
            lat: Number(heal.next.destinationLat),
            lng: Number(heal.next.destinationLng),
          }
        : null;
    if (heal.newOrigin && nextDest) {
      const routed = await routeLeg(heal.newOrigin, nextDest);
      await db
        .update(tripSegments)
        .set({
          originName: heal.newOrigin.name,
          originLat: heal.newOrigin.lat.toString(),
          originLng: heal.newOrigin.lng.toString(),
          ...(routed
            ? {
                routePolyline: routed.polyline,
                distanceMiles: routed.miles.toString(),
                durationMinutes: routed.minutes,
              }
            : {}),
        })
        .where(eq(tripSegments.id, heal.next.id));
    } else if (nextDest) {
      await db
        .update(tripSegments)
        .set({
          originName: heal.next.destinationName ?? "Trip start",
          originLat: nextDest.lat.toString(),
          originLng: nextDest.lng.toString(),
          routePolyline: null,
          distanceMiles: "0",
          durationMinutes: null,
        })
        .where(eq(tripSegments.id, heal.next.id));
    }
  }

  const remaining = segments
    .filter((s) => s.id !== p.segmentId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i]!.sortOrder !== i) {
      await db
        .update(tripSegments)
        .set({ sortOrder: i })
        .where(eq(tripSegments.id, remaining[i]!.id));
    }
  }

  return { ok: true as const, remaining: remaining.length };
}
