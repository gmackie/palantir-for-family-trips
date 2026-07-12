/**
 * Assemble Today Command payload for mobile/web — one round-trip.
 */

import { asc, eq } from "@sortey/db";
import { tripSegments, trips } from "@sortey/db/schema";
import SunCalc from "suncalc";

import { haversineMiles } from "../trips/driving-summary";
import { listAnchors } from "./anchor-ops";
import type { TripDayRow } from "./day-plan-ops";
import { listDays } from "./day-plan-ops";
import {
  computeLeaveBy,
  desiredArrivalFromSunset,
  formatLocalHm,
} from "./leave-by";
import { assessSideTrip } from "./side-trip";
import { scanTripAmenities } from "./poi-suggest-ops";

export interface TodayCommandResult {
  date: string;
  tz: string;
  day: TripDayRow | null;
  dayStatus: string;
  runState: string;
  runStateNote: string | null;
  nextAnchor: {
    title: string;
    startDate: string;
    endDate: string | null;
    kind: string;
    daysAway: number;
  } | null;
  leaveBy: {
    target: string;
    leaveByLocal: string;
    reason: string;
    minutesSlack: number;
    late: boolean;
    driveHours: number;
  } | null;
  amenities: Awaited<ReturnType<typeof scanTripAmenities>>[number] | null;
  tomorrow: {
    date: string;
    title: string | null;
    intent: string;
    overnightName: string | null;
    driveMilesEstimate: number | null;
  } | null;
  sideTrip: ReturnType<typeof assessSideTrip> | null;
  actions: {
    canReplan: boolean;
    canMarkDone: boolean;
    navigateOvernight: { lat: number; lng: number; label: string } | null;
    navigateFuel: { lat: number; lng: number; label: string } | null;
  };
}

function dayDiff(from: string, to: string): number {
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export async function getTodayCommand(
  // biome-ignore lint/suspicious/noExplicitAny: db
  db: any,
  p: {
    tripId: string;
    workspaceId: string;
    date?: string;
    lat?: number;
    lng?: number;
    now?: Date;
  },
): Promise<TodayCommandResult> {
  const now = p.now ?? new Date();
  const date = p.date ?? now.toISOString().slice(0, 10);

  const [trip] = (await db
    .select({
      tz: trips.tz,
      runState: trips.runState,
      runStateNote: trips.runStateNote,
    })
    .from(trips)
    .where(eq(trips.id, p.tripId))
    .limit(1)) as Array<{
    tz: string;
    runState: string;
    runStateNote: string | null;
  }>;

  const tz = trip?.tz ?? "America/Los_Angeles";
  const days = await listDays(db, p.tripId);
  const day = days.find((d) => d.date === date) ?? null;
  const tomorrowDate = new Date(`${date}T12:00:00Z`);
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
  const tomorrowStr = tomorrowDate.toISOString().slice(0, 10);
  const tomorrowDay = days.find((d) => d.date === tomorrowStr) ?? null;

  const anchors = await listAnchors(db, p.tripId);
  const nextAnchorRow = anchors.find(
    (a) => (a.startDate as string) >= date,
  ) as
    | {
        title: string;
        startDate: string;
        endDate: string | null;
        kind: string;
        lat: string | null;
        lng: string | null;
      }
    | undefined;

  // Miles remaining today: sum segments starting today, else haversine to overnight
  const segs = (await db
    .select({
      startDate: tripSegments.startDate,
      distanceMiles: tripSegments.distanceMiles,
      destinationLat: tripSegments.destinationLat,
      destinationLng: tripSegments.destinationLng,
      originLat: tripSegments.originLat,
      originLng: tripSegments.originLng,
      routePolyline: tripSegments.routePolyline,
    })
    .from(tripSegments)
    .where(eq(tripSegments.tripId, p.tripId))
    .orderBy(asc(tripSegments.sortOrder))) as Array<{
    startDate: string | null;
    distanceMiles: string | null;
    destinationLat: string | null;
    destinationLng: string | null;
    originLat: string | null;
    originLng: string | null;
    routePolyline: string | null;
  }>;

  const todaySegMiles = segs
    .filter((s) => s.startDate === date)
    .reduce((sum, s) => sum + (s.distanceMiles != null ? Number(s.distanceMiles) : 0), 0);

  let milesRemaining = todaySegMiles;
  if (milesRemaining <= 0 && day?.overnightLat != null && p.lat != null && p.lng != null) {
    milesRemaining =
      Math.round(
        haversineMiles(
          { lat: p.lat, lng: p.lng },
          { lat: Number(day.overnightLat), lng: Number(day.overnightLng) },
        ) * 1.3 *
          10,
      ) / 10;
  }

  let leaveBy: TodayCommandResult["leaveBy"] = null;
  const targetLat =
    day?.overnightLat != null
      ? Number(day.overnightLat)
      : nextAnchorRow?.lat != null
        ? Number(nextAnchorRow.lat)
        : null;
  const targetLng =
    day?.overnightLng != null
      ? Number(day.overnightLng)
      : nextAnchorRow?.lng != null
        ? Number(nextAnchorRow.lng)
        : null;

  if (milesRemaining > 0 || (targetLat != null && targetLng != null)) {
    let sunset: Date | null = null;
    if (targetLat != null && targetLng != null) {
      const times = SunCalc.getTimes(
        new Date(`${date}T12:00:00Z`),
        targetLat,
        targetLng,
      );
      sunset = times.sunset ?? null;
    }
    const desired = desiredArrivalFromSunset(sunset, date);
    const computed = computeLeaveBy({
      milesRemaining: milesRemaining > 0 ? milesRemaining : 50,
      now,
      desiredArrival: desired,
      bufferHours: 0.5,
      avgMph: 45,
    });
    leaveBy = {
      target: day?.overnightName ?? nextAnchorRow?.title ?? "tonight",
      leaveByLocal: formatLocalHm(computed.leaveBy, tz),
      reason: `${computed.reason} · aim before dark at ${leaveByTargetLabel(day, nextAnchorRow)}`,
      minutesSlack: computed.minutesSlack,
      late: computed.late,
      driveHours: computed.driveHours,
    };
  }

  let amenities: TodayCommandResult["amenities"] = null;
  try {
    const scan = await scanTripAmenities(db, {
      tripId: p.tripId,
      workspaceId: p.workspaceId,
      maxMiles: 25,
    });
    amenities = scan.find((r) => r.date === date) ?? null;
  } catch {
    amenities = null;
  }

  // Side trip if GPS + route
  let sideTrip: TodayCommandResult["sideTrip"] = null;
  if (p.lat != null && p.lng != null) {
    const points: Array<{ lat: number; lng: number }> = [];
    for (const s of segs) {
      if (s.originLat != null && s.originLng != null) {
        points.push({ lat: Number(s.originLat), lng: Number(s.originLng) });
      }
      if (s.destinationLat != null && s.destinationLng != null) {
        points.push({
          lat: Number(s.destinationLat),
          lng: Number(s.destinationLng),
        });
      }
    }
    sideTrip = assessSideTrip({
      position: { lat: p.lat, lng: p.lng },
      routePoints: points,
    });
  }

  const tomorrowSegMiles = segs
    .filter((s) => s.startDate === tomorrowStr)
    .reduce((sum, s) => sum + (s.distanceMiles != null ? Number(s.distanceMiles) : 0), 0);

  const navigateOvernight =
    day?.overnightLat != null && day.overnightLng != null
      ? {
          lat: Number(day.overnightLat),
          lng: Number(day.overnightLng),
          label: day.overnightName ?? "Overnight",
        }
      : null;

  const navigateFuel =
    amenities?.fuel != null
      ? {
          lat: amenities.fuel.lat,
          lng: amenities.fuel.lng,
          label: amenities.fuel.name,
        }
      : null;

  return {
    date,
    tz,
    day,
    dayStatus: day?.status ?? "planned",
    runState: trip?.runState ?? "on_plan",
    runStateNote: trip?.runStateNote ?? null,
    nextAnchor: nextAnchorRow
      ? {
          title: nextAnchorRow.title,
          startDate: nextAnchorRow.startDate,
          endDate: nextAnchorRow.endDate,
          kind: nextAnchorRow.kind,
          daysAway: dayDiff(date, nextAnchorRow.startDate),
        }
      : null,
    leaveBy,
    amenities,
    tomorrow: tomorrowDay
      ? {
          date: tomorrowDay.date,
          title: tomorrowDay.title,
          intent: tomorrowDay.intent,
          overnightName: tomorrowDay.overnightName,
          driveMilesEstimate:
            tomorrowSegMiles > 0 ? Math.round(tomorrowSegMiles) : null,
        }
      : null,
    sideTrip,
    actions: {
      canReplan: true,
      canMarkDone: day != null && day.status !== "done",
      navigateOvernight,
      navigateFuel,
    },
  };
}

function leaveByTargetLabel(
  day: TripDayRow | null,
  anchor:
    | { title: string }
    | undefined,
): string {
  return day?.overnightName ?? anchor?.title ?? "target";
}

export async function setDayStatusOp(
  // biome-ignore lint/suspicious/noExplicitAny: db
  db: any,
  p: {
    tripId: string;
    date: string;
    status: "planned" | "active" | "done" | "skipped" | "partial";
    actualNote?: string | null;
  },
): Promise<{ id: string }> {
  const { upsertDay } = await import("./day-plan-ops");
  const days = await listDays(db, p.tripId);
  const existing = days.find((d) => d.date === p.date);
  return upsertDay(db, {
    tripId: p.tripId,
    date: p.date,
    intent: (existing?.intent as "drive") ?? "drive",
    title: existing?.title,
    overnightName: existing?.overnightName,
    overnightKind: existing?.overnightKind as "unknown" | null,
    overnightLat:
      existing?.overnightLat != null ? Number(existing.overnightLat) : null,
    overnightLng:
      existing?.overnightLng != null ? Number(existing.overnightLng) : null,
    heroTitle: existing?.heroTitle,
    heroDetail: existing?.heroDetail,
    cutIfBehind: existing?.cutIfBehind,
    note: existing?.note,
    sortOrder: existing?.sortOrder ?? 0,
    status: p.status,
    actualNote: p.actualNote,
  });
}

export async function setRunStateOp(
  // biome-ignore lint/suspicious/noExplicitAny: db
  db: any,
  p: {
    tripId: string;
    runState: "on_plan" | "side_trip" | "paused";
    note?: string | null;
  },
): Promise<void> {
  await db
    .update(trips)
    .set({
      runState: p.runState,
      runStateSince: new Date(),
      runStateNote: p.note ?? null,
    })
    .where(eq(trips.id, p.tripId));
}
