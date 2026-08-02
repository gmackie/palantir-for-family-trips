import { describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/gmacko_test";

const { generateCastScript } = await import("../script");

import type { StructuredRequest } from "../../llm/structured";
import type { CastDayContext } from "../context";

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
  grounding: null,
};

const OUTLINE = {
  episodeTitle: "Over the Divide",
  segments: [
    { key: "intro", title: "Intro", beats: ["welcome"], wordTarget: 150 },
    { key: "canyon", title: "The Canyon", beats: ["geology"], wordTarget: 600 },
    { key: "outro", title: "Outro", beats: ["send-off"], wordTarget: 150 },
  ],
};

/** A StructuredGenerator that replays canned responses and records requests. */
function fakeGenerator(responses: unknown[]) {
  let call = 0;
  const requests: StructuredRequest<unknown>[] = [];
  const generate = vi.fn(async (request: StructuredRequest<unknown>) => {
    requests.push(request);
    const response = responses[call++];
    if (response === undefined) {
      throw new Error("Model failed to produce a valid structured output.");
    }
    request.onUsage?.({ inputTokens: 100, outputTokens: 50 });
    return response;
  });
  return { generate: generate as never, requests, generate_: generate };
}

describe("generateCastScript", () => {
  it("generates outline then one call per chapter, threading continuity", async () => {
    const { generate, requests, generate_ } = fakeGenerator([
      OUTLINE,
      { text: "Intro narration ends with the sunrise." },
      { text: "Canyon narration." },
      { text: "Outro narration." },
    ]);
    const usages: number[] = [];

    const script = await generateCastScript({
      context: CONTEXT,
      durationMinutes: 30,
      generate,
      onUsage: (usage) => usages.push(usage.outputTokens),
    });

    expect(generate_).toHaveBeenCalledTimes(4); // 1 outline + 3 chapters
    expect(script.episodeTitle).toBe("Over the Divide");
    expect(script.segments.map((s) => s.key)).toEqual([
      "intro",
      "canyon",
      "outro",
    ]);
    expect(script.segments[0]?.text).toContain("sunrise");
    expect(script.outline).toHaveLength(3);
    // Usage reported once per call for cost accounting.
    expect(usages).toHaveLength(4);

    // The second chapter's prompt carries the tail of the first chapter.
    const canyonText = requests[2]?.userText ?? "";
    expect(canyonText).toContain("sunrise");
    expect(canyonText).toContain("soft transition");
  });

  it("propagates a failed structured parse instead of inventing a chapter", async () => {
    const { generate } = fakeGenerator([OUTLINE]);
    await expect(
      generateCastScript({
        context: CONTEXT,
        durationMinutes: 15,
        generate,
      }),
    ).rejects.toThrow(/valid structured output/);
  });
});
