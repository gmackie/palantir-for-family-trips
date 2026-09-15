import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The store is a thin wrapper over IndexedDB; what matters is the key scheme,
 * because that is what stops one account reading another's trip audio on a
 * shared browser. These tests exercise the scheme against an in-memory fake.
 */

type Rec = Map<string, unknown>;

/** Minimal IndexedDB stand-in: one object store, synchronous under the hood. */
function fakeIndexedDb(seed: Rec = new Map()) {
  const data = seed;
  const req = <T>(result: T) => {
    const r: {
      result: T;
      onsuccess: (() => void) | null;
      onerror: (() => void) | null;
    } = { result, onsuccess: null, onerror: null };
    queueMicrotask(() => r.onsuccess?.());
    return r;
  };

  const store = {
    get: (key: string) => req(data.get(key)),
    getAllKeys: () => req([...data.keys()]),
    put: (value: unknown, key: string) => {
      data.set(key, value);
      return req(undefined);
    },
    delete: (key: string) => {
      data.delete(key);
      return req(undefined);
    },
  };

  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => {
      const tx: {
        objectStore: () => typeof store;
        oncomplete: (() => void) | null;
        onerror: (() => void) | null;
        error: unknown;
      } = {
        objectStore: () => store,
        oncomplete: null,
        onerror: null,
        error: null,
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    },
    close: () => {},
  };

  return {
    data,
    indexedDB: {
      open: () => {
        const r: {
          result: typeof db;
          onsuccess: (() => void) | null;
          onerror: (() => void) | null;
          onupgradeneeded: (() => void) | null;
        } = {
          result: db,
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
        };
        queueMicrotask(() => r.onsuccess?.());
        return r;
      },
    },
  };
}

const ALICE = "user_alice";
const BOB = "user_bob";
const EPISODE = "ep_1";

let store: typeof import("../cast-audio-store");

async function withData(seed: Rec) {
  const fake = fakeIndexedDb(seed);
  vi.stubGlobal("indexedDB", fake.indexedDB);
  store = await import("../cast-audio-store");
  return fake;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("cast audio cache scoping", () => {
  it("round-trips a blob for the owning user", async () => {
    const fake = await withData(new Map());
    const blob = new Blob(["audio"]);

    await store.putCachedEpisodeAudio(ALICE, EPISODE, blob);
    expect([...fake.data.keys()]).toEqual([`${ALICE}:${EPISODE}`]);
    await expect(store.getCachedEpisodeAudio(ALICE, EPISODE)).resolves.toBe(
      blob,
    );
  });

  it("does not serve one user's episode to another", async () => {
    await withData(new Map([[`${ALICE}:${EPISODE}`, new Blob(["audio"])]]));
    // The whole point: same origin, same episode id, different account.
    await expect(store.getCachedEpisodeAudio(BOB, EPISODE)).resolves.toBeNull();
    await expect(store.listCachedEpisodeIds(BOB)).resolves.toEqual([]);
  });

  it("lists only the caller's episodes", async () => {
    await withData(
      new Map<string, unknown>([
        [`${ALICE}:ep_1`, new Blob(["a"])],
        [`${ALICE}:ep_2`, new Blob(["b"])],
        [`${BOB}:ep_3`, new Blob(["c"])],
      ]),
    );
    await expect(store.listCachedEpisodeIds(ALICE)).resolves.toEqual([
      "ep_1",
      "ep_2",
    ]);
  });

  it("evicts other users' blobs, and legacy unscoped keys with them", async () => {
    const fake = await withData(
      new Map<string, unknown>([
        [`${ALICE}:ep_1`, new Blob(["a"])],
        [`${BOB}:ep_2`, new Blob(["b"])],
        // Written before scoping existed: belongs to nobody, readable by
        // nobody, and must not linger on a shared machine.
        ["ep_legacy", new Blob(["old"])],
      ]),
    );

    await store.evictForeignEpisodeAudio(ALICE);
    expect([...fake.data.keys()]).toEqual([`${ALICE}:ep_1`]);
  });

  it("an episode id containing the separator still resolves to its owner", async () => {
    const fake = await withData(new Map());
    await store.putCachedEpisodeAudio(ALICE, "ep:with:colons", new Blob(["x"]));
    await expect(store.listCachedEpisodeIds(ALICE)).resolves.toEqual([
      "ep:with:colons",
    ]);
    await store.evictForeignEpisodeAudio(ALICE);
    expect(fake.data.size).toBe(1);
  });
});
