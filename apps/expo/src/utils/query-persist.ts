/**
 * Lightweight FileSystem persistence for trip-scoped react-query cache.
 * Avoids a native MMKV dependency (needs rebuild); uses expo-file-system.
 *
 * Persist only keys that look like trip-scoped queries to keep size bounded.
 */
import * as FileSystem from "expo-file-system/legacy";
import type { QueryClient } from "@tanstack/react-query";

const CACHE_PATH = `${FileSystem.documentDirectory ?? ""}sortey-cache/rq-persist-v1.json`;
const MAX_BYTES = 4_000_000; // ~4 MB safety cap

type PersistedBlob = {
  savedAt: string;
  clientState: unknown;
};

function isTripScopedQuery(queryKey: unknown): boolean {
  const raw = JSON.stringify(queryKey);
  // tRPC/react-query keys include path + input; keep trip/workspace heavy reads.
  return (
    raw.includes("tripId") ||
    raw.includes("listSegments") ||
    raw.includes("drivingSummary") ||
    raw.includes("todayCommand") ||
    raw.includes("predictZones") ||
    raw.includes("getRoutePreview") ||
    raw.includes("listDays") ||
    raw.includes("pins")
  );
}

export async function persistQueryClient(client: QueryClient): Promise<void> {
  try {
    const cache = client.getQueryCache().getAll();
    const dehydrated = cache
      .filter((q) => q.state.status === "success" && isTripScopedQuery(q.queryKey))
      .map((q) => ({
        queryKey: q.queryKey,
        state: {
          data: q.state.data,
          dataUpdatedAt: q.state.dataUpdatedAt,
          status: q.state.status,
        },
      }));

    const blob: PersistedBlob = {
      savedAt: new Date().toISOString(),
      clientState: dehydrated,
    };
    const json = JSON.stringify(blob);
    if (json.length > MAX_BYTES) return;

    const dir = `${FileSystem.documentDirectory ?? ""}sortey-cache/`;
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
    await FileSystem.writeAsStringAsync(CACHE_PATH, json);
  } catch {
    // best-effort
  }
}

export async function restoreQueryClient(client: QueryClient): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(CACHE_PATH);
    if (!info.exists) return;
    const raw = await FileSystem.readAsStringAsync(CACHE_PATH);
    const blob = JSON.parse(raw) as PersistedBlob;
    const entries = blob.clientState as Array<{
      queryKey: unknown;
      state: { data: unknown; dataUpdatedAt: number; status: string };
    }>;
    if (!Array.isArray(entries)) return;

    for (const entry of entries) {
      client.setQueryData(entry.queryKey as readonly unknown[], entry.state.data, {
        updatedAt: entry.state.dataUpdatedAt,
      });
    }
  } catch {
    // best-effort
  }
}

/** Debounced persist hook helper — call from app root after mutations/fetches. */
export function schedulePersist(client: QueryClient, delayMs = 2_000): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsub = client.getQueryCache().subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void persistQueryClient(client);
    }, delayMs);
  });
  return () => {
    unsub();
    if (timer) clearTimeout(timer);
  };
}
