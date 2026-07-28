/**
 * Hand-built MPEG-1 Layer III byte fixtures for concat/TTS tests. A "frame"
 * here is a valid 128 kbps / 44.1 kHz header followed by a zeroed payload —
 * exactly the pinned shape ElevenLabs returns, minus the music.
 */

/** 128 kbps, 44.1 kHz, no padding → floor(144 * 128000 / 44100) = 417 bytes. */
export const FRAME_LENGTH_128 = 417;

export function mp3Frame(): Uint8Array {
  const frame = new Uint8Array(FRAME_LENGTH_128);
  frame[0] = 0xff; // sync
  frame[1] = 0xfb; // sync + MPEG-1 + Layer III + no CRC
  frame[2] = 0x90; // bitrate index 9 (128 kbps), sample rate index 0 (44.1 kHz)
  frame[3] = 0x00;
  return frame;
}

/** Same header, 64 kbps → floor(144 * 64000 / 44100) = 208 bytes. */
export function mp3Frame64kbps(): Uint8Array {
  const frame = new Uint8Array(208);
  frame[0] = 0xff;
  frame[1] = 0xfb;
  frame[2] = 0x50; // bitrate index 5 (64 kbps)
  frame[3] = 0x00;
  return frame;
}

/** A 128 kbps frame carrying a Xing header instead of audio. */
export function xingFrame(): Uint8Array {
  const frame = mp3Frame();
  frame.set([0x58, 0x69, 0x6e, 0x67], 36); // "Xing" in the side-info region
  return frame;
}

export function id3v2Header(payloadSize = 100): Uint8Array {
  const header = new Uint8Array(10 + payloadSize);
  header.set([0x49, 0x44, 0x33, 0x03, 0x00, 0x00]); // "ID3" v2.3, no flags
  // Synchsafe size (fits in the last byte for payloads < 128).
  header[9] = payloadSize & 0x7f;
  header[6] = 0;
  header[7] = 0;
  header[8] = (payloadSize >> 7) & 0x7f;
  return header;
}

export function id3v1Tail(): Uint8Array {
  const tail = new Uint8Array(128);
  tail.set([0x54, 0x41, 0x47]); // "TAG"
  return tail;
}

export function buildMp3(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

/** N clean audio frames, optionally wrapped in ID3/Xing metadata. */
export function validMp3(
  frameCount: number,
  opts: { id3v2?: boolean; xing?: boolean; id3v1?: boolean } = {},
): Uint8Array {
  const parts: Uint8Array[] = [];
  if (opts.id3v2) parts.push(id3v2Header());
  if (opts.xing) parts.push(xingFrame());
  for (let i = 0; i < frameCount; i++) parts.push(mp3Frame());
  if (opts.id3v1) parts.push(id3v1Tail());
  return buildMp3(parts);
}
