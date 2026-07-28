/**
 * MP3 frame-level concat for Corridor Cast (eng-review Issue 9.6).
 *
 * ElevenLabs returns 128 kbps CBR 44.1 kHz MPEG-1 Layer III per segment. To
 * splice segments into one seekable episode without re-encoding we:
 *  - strip ID3v2 headers, ID3v1 tails, and Xing/Info metadata frames,
 *  - validate every audio frame is the pinned CBR format,
 *  - concatenate raw frames and compute duration/offsets from ACTUAL frame
 *    counts (never from word estimates).
 *
 * A file that fails validation is rejected before upload — a broken artifact
 * must never become the episode the family downloads at 6am.
 */

const SAMPLES_PER_FRAME = 1152; // MPEG-1 Layer III
const PINNED_SAMPLE_RATE = 44100;
const PINNED_BITRATE_KBPS = 128;

// MPEG-1 Layer III bitrate index → kbps (0 = free, 15 = bad).
const BITRATE_TABLE = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, -1,
] as const;
// MPEG-1 sample-rate index → Hz (3 = reserved).
const SAMPLE_RATE_TABLE = [44100, 48000, 32000, -1] as const;

export type Mp3Audio = {
  /** Raw audio frames only — no ID3, no Xing/Info frame. */
  bytes: Uint8Array;
  frameCount: number;
  durationSeconds: number;
};

export class Mp3ValidationError extends Error {}

function id3v2Size(bytes: Uint8Array): number {
  if (
    bytes.length >= 10 &&
    bytes[0] === 0x49 && // I
    bytes[1] === 0x44 && // D
    bytes[2] === 0x33 // 3
  ) {
    // Synchsafe 28-bit size, excludes the 10-byte header itself.
    const size =
      (((bytes[6] ?? 0) & 0x7f) << 21) |
      (((bytes[7] ?? 0) & 0x7f) << 14) |
      (((bytes[8] ?? 0) & 0x7f) << 7) |
      ((bytes[9] ?? 0) & 0x7f);
    return 10 + size;
  }
  return 0;
}

function isId3v1Tail(bytes: Uint8Array, offset: number): boolean {
  return (
    bytes.length - offset === 128 &&
    bytes[offset] === 0x54 && // T
    bytes[offset + 1] === 0x41 && // A
    bytes[offset + 2] === 0x47 // G
  );
}

type FrameHeader = {
  frameLength: number;
  bitrateKbps: number;
  sampleRate: number;
};

function parseFrameHeader(
  bytes: Uint8Array,
  offset: number,
): FrameHeader | null {
  if (offset + 4 > bytes.length) return null;
  const b0 = bytes[offset] ?? 0;
  const b1 = bytes[offset + 1] ?? 0;
  const b2 = bytes[offset + 2] ?? 0;

  // Frame sync: 11 set bits. Then require MPEG-1 (version bits 11) and
  // Layer III (layer bits 01) — the only shape ElevenLabs CBR emits.
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const versionBits = (b1 >> 3) & 0x03;
  const layerBits = (b1 >> 1) & 0x03;
  if (versionBits !== 0x03 || layerBits !== 0x01) return null;

  const bitrateIndex = (b2 >> 4) & 0x0f;
  const sampleRateIndex = (b2 >> 2) & 0x03;
  const padding = (b2 >> 1) & 0x01;

  const bitrateKbps = BITRATE_TABLE[bitrateIndex] ?? -1;
  const sampleRate = SAMPLE_RATE_TABLE[sampleRateIndex] ?? -1;
  if (bitrateKbps <= 0 || sampleRate <= 0) return null;

  const frameLength =
    Math.floor((144 * bitrateKbps * 1000) / sampleRate) + padding;
  return { frameLength, bitrateKbps, sampleRate };
}

/** True when the frame carries a Xing/Info/VBRI header instead of audio. */
function isMetadataFrame(
  bytes: Uint8Array,
  offset: number,
  frameLength: number,
): boolean {
  const end = Math.min(offset + frameLength, bytes.length);
  // Xing/Info sits at a fixed offset that depends on channel mode, but a
  // bounded scan of the frame body is simpler and safe: audio frames never
  // contain these magic strings in their first bytes' side-info region.
  const scanEnd = Math.min(offset + 48, end - 4);
  for (let i = offset + 4; i <= scanEnd; i++) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const d = bytes[i + 3];
    if (
      (a === 0x58 && b === 0x69 && c === 0x6e && d === 0x67) || // Xing
      (a === 0x49 && b === 0x6e && c === 0x66 && d === 0x6f) || // Info
      (a === 0x56 && b === 0x42 && c === 0x52 && d === 0x49) // VBRI
    ) {
      return true;
    }
  }
  return false;
}

function walkMp3Frames(bytes: Uint8Array): {
  frames: Array<{ offset: number; length: number }>;
} {
  let offset = id3v2Size(bytes);
  const frames: Array<{ offset: number; length: number }> = [];
  let junkBytes = 0;

  while (offset < bytes.length) {
    if (isId3v1Tail(bytes, offset)) break;

    const header = parseFrameHeader(bytes, offset);
    if (!header) {
      // Resync: tolerate stray bytes between frames but count them — too much
      // junk means the stream is not what we think it is.
      junkBytes++;
      offset++;
      continue;
    }

    if (
      header.bitrateKbps !== PINNED_BITRATE_KBPS ||
      header.sampleRate !== PINNED_SAMPLE_RATE
    ) {
      throw new Mp3ValidationError(
        `MP3 frame at byte ${offset} is ${header.bitrateKbps}kbps/${header.sampleRate}Hz — expected pinned ${PINNED_BITRATE_KBPS}kbps CBR ${PINNED_SAMPLE_RATE}Hz`,
      );
    }

    // A header whose declared frame extends past the buffer is a truncated
    // stream (interrupted download/synthesis) — refuse rather than splice a
    // partial frame with full duration credited.
    if (offset + header.frameLength > bytes.length) {
      throw new Mp3ValidationError(
        `MP3 stream truncated mid-frame at byte ${offset} (frame needs ${header.frameLength} bytes, ${bytes.length - offset} remain)`,
      );
    }

    if (!isMetadataFrame(bytes, offset, header.frameLength)) {
      frames.push({ offset, length: header.frameLength });
    }
    offset += header.frameLength;
  }

  if (frames.length === 0) {
    throw new Mp3ValidationError("No MP3 audio frames found in segment");
  }
  if (junkBytes > Math.max(64, bytes.length * 0.01)) {
    throw new Mp3ValidationError(
      `MP3 segment contains ${junkBytes} unparseable bytes — refusing to splice a corrupt stream`,
    );
  }

  return { frames };
}

/**
 * Parse one MP3 segment: strip metadata, validate the pinned CBR format,
 * return raw audio frames + exact duration.
 */
export function parseMp3Segment(bytes: Uint8Array): Mp3Audio {
  const { frames } = walkMp3Frames(bytes);

  const totalLength = frames.reduce((sum, f) => sum + f.length, 0);
  const out = new Uint8Array(totalLength);
  let cursor = 0;
  for (const frame of frames) {
    out.set(bytes.subarray(frame.offset, frame.offset + frame.length), cursor);
    cursor += frame.length;
  }

  return {
    bytes: out,
    frameCount: frames.length,
    durationSeconds: (frames.length * SAMPLES_PER_FRAME) / PINNED_SAMPLE_RATE,
  };
}

/**
 * Validation-grade walk that never allocates an output buffer — an episode is
 * ~29MB and the cron worker holds the concat result plus segment audio at the
 * same time, so a full re-parse copy just to compute duration risks the 128MB
 * isolate ceiling.
 */
export function scanMp3Duration(bytes: Uint8Array): {
  frameCount: number;
  durationSeconds: number;
} {
  const { frames } = walkMp3Frames(bytes);
  return {
    frameCount: frames.length,
    durationSeconds: (frames.length * SAMPLES_PER_FRAME) / PINNED_SAMPLE_RATE,
  };
}

export type ConcatResult = {
  bytes: Uint8Array;
  durationSeconds: number;
  /** Start offset of each input segment, in seconds, from actual durations. */
  segmentStartSeconds: number[];
  segmentDurationSeconds: number[];
};

export function concatMp3Segments(segments: Uint8Array[]): ConcatResult {
  if (segments.length === 0) {
    throw new Mp3ValidationError("No segments to concatenate");
  }

  const parsed = segments.map((s) => parseMp3Segment(s));
  const totalBytes = parsed.reduce((sum, p) => sum + p.bytes.length, 0);
  const out = new Uint8Array(totalBytes);

  const starts: number[] = [];
  const durations: number[] = [];
  let cursor = 0;
  let elapsed = 0;
  for (const segment of parsed) {
    out.set(segment.bytes, cursor);
    cursor += segment.bytes.length;
    starts.push(elapsed);
    durations.push(segment.durationSeconds);
    elapsed += segment.durationSeconds;
  }

  return {
    bytes: out,
    durationSeconds: elapsed,
    segmentStartSeconds: starts,
    segmentDurationSeconds: durations,
  };
}

/**
 * Final artifact sanity gate before upload: duration must be positive and
 * within tolerance of the sum of its parts (they are computed from the same
 * frames, so drift means a splice bug), and the stream must re-parse clean.
 * Uses the scan-only walker — no second episode-sized allocation.
 */
export function validateEpisodeAudio(result: ConcatResult): void {
  const reparsed = scanMp3Duration(result.bytes);
  const drift = Math.abs(reparsed.durationSeconds - result.durationSeconds);
  if (result.durationSeconds <= 0 || drift > 0.5) {
    throw new Mp3ValidationError(
      `Episode duration mismatch: concat says ${result.durationSeconds.toFixed(2)}s, reparse says ${reparsed.durationSeconds.toFixed(2)}s`,
    );
  }
}
