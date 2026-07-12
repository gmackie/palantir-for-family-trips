/**
 * Journey-logging operations, shared by the `journey` tRPC router and the
 * `journey` CLI so agents and the app behave identically. These take a Drizzle
 * `db` (or transaction) and plain params — no trpc context — and assume the
 * caller has already authorized access to the trip.
 */

import { and, eq } from "@sortey/db";
import {
  type JourneyRouteStatus,
  type JourneyStopKind,
  journeyStops,
  pins,
  tripSegments,
} from "@sortey/db/schema";

import {
  fallbackMiles,
  kindToPinType,
  planHeal,
  resolveRecordedPrevPoint,
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

type RouteLeg = typeof routeLeg;

export interface JourneyStore {
  transaction<T>(operation: (store: JourneyStore) => Promise<T>): Promise<T>;
  findStop(
    tripId: string,
    stopId: string,
  ): Promise<{
    id: string;
    segmentId: string;
    routeStatus: JourneyRouteStatus;
  } | null>;
  listRecordedChain(tripId: string): Promise<
    Array<{
      stop: { id: string; segmentId: string; sortOrder: number };
      segment: SegmentLike;
    }>
  >;
  nextSegmentSortOrder(tripId: string): Promise<number>;
  insertSegment(values: {
    tripId: string;
    name: string;
    originName: string;
    originLat: string;
    originLng: string;
    destinationName: string;
    destinationLat: string;
    destinationLng: string;
    routePolyline: string | null;
    distanceMiles: string;
    durationMinutes: number | null;
    tz: string;
    startDate: string;
    sortOrder: number;
  }): Promise<{ id: string }>;
  insertStop(values: {
    id: string;
    tripId: string;
    segmentId: string;
    sortOrder: number;
    kind: JourneyStopKind;
    arrivedAt: Date;
    note: string | null;
    routeStatus: JourneyRouteStatus;
    createdByUserId: string;
  }): Promise<unknown>;
  insertPin(values: {
    tripId: string;
    segmentId: string;
    title: string;
    lat: string;
    lng: string;
    type: ReturnType<typeof kindToPinType>;
    notes: string | null;
    createdByUserId: string;
  }): Promise<unknown>;
}

function isJourneyStore(value: Db | JourneyStore): value is JourneyStore {
  return typeof value?.findStop === "function";
}

export function createJourneyStore(db: Db): JourneyStore {
  const store: JourneyStore = {
    transaction: (operation) =>
      db.transaction((tx: Db) => operation(createJourneyStore(tx))),
    async findStop(tripId, stopId) {
      const [row] = await db
        .select({
          id: journeyStops.id,
          segmentId: journeyStops.segmentId,
          routeStatus: journeyStops.routeStatus,
        })
        .from(journeyStops)
        .where(
          and(eq(journeyStops.tripId, tripId), eq(journeyStops.id, stopId)),
        )
        .limit(1);
      return row ?? null;
    },
    async listRecordedChain(tripId) {
      return db
        .select({
          stop: {
            id: journeyStops.id,
            segmentId: journeyStops.segmentId,
            sortOrder: journeyStops.sortOrder,
          },
          segment: SEGMENT_COLUMNS,
        })
        .from(journeyStops)
        .innerJoin(tripSegments, eq(tripSegments.id, journeyStops.segmentId))
        .where(eq(journeyStops.tripId, tripId));
    },
    async nextSegmentSortOrder(tripId) {
      const rows = (await db
        .select({ sortOrder: tripSegments.sortOrder })
        .from(tripSegments)
        .where(eq(tripSegments.tripId, tripId))) as Array<{
        sortOrder: number;
      }>;
      return rows.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
    },
    async insertSegment(values) {
      const [row] = await db
        .insert(tripSegments)
        .values(values)
        .returning({ id: tripSegments.id });
      if (!row) throw new Error("Failed to create journey segment.");
      return row;
    },
    insertStop: (values) => db.insert(journeyStops).values(values),
    insertPin: (values) => db.insert(pins).values(values),
  };
  return store;
}

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
  stopId: string;
  tripId: string;
  userId: string;
  name: string;
  lat: number;
  lng: number;
  arrivedAt: Date;
  kind: StopKind;
  note?: string;
  tz?: string;
}

export async function logStopOp(
  dbOrStore: Db | JourneyStore,
  p: LogStopParams,
  routeLegImpl: RouteLeg = routeLeg,
) {
  const store = isJourneyStore(dbOrStore)
    ? dbOrStore
    : createJourneyStore(dbOrStore);
  const existing = await store.findStop(p.tripId, p.stopId);
  if (existing) {
    return {
      stopId: existing.id,
      segmentId: existing.segmentId,
      miles: 0,
      routed: existing.routeStatus === "ready",
      routeStatus: existing.routeStatus,
    };
  }

  return store.transaction(async (tx) => {
    const raced = await tx.findStop(p.tripId, p.stopId);
    if (raced) {
      return {
        stopId: raced.id,
        segmentId: raced.segmentId,
        miles: 0,
        routed: raced.routeStatus === "ready",
        routeStatus: raced.routeStatus,
      };
    }

    const chain = await tx.listRecordedChain(p.tripId);
    const segments = chain.map((row) => row.segment);
    const stops = chain.map((row) => row.stop);
    const stop = { lat: p.lat, lng: p.lng, name: p.name };
    const prev = resolveRecordedPrevPoint(stops, segments);
    const origin = prev ?? stop;
    const tz = p.tz ?? DEFAULT_TZ;
    const routed = prev ? await routeLegImpl(prev, stop) : null;
    const miles = routed?.miles ?? (prev ? fallbackMiles(prev, stop) : 0);
    const routeStatus: JourneyRouteStatus =
      prev && !routed ? "pending" : "ready";
    const segment = await tx.insertSegment({
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
      startDate: todayInTz(tz),
      sortOrder: await tx.nextSegmentSortOrder(p.tripId),
    });
    const stopSortOrder =
      stops.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
    await tx.insertStop({
      id: p.stopId,
      tripId: p.tripId,
      segmentId: segment.id,
      sortOrder: stopSortOrder,
      kind: p.kind,
      arrivedAt: p.arrivedAt,
      note: p.note ?? null,
      routeStatus,
      createdByUserId: p.userId,
    });
    await tx.insertPin({
      tripId: p.tripId,
      segmentId: segment.id,
      title: stop.name,
      lat: stop.lat.toString(),
      lng: stop.lng.toString(),
      type: kindToPinType(p.kind),
      notes: p.note ?? null,
      createdByUserId: p.userId,
    });
    return {
      stopId: p.stopId,
      segmentId: segment.id,
      miles,
      routed: routed != null || prev == null,
      routeStatus,
    };
  });
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
export async function updateStopOp(
  db: Db,
  p: UpdateStopParams,
  routeLegImpl: RouteLeg = routeLeg,
  inTransaction = false,
) {
  if (!inTransaction && typeof db.transaction === "function") {
    return db.transaction((tx: Db) => updateStopOp(tx, p, routeLegImpl, true));
  }
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
      const routed = await routeLegImpl(
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
    const routed = nextDest ? await routeLegImpl(dest, nextDest) : null;
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
  routeLegImpl: RouteLeg = routeLeg,
  inTransaction = false,
) {
  if (!inTransaction && typeof db.transaction === "function") {
    return db.transaction((tx: Db) => deleteStopOp(tx, p, routeLegImpl, true));
  }
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
      const routed = await routeLegImpl(heal.newOrigin, nextDest);
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
