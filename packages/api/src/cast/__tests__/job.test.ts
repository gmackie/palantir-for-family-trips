import type { CastCheckpoint, CastScript } from "@sortey/db/schema";
import { describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/gmacko_test";

const { CAST_MAX_ATTEMPTS, runCastPump } = await import("../job");
const { checkpointR2Key, segmentContentHash } = await import("../tts");
const { validMp3 } = await import("./mp3-fixtures");

import type { CastR2Bucket } from "../tts";

type SetValues = Record<string, unknown>;

/**
 * Drizzle-shaped pump db mock: `execute` returns the claim rows, `update`
 * records every `.set()` payload, `insert` records values, `select` consumes
 * a canned queue.
 */
function fakePumpDb(opts: {
  claimRows?: unknown[];
  selectQueue?: unknown[][];
}) {
  const updates: SetValues[] = [];
  const inserts: SetValues[] = [];
  const selectQueue = opts.selectQueue ?? [];

  const db = {
    execute: vi.fn(async () => opts.claimRows ?? []),
    update: vi.fn(() => ({
      set: (values: SetValues) => ({
        where: () => {
          updates.push(values);
          return Promise.resolve([]);
        },
      }),
    })),
    insert: vi.fn(() => ({
      values: (values: SetValues) => {
        inserts.push(values);
        const chain = {
          onConflictDoNothing: () => Promise.resolve([]),
          then: (
            resolve: (rows: unknown[]) => unknown,
            reject: (error: unknown) => unknown,
          ) => Promise.resolve([]).then(resolve, reject),
        };
        return chain;
      },
    })),
    select: vi.fn(() => {
      const rows = selectQueue.shift() ?? [];
      // biome-ignore lint/suspicious/noExplicitAny: test chain stub
      const chain: any = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => Promise.resolve(rows),
      };
      return chain;
    }),
  };

  return { db, updates, inserts };
}

function fakeR2(): CastR2Bucket & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    put: async (key, value) => {
      objects.set(key, new Uint8Array(value as ArrayBuffer));
    },
    get: async (key) => {
      const bytes = objects.get(key);
      if (!bytes) return null;
      return {
        arrayBuffer: async () =>
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer,
      };
    },
    delete: async (key) => {
      if (typeof key === "string") objects.delete(key);
    },
  };
}

const SCRIPT: CastScript = {
  episodeTitle: "Over the Divide",
  outline: [
    { key: "intro", title: "Intro", beats: ["b"], wordTarget: 100 },
    { key: "outro", title: "Outro", beats: ["b"], wordTarget: 100 },
  ],
  segments: [
    { key: "intro", title: "Intro", text: "intro text", wordTarget: 100 },
    { key: "outro", title: "Outro", text: "outro text", wordTarget: 100 },
  ],
};

function claimedJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    tripId: "trip-1",
    targetDate: "2026-07-28",
    durationMinutes: 30,
    status: "pending",
    attemptCount: 0,
    scriptJson: null,
    checkpointsJson: null,
    ttsCharacters: 0,
    ...overrides,
  };
}

const baseDeps = {
  voiceId: () => "voice-1",
  ttsModel: () => "tts-model-1",
  scriptModel: () => "script-model-1",
};

describe("runCastPump", () => {
  it("does nothing when no job is claimable", async () => {
    const { db, updates } = fakePumpDb({ claimRows: [] });
    const result = await runCastPump({ r2: fakeR2(), db });
    expect(result).toEqual({ claimed: false });
    expect(updates).toHaveLength(0);
  });

  it("fails a job that exhausted its attempts (crash-loop backstop)", async () => {
    const { db, updates } = fakePumpDb({
      claimRows: [claimedJob({ attemptCount: CAST_MAX_ATTEMPTS })],
    });
    const result = await runCastPump({ r2: fakeR2(), db });
    expect(result.status).toBe("failed");
    expect(updates[0]).toMatchObject({ status: "failed", claimedAt: null });
  });

  it("pending: no drive leg → terminal failure, no LLM call", async () => {
    const generateScript = vi.fn();
    const { db, updates } = fakePumpDb({ claimRows: [claimedJob()] });
    const result = await runCastPump({
      r2: fakeR2(),
      db,
      deps: {
        ...baseDeps,
        buildContext: vi.fn(async () => ({ hasDriveLeg: false }) as never),
        generateScript,
      },
    });
    expect(result.status).toBe("failed");
    expect(generateScript).not.toHaveBeenCalled();
    expect(updates[0]).toMatchObject({ status: "failed", claimedAt: null });
    expect(String(updates[0]?.error)).toMatch(/No drive leg/);
  });

  it("pending: generates the script and parks it at the read gate", async () => {
    const { db, updates } = fakePumpDb({ claimRows: [claimedJob()] });
    const result = await runCastPump({
      r2: fakeR2(),
      db,
      deps: {
        ...baseDeps,
        buildContext: vi.fn(async () => ({ hasDriveLeg: true }) as never),
        generateScript: vi.fn(async (params: { onUsage?: unknown }) => {
          (params as { onUsage: (u: unknown) => void }).onUsage({
            inputTokens: 100,
            outputTokens: 500,
          });
          return SCRIPT;
        }) as never,
      },
    });
    expect(result.status).toBe("awaiting_approval");
    // The read gate: parked, lease released, NO synthesis attempted.
    expect(updates[0]).toMatchObject({
      status: "awaiting_approval",
      scriptJson: SCRIPT,
      claimedAt: null,
    });
  });

  it("approved: synthesizes, concats, uploads, records the episode, cleans temp", async () => {
    const r2 = fakeR2();
    // Park both segments' audio in R2 as finished checkpoints would.
    const checkpoints: CastCheckpoint[] = SCRIPT.segments.map((segment) => {
      const contentHash = segmentContentHash({
        text: segment.text,
        voiceId: "voice-1",
        ttsModel: "tts-model-1",
      });
      const r2Key = checkpointR2Key("trip-1", contentHash);
      r2.objects.set(r2Key, validMp3(10));
      return {
        segmentKey: segment.key,
        contentHash,
        r2Key,
        sizeBytes: 4170,
        durationSeconds: (10 * 1152) / 44100,
      };
    });

    const { db, updates, inserts } = fakePumpDb({
      claimRows: [claimedJob({ status: "approved", scriptJson: SCRIPT })],
      // runSynthesisStep re-reads accumulated ttsCharacters for the episode row.
      selectQueue: [[{ ttsCharacters: 1234 }]],
    });

    const result = await runCastPump({
      r2,
      db,
      deps: {
        ...baseDeps,
        synthesizeSegments: vi.fn(async () => ({
          checkpoints,
          finished: true,
          charactersBilled: 0,
        })) as never,
      },
    });

    expect(result.status).toBe("complete");
    // approved → synthesizing advance, then the final complete update.
    expect(updates[0]).toMatchObject({ status: "synthesizing" });
    expect(updates.at(-1)).toMatchObject({
      status: "complete",
      claimedAt: null,
    });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      tripId: "trip-1",
      jobId: "job-1",
      title: "Over the Divide",
      voiceId: "voice-1",
      ttsModel: "tts-model-1",
      scriptModel: "script-model-1",
      ttsCharacters: 1234,
    });
    const segmentsJson = inserts[0]?.segmentsJson as Array<{
      title: string;
      startSeconds: number;
    }>;
    expect(segmentsJson).toHaveLength(2);
    expect(segmentsJson[0]).toMatchObject({ title: "Intro", startSeconds: 0 });
    expect(segmentsJson[1]?.startSeconds).toBeCloseTo((10 * 1152) / 44100, 4);

    // Final episode uploaded; temp checkpoints cleaned.
    const finalKey = String(inserts[0]?.r2Key);
    expect(finalKey).toMatch(/^cast\/episodes\/trip-1\/2026-07-28-job-1\.mp3$/);
    expect(r2.objects.has(finalKey)).toBe(true);
    for (const checkpoint of checkpoints) {
      expect(r2.objects.has(checkpoint.r2Key)).toBe(false);
    }
  });

  it("synthesizing: voluntary checkpoint-and-release when out of budget", async () => {
    const { db, updates, inserts } = fakePumpDb({
      claimRows: [claimedJob({ status: "synthesizing", scriptJson: SCRIPT })],
    });
    const result = await runCastPump({
      r2: fakeR2(),
      db,
      deps: {
        ...baseDeps,
        synthesizeSegments: vi.fn(async () => ({
          checkpoints: [],
          finished: false,
          charactersBilled: 0,
        })) as never,
      },
    });
    expect(result.status).toBe("synthesizing");
    expect(result.released).toBe(true);
    expect(updates.at(-1)).toEqual({ claimedAt: null });
    expect(inserts).toHaveLength(0);
  });

  it("an error releases the lease, increments attempts, keeps checkpoints", async () => {
    const { db, updates } = fakePumpDb({
      claimRows: [claimedJob({ status: "synthesizing", scriptJson: SCRIPT })],
    });
    const result = await runCastPump({
      r2: fakeR2(),
      db,
      deps: {
        ...baseDeps,
        synthesizeSegments: vi.fn(async () => {
          throw new Error("ElevenLabs 429");
        }) as never,
      },
    });
    expect(result.status).toBe("synthesizing"); // not terminal yet
    expect(updates.at(-1)).toMatchObject({
      status: "synthesizing",
      attemptCount: 1,
      claimedAt: null,
    });
    expect(String(updates.at(-1)?.error)).toMatch(/429/);
    // checkpointsJson untouched — resume must not re-bill.
    expect(updates.at(-1)).not.toHaveProperty("checkpointsJson");
  });

  it("claims from a {rows: [...]} driver shape too", async () => {
    const { db, updates } = fakePumpDb({ claimRows: [] });
    db.execute = vi.fn(async () => ({
      rows: [claimedJob({ attemptCount: CAST_MAX_ATTEMPTS })],
    })) as never;
    const result = await runCastPump({ r2: fakeR2(), db });
    // The job was claimed (and immediately failed on the attempts backstop) —
    // proving the non-array driver row shape is handled.
    expect(result.status).toBe("failed");
    expect(updates[0]).toMatchObject({ status: "failed" });
  });

  it("an unbound R2 bucket is a retried error, not a crash loop", async () => {
    const { db, updates } = fakePumpDb({
      claimRows: [claimedJob({ status: "approved", scriptJson: SCRIPT })],
    });
    const result = await runCastPump({ r2: null, db, deps: baseDeps });
    // approved → synthesizing advance happens first, then the guard throws.
    expect(result.status).toBe("synthesizing");
    expect(String(updates.at(-1)?.error)).toMatch(/R2 bucket is not bound/);
    expect(updates.at(-1)).toMatchObject({ attemptCount: 1, claimedAt: null });
  });

  it("a synthesizing job without a script errors instead of faking an episode", async () => {
    const { db, updates } = fakePumpDb({
      claimRows: [claimedJob({ status: "synthesizing", scriptJson: null })],
    });
    const result = await runCastPump({ r2: fakeR2(), db, deps: baseDeps });
    expect(result.status).toBe("synthesizing");
    expect(String(updates.at(-1)?.error)).toMatch(/without a script/);
  });

  it("the final allowed attempt's error is terminal", async () => {
    const { db, updates } = fakePumpDb({
      claimRows: [
        claimedJob({
          status: "synthesizing",
          scriptJson: SCRIPT,
          attemptCount: CAST_MAX_ATTEMPTS - 1,
        }),
      ],
    });
    const result = await runCastPump({
      r2: fakeR2(),
      db,
      deps: {
        ...baseDeps,
        synthesizeSegments: vi.fn(async () => {
          throw new Error("still broken");
        }) as never,
      },
    });
    expect(result.status).toBe("failed");
    expect(updates.at(-1)).toMatchObject({
      status: "failed",
      attemptCount: CAST_MAX_ATTEMPTS,
    });
  });
});
