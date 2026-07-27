import { createHash } from "node:crypto";

import type { CastCheckpoint, CastScript } from "@sortey/db/schema";

import { parseMp3Segment } from "./concat";
import { type SynthesizeSpeech, synthesizeSpeech } from "./elevenlabs";

/**
 * Per-segment TTS with R2 cost checkpoints (eng-review Issue 2).
 *
 * Every synthesized segment is parked in R2 temp space under a key derived
 * from hash(segment text + voice + model) BEFORE the pipeline moves on. A
 * retry — same script, same voice — resumes at the first missing segment and
 * never re-bills ElevenLabs for audio that already exists. Checkpoints are
 * persisted to the job row via `onCheckpoint` as soon as the audio lands.
 */

export interface CastR2Bucket {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | ReadableStream | Blob,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete?(key: string | string[]): Promise<unknown>;
}

export function segmentContentHash(params: {
  text: string;
  voiceId: string;
  ttsModel: string;
}): string {
  return createHash("sha256")
    .update(`${params.voiceId}\n${params.ttsModel}\n${params.text}`)
    .digest("hex")
    .slice(0, 20);
}

export function checkpointR2Key(tripId: string, contentHash: string): string {
  return `cast/tmp/${tripId}/${contentHash}.mp3`;
}

export type SynthesizeOutcome = {
  /** All checkpoints for the script, in segment order — only meaningful when finished. */
  checkpoints: CastCheckpoint[];
  finished: boolean;
  charactersBilled: number;
};

/**
 * Synthesize the script's segments in order, resuming from existing
 * checkpoints. Stops early (finished: false) when `deadline` passes — the
 * caller releases the lease and a later pump run resumes at the first
 * unsynthesized segment.
 */
export async function synthesizeScriptSegments(params: {
  r2: CastR2Bucket;
  tripId: string;
  script: CastScript;
  voiceId: string;
  ttsModel: string;
  existingCheckpoints: CastCheckpoint[];
  /** Persist a fresh checkpoint to the job row the moment its audio lands. */
  onCheckpoint: (checkpoint: CastCheckpoint) => Promise<void>;
  deadline?: number; // epoch ms
  now?: () => number;
  synthesize?: SynthesizeSpeech;
}): Promise<SynthesizeOutcome> {
  const now = params.now ?? Date.now;
  const synthesize = params.synthesize ?? synthesizeSpeech;

  // Verify all parked checkpoints up front, in parallel — a checkpoint whose
  // object vanished (manual cleanup, bucket lifecycle) must re-synthesize
  // rather than produce a silent hole in the episode. One round-trip wave
  // instead of N serial gets on every resume.
  const verifiedHashes = new Set(
    (
      await Promise.all(
        params.existingCheckpoints.map(async (checkpoint) =>
          (await params.r2.get(checkpoint.r2Key))
            ? checkpoint.contentHash
            : null,
        ),
      )
    ).filter((hash): hash is string => hash != null),
  );
  const byHash = new Map(
    params.existingCheckpoints.map((c) => [c.contentHash, c]),
  );

  const checkpoints: CastCheckpoint[] = [];
  let charactersBilled = 0;

  for (const segment of params.script.segments) {
    const contentHash = segmentContentHash({
      text: segment.text,
      voiceId: params.voiceId,
      ttsModel: params.ttsModel,
    });

    const existing = byHash.get(contentHash);
    if (existing && verifiedHashes.has(contentHash)) {
      checkpoints.push(existing);
      continue;
    }

    if (params.deadline != null && now() >= params.deadline) {
      return { checkpoints, finished: false, charactersBilled };
    }

    const audio = await synthesize({
      text: segment.text,
      voiceId: params.voiceId,
      modelId: params.ttsModel,
    });
    charactersBilled += segment.text.length;

    // Validate the segment BEFORE parking it — a corrupt stream should fail
    // here, not at concat time after every segment is paid for.
    const parsed = parseMp3Segment(audio);

    const r2Key = checkpointR2Key(params.tripId, contentHash);
    await params.r2.put(r2Key, audio.buffer as ArrayBuffer, {
      httpMetadata: { contentType: "audio/mpeg" },
    });

    const checkpoint: CastCheckpoint = {
      segmentKey: segment.key,
      contentHash,
      r2Key,
      sizeBytes: audio.byteLength,
      durationSeconds: parsed.durationSeconds,
    };
    await params.onCheckpoint(checkpoint);
    checkpoints.push(checkpoint);
  }

  return { checkpoints, finished: true, charactersBilled };
}

/**
 * Fetch parked segment audio for concat, in checkpoint order. Parallel: peak
 * memory is unchanged (concat holds every segment anyway) and finalization
 * stops paying N serial R2 round-trips.
 */
export async function loadCheckpointAudio(
  r2: CastR2Bucket,
  checkpoints: CastCheckpoint[],
): Promise<Uint8Array[]> {
  return Promise.all(
    checkpoints.map(async (checkpoint) => {
      const object = await r2.get(checkpoint.r2Key);
      if (!object) {
        throw new Error(
          `Checkpoint audio missing from R2: ${checkpoint.r2Key} (segment ${checkpoint.segmentKey})`,
        );
      }
      return new Uint8Array(await object.arrayBuffer());
    }),
  );
}

/** Best-effort temp cleanup — on success and on terminal abandonment. */
export async function deleteCheckpoints(
  r2: CastR2Bucket,
  checkpoints: CastCheckpoint[],
): Promise<void> {
  if (!r2.delete) return;
  for (const checkpoint of checkpoints) {
    try {
      await r2.delete(checkpoint.r2Key);
    } catch {
      // Temp objects are content-hash keyed and small; a failed delete only
      // costs pennies of storage and must never fail the episode.
    }
  }
}
