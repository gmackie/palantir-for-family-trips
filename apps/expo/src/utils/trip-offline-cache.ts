/**
 * Per-trip offline bundle: driving summary, segments, zones, today command.
 * File-backed (same approach as today-cache) so large JSON fits outside SecureStore.
 */
import * as FileSystem from "expo-file-system/legacy";

const DIR = `${FileSystem.documentDirectory ?? ""}sortey-cache/`;

export interface TripOfflineBundle {
  downloadedAt: string;
  tripId: string;
  workspaceId: string;
  drivingSummary?: unknown;
  segments?: unknown;
  predictZones?: unknown;
  routePreview?: unknown;
  todayCommand?: unknown;
  dayPlan?: unknown;
}

function tripPath(tripId: string): string {
  const safe = tripId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${DIR}trip_${safe}.json`;
}

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
  }
}

export async function saveTripOfflineBundle(
  bundle: TripOfflineBundle,
): Promise<void> {
  try {
    await ensureDir();
    await FileSystem.writeAsStringAsync(
      tripPath(bundle.tripId),
      JSON.stringify(bundle),
    );
  } catch {
    // best-effort
  }
}

export async function loadTripOfflineBundle(
  tripId: string,
): Promise<TripOfflineBundle | null> {
  try {
    const path = tripPath(tripId);
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(path);
    return JSON.parse(raw) as TripOfflineBundle;
  } catch {
    return null;
  }
}

export async function tripOfflineBundleMeta(
  tripId: string,
): Promise<{ downloadedAt: string } | null> {
  const bundle = await loadTripOfflineBundle(tripId);
  if (!bundle?.downloadedAt) return null;
  return { downloadedAt: bundle.downloadedAt };
}
