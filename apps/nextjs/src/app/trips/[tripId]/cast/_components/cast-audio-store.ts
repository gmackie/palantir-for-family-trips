/**
 * IndexedDB blob cache for Corridor Cast episodes — the best-effort in-app
 * offline path (eng-review Issue 6). The GUARANTEE is Download MP3 to the
 * Files app; this cache lets the in-app player work offline whenever the app
 * shell itself loads, with native seek via `URL.createObjectURL` (no service
 * worker, no Range/206 handling).
 *
 * Entries are keyed `<userId>:<episodeId>` and any entry belonging to another
 * user is purged on first access. Scoping beats evicting on sign-out: this
 * store is origin-scoped, and sign-out is only one of the ways a browser
 * changes hands — a session can also expire, be revoked, or be dropped in
 * another tab, and none of those fire a hook here. Keying by user means a
 * later account cannot read the earlier one's trip audio even if no eviction
 * ever runs.
 */

const DB_NAME = "corridor-cast";
const STORE = "episodes";
const SEP = ":";

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

function cacheKey(userId: string, episodeId: string): string {
  return `${userId}${SEP}${episodeId}`;
}

/** Episode id if this key belongs to `userId`, else null. */
function episodeIdForUser(key: string, userId: string): string | null {
  const prefix = `${userId}${SEP}`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

/**
 * Drop every entry that is not this user's — including legacy unprefixed keys
 * written before scoping existed, which belong to nobody and are unreadable.
 */
export async function evictForeignEpisodeAudio(userId: string): Promise<void> {
  const db = await openDb();
  try {
    const keys = await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).getAllKeys();
      request.onsuccess = () => resolve(request.result.map(String));
      request.onerror = () =>
        reject(request.error ?? new Error("IDB keys failed"));
    });

    const foreign = keys.filter((key) => episodeIdForUser(key, userId) == null);
    if (foreign.length === 0) return;

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const key of foreign) store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IDB evict failed"));
    });
  } finally {
    db.close();
  }
}

export async function getCachedEpisodeAudio(
  userId: string,
  episodeId: string,
): Promise<Blob | null> {
  const db = await openDb();
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(cacheKey(userId, episodeId));
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
  userId: string,
  episodeId: string,
  blob: Blob,
): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(blob, cacheKey(userId, episodeId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IDB write failed"));
    });
  } finally {
    db.close();
  }
}

/** Episode ids this user has cached. Other users' entries are never listed. */
export async function listCachedEpisodeIds(userId: string): Promise<string[]> {
  const db = await openDb();
  try {
    const keys = await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).getAllKeys();
      request.onsuccess = () => resolve(request.result.map(String));
      request.onerror = () =>
        reject(request.error ?? new Error("IDB keys failed"));
    });
    return keys
      .map((key) => episodeIdForUser(key, userId))
      .filter((id): id is string => id != null);
  } finally {
    db.close();
  }
}
