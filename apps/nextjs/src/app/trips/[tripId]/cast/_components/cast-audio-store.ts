/**
 * IndexedDB blob cache for Corridor Cast episodes — the best-effort in-app
 * offline path (eng-review Issue 6). The GUARANTEE is Download MP3 to the
 * Files app; this cache lets the in-app player work offline whenever the app
 * shell itself loads, with native seek via `URL.createObjectURL` (no service
 * worker, no Range/206 handling).
 */

const DB_NAME = "corridor-cast";
const STORE = "episodes";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IDB open failed"));
  });
}

export async function getCachedEpisodeAudio(
  episodeId: string,
): Promise<Blob | null> {
  const db = await openDb();
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(episodeId);
      request.onsuccess = () =>
        resolve(request.result instanceof Blob ? request.result : null);
      request.onerror = () =>
        reject(request.error ?? new Error("IDB read failed"));
    });
  } finally {
    db.close();
  }
}

export async function putCachedEpisodeAudio(
  episodeId: string,
  blob: Blob,
): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(blob, episodeId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IDB write failed"));
    });
  } finally {
    db.close();
  }
}

export async function listCachedEpisodeIds(): Promise<string[]> {
  const db = await openDb();
  try {
    return await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).getAllKeys();
      request.onsuccess = () => resolve(request.result.map(String));
      request.onerror = () =>
        reject(request.error ?? new Error("IDB keys failed"));
    });
  } finally {
    db.close();
  }
}
