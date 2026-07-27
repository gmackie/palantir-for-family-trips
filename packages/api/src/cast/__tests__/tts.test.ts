import type { CastCheckpoint, CastScript } from "@sortey/db/schema";
import { describe, expect, it, vi } from "vitest";

import type { CastR2Bucket } from "../tts";
import {
  checkpointR2Key,
  deleteCheckpoints,
  loadCheckpointAudio,
  segmentContentHash,
  synthesizeScriptSegments,
} from "../tts";
import { validMp3 } from "./mp3-fixtures";

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

function script(texts: string[]): CastScript {
  return {
    episodeTitle: "Test Episode",
    outline: texts.map((_, i) => ({
      key: `seg-${i}`,
      title: `Segment ${i}`,
      beats: ["beat"],
      wordTarget: 100,
    })),
    segments: texts.map((text, i) => ({
      key: `seg-${i}`,
      title: `Segment ${i}`,
      text,
      wordTarget: 100,
    })),
  };
}

const VOICE = "voice-1";
const MODEL = "tts-model-1";

describe("segmentContentHash", () => {
  it("changes with text, voice, and model", () => {
    const base = segmentContentHash({
      text: "a",
      voiceId: VOICE,
      ttsModel: MODEL,
    });
    expect(
      segmentContentHash({ text: "b", voiceId: VOICE, ttsModel: MODEL }),
    ).not.toBe(base);
    expect(
      segmentContentHash({ text: "a", voiceId: "v2", ttsModel: MODEL }),
    ).not.toBe(base);
    expect(
      segmentContentHash({ text: "a", voiceId: VOICE, ttsModel: "m2" }),
    ).not.toBe(base);
  });
});

describe("synthesizeScriptSegments", () => {
  it("synthesizes every segment, parks checkpoints in R2, bills characters", async () => {
    const r2 = fakeR2();
    const synthesize = vi.fn(async () => validMp3(5));
    const persisted: CastCheckpoint[] = [];

    const outcome = await synthesizeScriptSegments({
      r2,
      tripId: "trip-1",
      script: script(["hello world", "second chapter"]),
      voiceId: VOICE,
      ttsModel: MODEL,
      existingCheckpoints: [],
      onCheckpoint: async (c) => {
        persisted.push(c);
      },
      synthesize,
    });

    expect(outcome.finished).toBe(true);
    expect(outcome.checkpoints).toHaveLength(2);
    expect(synthesize).toHaveBeenCalledTimes(2);
    expect(outcome.charactersBilled).toBe(
      "hello world".length + "second chapter".length,
    );
    // Persisted eagerly, one at a time, and audio actually landed in R2.
    expect(persisted).toHaveLength(2);
    for (const checkpoint of outcome.checkpoints) {
      expect(r2.objects.has(checkpoint.r2Key)).toBe(true);
      expect(checkpoint.r2Key).toBe(
        checkpointR2Key("trip-1", checkpoint.contentHash),
      );
      expect(checkpoint.durationSeconds).toBeCloseTo((5 * 1152) / 44100, 6);
    }
  });

  it("resumes: an existing checkpoint with parked audio is never re-billed", async () => {
    const r2 = fakeR2();
    const theScript = script(["chapter one", "chapter two"]);
    const synthesize = vi.fn(async () => validMp3(3));

    const first = await synthesizeScriptSegments({
      r2,
      tripId: "trip-1",
      script: theScript,
      voiceId: VOICE,
      ttsModel: MODEL,
      existingCheckpoints: [],
      onCheckpoint: async () => {},
      synthesize,
      // Deadline forces a stop after the first synthesized segment.
      deadline: 100,
      now: (() => {
        let calls = 0;
        // First deadline check passes (t=0), second fails (t=200).
        return () => (calls++ === 0 ? 0 : 200);
      })(),
    });
    expect(first.finished).toBe(false);
    expect(first.checkpoints).toHaveLength(1);
    expect(synthesize).toHaveBeenCalledTimes(1);

    const resume = await synthesizeScriptSegments({
      r2,
      tripId: "trip-1",
      script: theScript,
      voiceId: VOICE,
      ttsModel: MODEL,
      existingCheckpoints: first.checkpoints,
      onCheckpoint: async () => {},
      synthesize,
    });
    expect(resume.finished).toBe(true);
    expect(resume.checkpoints).toHaveLength(2);
    // Only the second segment was billed on resume.
    expect(synthesize).toHaveBeenCalledTimes(2);
    expect(resume.charactersBilled).toBe("chapter two".length);
  });

  it("re-synthesizes when a checkpoint's parked object vanished from R2", async () => {
    const r2 = fakeR2();
    const theScript = script(["only chapter"]);
    const synthesize = vi.fn(async () => validMp3(2));

    const hash = segmentContentHash({
      text: "only chapter",
      voiceId: VOICE,
      ttsModel: MODEL,
    });
    const ghost: CastCheckpoint = {
      segmentKey: "seg-0",
      contentHash: hash,
      r2Key: checkpointR2Key("trip-1", hash),
      sizeBytes: 999,
      durationSeconds: 9,
    };

    const outcome = await synthesizeScriptSegments({
      r2,
      tripId: "trip-1",
      script: theScript,
      voiceId: VOICE,
      ttsModel: MODEL,
      existingCheckpoints: [ghost],
      onCheckpoint: async () => {},
      synthesize,
    });
    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(outcome.finished).toBe(true);
  });

  it("stops before spending when the deadline has already passed", async () => {
    const r2 = fakeR2();
    const synthesize = vi.fn(async () => validMp3(2));
    const outcome = await synthesizeScriptSegments({
      r2,
      tripId: "trip-1",
      script: script(["chapter"]),
      voiceId: VOICE,
      ttsModel: MODEL,
      existingCheckpoints: [],
      onCheckpoint: async () => {},
      synthesize,
      deadline: 100,
      now: () => 200,
    });
    expect(outcome.finished).toBe(false);
    expect(outcome.checkpoints).toHaveLength(0);
    expect(synthesize).not.toHaveBeenCalled();
    expect(outcome.charactersBilled).toBe(0);
  });
});

describe("loadCheckpointAudio / deleteCheckpoints", () => {
  it("round-trips checkpoint audio and cleans up", async () => {
    const r2 = fakeR2();
    const synthesize = vi.fn(async () => validMp3(4));
    const outcome = await synthesizeScriptSegments({
      r2,
      tripId: "trip-1",
      script: script(["a", "b"]),
      voiceId: VOICE,
      ttsModel: MODEL,
      existingCheckpoints: [],
      onCheckpoint: async () => {},
      synthesize,
    });

    const audio = await loadCheckpointAudio(r2, outcome.checkpoints);
    expect(audio).toHaveLength(2);
    expect(audio[0]!.length).toBeGreaterThan(0);

    await deleteCheckpoints(r2, outcome.checkpoints);
    expect(r2.objects.size).toBe(0);

    await expect(loadCheckpointAudio(r2, outcome.checkpoints)).rejects.toThrow(
      /missing from R2/,
    );
  });
});
