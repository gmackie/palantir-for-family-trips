import {
  resolveTripTimezone,
  tripCalendarDay,
} from "@sortey/validators/trip-day";
import { z } from "zod";

const indexSchema = z.object({ schemaVersion: z.literal(1), tz: z.string() });
const identitySchema = z.object({ date: z.string(), tz: z.string() });

export function encodeTodayCacheTimezone(tz: string): string {
  return JSON.stringify({ schemaVersion: 1, tz: resolveTripTimezone(tz) });
}

export function resolveTodayCacheDay(
  raw: string,
  now: Date,
): { date: string; tz: string } {
  const index = indexSchema.parse(JSON.parse(raw));
  const tz = resolveTripTimezone(index.tz);
  return { date: tripCalendarDay(now, tz), tz };
}

export function todayCacheIdentityMatches(
  raw: string,
  date: string,
  tz: string,
): boolean {
  const snapshot = z.object({ payload: identitySchema }).parse(JSON.parse(raw));
  return snapshot.payload.date === date && snapshot.payload.tz === tz;
}

export interface TodayCacheStorage {
  getInfoAsync(path: string): Promise<{ exists: boolean }>;
  makeDirectoryAsync(
    path: string,
    options: { intermediates: boolean },
  ): Promise<void>;
  readAsStringAsync(path: string): Promise<string>;
  writeAsStringAsync(path: string, content: string): Promise<void>;
}

function snapshotPath(dir: string, tripId: string, date: string): string {
  const safe = `${tripId}_${date}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${dir}today_${safe}.json`;
}

export async function writeTodayCache(
  storage: TodayCacheStorage,
  dir: string,
  tripId: string,
  date: string,
  tz: string,
  raw: string,
): Promise<void> {
  if (!todayCacheIdentityMatches(raw, date, resolveTripTimezone(tz))) {
    throw new Error("Today cache identity does not match its key");
  }
  if (!(await storage.getInfoAsync(dir)).exists) {
    await storage.makeDirectoryAsync(dir, { intermediates: true });
  }
  await storage.writeAsStringAsync(snapshotPath(dir, tripId, date), raw);
  await storage.writeAsStringAsync(
    snapshotPath(dir, tripId, "timezone-v1"),
    encodeTodayCacheTimezone(tz),
  );
}

export async function readTodayCache(
  storage: TodayCacheStorage,
  dir: string,
  tripId: string,
  now: Date,
): Promise<string | null> {
  const indexPath = snapshotPath(dir, tripId, "timezone-v1");
  if (!(await storage.getInfoAsync(indexPath)).exists) return null;
  const { date, tz } = resolveTodayCacheDay(
    await storage.readAsStringAsync(indexPath),
    now,
  );
  const path = snapshotPath(dir, tripId, date);
  if (!(await storage.getInfoAsync(path)).exists) return null;
  const raw = await storage.readAsStringAsync(path);
  return todayCacheIdentityMatches(raw, date, tz) ? raw : null;
}
