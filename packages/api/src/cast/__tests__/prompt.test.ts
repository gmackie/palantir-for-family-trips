import { describe, expect, it } from "vitest";

import type { CastDayContext } from "../context";
import {
  buildOutlineUserPrompt,
  buildSegmentUserPrompt,
  CAST_WORDS_PER_MINUTE,
  type CastOutline,
} from "../prompt";

const CONTEXT: CastDayContext = {
  tripName: "Van Trip",
  tz: "America/Denver",
  targetDate: "2026-07-28",
  hasDriveLeg: true,
  degraded: false,
  segment: {
    name: "Denver → Moab",
    originName: "Denver",
    destinationName: "Moab",
    distanceMiles: 353,
    durationMinutes: 330,
    hasGeometry: true,
  },
  day: null,
  anchors: [],
  pois: [],
};

const OUTLINE: CastOutline = {
  episodeTitle: "Over the Divide",
  segments: [
    { key: "intro", title: "Intro", beats: ["welcome"], wordTarget: 200 },
    { key: "canyon", title: "The Canyon", beats: ["geology"], wordTarget: 800 },
  ],
};

describe("buildOutlineUserPrompt", () => {
  it("carries the word budget derived from the duration", () => {
    const prompt = buildOutlineUserPrompt(CONTEXT, 30);
    expect(prompt).toContain(`${30 * CAST_WORDS_PER_MINUTE}`);
    expect(prompt).toContain("30 minutes");
    // Tier-1 ground truth is embedded verbatim.
    expect(prompt).toContain("Denver → Moab");
    // Non-degraded prompts must not carry the degraded disclaimer.
    expect(prompt).not.toContain("no route geometry");
  });

  it("degraded context adds the no-geometry instruction", () => {
    const prompt = buildOutlineUserPrompt({ ...CONTEXT, degraded: true }, 15);
    expect(prompt).toContain("no route geometry");
    expect(prompt).toContain(`${15 * CAST_WORDS_PER_MINUTE}`);
  });
});

describe("buildSegmentUserPrompt", () => {
  it("throws when the segment key is not in the outline", () => {
    expect(() =>
      buildSegmentUserPrompt({
        context: CONTEXT,
        outline: OUTLINE,
        segmentKey: "missing",
        previousText: null,
      }),
    ).toThrow(/no segment with key missing/);
  });

  it("first chapter opens the episode; later chapters get the previous tail", () => {
    const first = buildSegmentUserPrompt({
      context: CONTEXT,
      outline: OUTLINE,
      segmentKey: "intro",
      previousText: null,
    });
    expect(first).toContain("first chapter");

    const tail = "x".repeat(400);
    const second = buildSegmentUserPrompt({
      context: CONTEXT,
      outline: OUTLINE,
      segmentKey: "canyon",
      previousText: tail,
    });
    expect(second).toContain("soft transition");
    // Only the last 300 chars of the previous chapter are quoted.
    expect(second).toContain("x".repeat(300));
    expect(second).not.toContain("x".repeat(301));
    expect(second).toContain("The Canyon");
    expect(second).toContain("800 words");
  });
});
