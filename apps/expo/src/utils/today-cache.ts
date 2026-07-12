/**
 * Read-only offline snapshot of Today Command for weak cell service.
 * Mutations still require network.
 */
import * as FileSystem from "expo-file-system/legacy";

const DIR = `${FileSystem.documentDirectory ?? ""}sortey-cache/`;

function keyPath(tripId: string, date: string): string {
  const safe = `${tripId}_${date}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${DIR}today_${safe}.json`;
}

export async function saveTodaySnapshot(
  tripId: string,
  date: string,
  payload: unknown,
): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
    }
    await FileSystem.writeAsStringAsync(
      keyPath(tripId, date),
      JSON.stringify({ savedAt: new Date().toISOString(), payload }),
    );
  } catch {
    // best-effort
  }
}

export async function loadTodaySnapshot<T>(
  tripId: string,
  date: string,
): Promise<{ savedAt: string; payload: T } | null> {
  try {
    const path = keyPath(tripId, date);
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(path);
    const parsed = JSON.parse(raw) as { savedAt: string; payload: T };
    return parsed;
  } catch {
    return null;
  }
}
