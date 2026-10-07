/**
 * Read-only offline snapshot of Today Command for weak cell service.
 * Mutations still require network.
 */
import * as FileSystem from "expo-file-system/legacy";
import { readTodayCache, writeTodayCache } from "./today-cache-day";

const DIR = `${FileSystem.documentDirectory ?? ""}sortey-cache/`;

export async function saveTodaySnapshot(
  tripId: string,
  date: string,
  payload: unknown,
  tz: string,
): Promise<void> {
  try {
    await writeTodayCache(
      FileSystem,
      DIR,
      tripId,
      date,
      tz,
      JSON.stringify({ savedAt: new Date().toISOString(), payload }),
    );
  } catch {
    // best-effort
  }
}

export async function loadTodaySnapshot<T>(
  tripId: string,
  now: Date,
): Promise<{ savedAt: string; payload: T } | null> {
  try {
    const raw = await readTodayCache(FileSystem, DIR, tripId, now);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt: string; payload: T };
    return parsed;
  } catch {
    return null;
  }
}
