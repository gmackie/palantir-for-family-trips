import { describe, expect, it } from "vitest";

import {
  concatMp3Segments,
  Mp3ValidationError,
  parseMp3Segment,
  validateEpisodeAudio,
} from "../concat";
import {
  buildMp3,
  FRAME_LENGTH_128,
  mp3Frame64kbps,
  validMp3,
} from "./mp3-fixtures";

const SECONDS_PER_FRAME = 1152 / 44100;

describe("parseMp3Segment", () => {
  it("parses clean frames and computes duration from frame count", () => {
    const audio = parseMp3Segment(validMp3(10));
    expect(audio.frameCount).toBe(10);
    expect(audio.bytes.length).toBe(10 * FRAME_LENGTH_128);
    expect(audio.durationSeconds).toBeCloseTo(10 * SECONDS_PER_FRAME, 6);
  });

  it("strips ID3v2 header, Xing frame, and ID3v1 tail", () => {
    const audio = parseMp3Segment(
      validMp3(8, { id3v2: true, xing: true, id3v1: true }),
    );
    expect(audio.frameCount).toBe(8);
    expect(audio.bytes.length).toBe(8 * FRAME_LENGTH_128);
  });

  it("rejects frames that are not the pinned 128kbps CBR format", () => {
    expect(() => parseMp3Segment(mp3Frame64kbps())).toThrow(Mp3ValidationError);
    expect(() => parseMp3Segment(mp3Frame64kbps())).toThrow(/64kbps/);
  });

  it("rejects a stream with no audio frames", () => {
    expect(() => parseMp3Segment(new Uint8Array(500))).toThrow(
      Mp3ValidationError,
    );
  });

  it("rejects a stream that is mostly junk", () => {
    const junk = new Uint8Array(5000).fill(0x41);
    const stream = buildMp3([junk, validMp3(2)]);
    expect(() => parseMp3Segment(stream)).toThrow(/unparseable/);
  });
});

describe("concatMp3Segments", () => {
  it("splices segments and derives offsets from actual durations", () => {
    const result = concatMp3Segments([
      validMp3(10, { id3v2: true }),
      validMp3(20, { xing: true }),
      validMp3(5),
    ]);
    expect(result.bytes.length).toBe(35 * FRAME_LENGTH_128);
    expect(result.durationSeconds).toBeCloseTo(35 * SECONDS_PER_FRAME, 6);
    expect(result.segmentStartSeconds).toEqual([
      0,
      expect.closeTo(10 * SECONDS_PER_FRAME, 6),
      expect.closeTo(30 * SECONDS_PER_FRAME, 6),
    ]);
    expect(result.segmentDurationSeconds[1]).toBeCloseTo(
      20 * SECONDS_PER_FRAME,
      6,
    );
  });

  it("re-parses clean through validateEpisodeAudio", () => {
    const result = concatMp3Segments([validMp3(12), validMp3(12)]);
    expect(() => validateEpisodeAudio(result)).not.toThrow();
  });

  it("refuses an empty segment list", () => {
    expect(() => concatMp3Segments([])).toThrow(Mp3ValidationError);
  });

  it("propagates a corrupt segment instead of splicing around it", () => {
    expect(() => concatMp3Segments([validMp3(4), mp3Frame64kbps()])).toThrow(
      Mp3ValidationError,
    );
  });
});
