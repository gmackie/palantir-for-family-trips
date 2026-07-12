/**
 * Trip Day persistence — CRUD over `trip_day`, shared by the planner router.
 */

import { and, asc, eq, gte, lte } from "@sortey/db";
import { tripDays } from "@sortey/db/schema";

import {
  eachDateInclusive,
  type DayBlock,
  type DayIntent,
  type DayPlanDraft,
  type OvernightKind,
} from "./day-plan";

export interface TripDayRow {
  id: string;
  tripId: string;
  date: string;
  intent: string;
  title: string | null;
  overnightName: string | null;
  overnightKind: string | null;
  overnightLat: string | null;
  overnightLng: string | null;
  heroTitle: string | null;
  heroDetail: string | null;
  cutIfBehind: string | null;
  blocksJson: DayBlock[] | null;
  segmentId: string | null;
  sortOrder: number;
  note: string | null;
  status: string;
  completedAt: Date | null;
  actualNote: string | null;
}

const SELECT = {
  id: tripDays.id,
  tripId: tripDays.tripId,
  date: tripDays.date,
  intent: tripDays.intent,
  title: tripDays.title,
  overnightName: tripDays.overnightName,
  overnightKind: tripDays.overnightKind,
  overnightLat: tripDays.overnightLat,
  overnightLng: tripDays.overnightLng,
  heroTitle: tripDays.heroTitle,
  heroDetail: tripDays.heroDetail,
  cutIfBehind: tripDays.cutIfBehind,
  blocksJson: tripDays.blocksJson,
  segmentId: tripDays.segmentId,
  sortOrder: tripDays.sortOrder,
  note: tripDays.note,
  status: tripDays.status,
  completedAt: tripDays.completedAt,
  actualNote: tripDays.actualNote,
};

export async function listDays(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  tripId: string,
): Promise<TripDayRow[]> {
  return (await db
    .select(SELECT)
    .from(tripDays)
    .where(eq(tripDays.tripId, tripId))
    .orderBy(asc(tripDays.date))) as TripDayRow[];
}

export type DayStatus =
  | "planned"
  | "active"
  | "done"
  | "skipped"
  | "partial";

export interface UpsertDayInput {
  tripId: string;
  date: string;
  intent?: DayIntent;
  title?: string | null;
  overnightName?: string | null;
  overnightKind?: OvernightKind | null;
  overnightLat?: number | null;
  overnightLng?: number | null;
  heroTitle?: string | null;
  heroDetail?: string | null;
  cutIfBehind?: string | null;
  blocks?: DayBlock[] | null;
  segmentId?: string | null;
  note?: string | null;
  sortOrder?: number;
  status?: DayStatus;
  actualNote?: string | null;
}

export async function upsertDay(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  p: UpsertDayInput,
): Promise<{ id: string }> {
  const existing = (await db
    .select({ id: tripDays.id })
    .from(tripDays)
    .where(and(eq(tripDays.tripId, p.tripId), eq(tripDays.date, p.date)))
    .limit(1)) as Array<{ id: string }>;

  const values: Record<string, unknown> = {
    intent: p.intent ?? "drive",
    title: p.title ?? null,
    overnightName: p.overnightName ?? null,
    overnightKind: p.overnightKind ?? null,
    overnightLat:
      p.overnightLat != null ? p.overnightLat.toString() : null,
    overnightLng:
      p.overnightLng != null ? p.overnightLng.toString() : null,
    heroTitle: p.heroTitle ?? null,
    heroDetail: p.heroDetail ?? null,
    cutIfBehind: p.cutIfBehind ?? null,
    blocksJson: p.blocks ?? null,
    segmentId: p.segmentId ?? null,
    note: p.note ?? null,
    sortOrder: p.sortOrder ?? 0,
  };
  if (p.status != null) {
    values.status = p.status;
    values.completedAt =
      p.status === "done" || p.status === "partial" || p.status === "skipped"
        ? new Date()
        : null;
  }
  if (p.actualNote !== undefined) {
    values.actualNote = p.actualNote;
  }

  if (existing[0]) {
    await db
      .update(tripDays)
      .set(values)
      .where(eq(tripDays.id, existing[0].id));
    return { id: existing[0].id };
  }

  const [row] = (await db
    .insert(tripDays)
    .values({
      tripId: p.tripId,
      date: p.date,
      ...values,
    })
    .returning({ id: tripDays.id })) as Array<{ id: string }>;
  return row!;
}

export async function deleteDay(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  p: { tripId: string; dayId: string },
): Promise<void> {
  await db
    .delete(tripDays)
    .where(and(eq(tripDays.id, p.dayId), eq(tripDays.tripId, p.tripId)));
}

/** Insert missing days in [fromDate, untilDate]; leave existing rows alone. */
export async function seedRange(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  p: {
    tripId: string;
    fromDate: string;
    untilDate: string;
    defaultIntent?: DayIntent;
  },
): Promise<{ created: number }> {
  const dates = eachDateInclusive(p.fromDate, p.untilDate);
  const existing = await listDays(db, p.tripId);
  const have = new Set(existing.map((d) => d.date));
  let created = 0;
  let order = existing.length;
  for (const date of dates) {
    if (have.has(date)) continue;
    await upsertDay(db, {
      tripId: p.tripId,
      date,
      intent: p.defaultIntent ?? "drive",
      sortOrder: order++,
    });
    created++;
  }
  return { created };
}

/** Upsert every draft day (overwrites intent/overnight/hero in range). */
export async function applyDraft(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  p: { tripId: string; days: DayPlanDraft[] },
): Promise<{ upserted: number }> {
  let upserted = 0;
  for (let i = 0; i < p.days.length; i++) {
    const d = p.days[i]!;
    await upsertDay(db, {
      tripId: p.tripId,
      date: d.date,
      intent: d.intent,
      title: d.title,
      overnightName: d.overnightName,
      overnightKind: d.overnightKind,
      heroTitle: d.heroTitle,
      heroDetail: d.heroDetail,
      cutIfBehind: d.cutIfBehind,
      blocks: d.blocks,
      note: d.note,
      sortOrder: i,
    });
    upserted++;
  }
  return { upserted };
}

export async function deleteDaysInRange(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  p: { tripId: string; fromDate: string; untilDate: string },
): Promise<void> {
  await db
    .delete(tripDays)
    .where(
      and(
        eq(tripDays.tripId, p.tripId),
        gte(tripDays.date, p.fromDate),
        lte(tripDays.date, p.untilDate),
      ),
    );
}
