import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/gmacko_test";

const { generateCastScript } = await import("../script");

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
};

const OUTLINE = {
  episodeTitle: "Over the Divide",
  segments: [
    { key: "intro", title: "Intro", beats: ["welcome"], wordTarget: 150 },
    { key: "canyon", title: "The Canyon", beats: ["geology"], wordTarget: 600 },
    { key: "outro", title: "Outro", beats: ["send-off"], wordTarget: 150 },
  ],
};

function fakeClient(responses: unknown[]) {
  let call = 0;
  const parse = vi.fn(async () => ({
    parsed_output: responses[call++],
    usage: { input_tokens: 100, output_tokens: 50 },
    stop_reason: "end_turn",
  }));
  return { client: { messages: { parse } } as unknown as Anthropic, parse };
}

describe("generateCastScript", () => {
  it("generates outline then one call per chapter, threading continuity", async () => {
    const { client, parse } = fakeClient([
      OUTLINE,
      { text: "Intro narration ends with the sunrise." },
      { text: "Canyon narration." },
      { text: "Outro narration." },
    ]);
    const usages: number[] = [];

    const script = await generateCastScript({
      context: CONTEXT,
      durationMinutes: 30,
      client,
      model: "test-model",
      onUsage: (usage) => usages.push(usage.outputTokens),
    });

    expect(parse).toHaveBeenCalledTimes(4); // 1 outline + 3 chapters
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
    const canyonCall = parse.mock.calls[2]?.[0] as {
      messages: Array<{ content: Array<{ type: string; text?: string }> }>;
    };
    const canyonText = canyonCall.messages[0]?.content.find(
      (c) => c.type === "text",
    )?.text;
    expect(canyonText).toContain("sunrise");
    expect(canyonText).toContain("soft transition");
  });

  it("propagates a failed structured parse instead of inventing a chapter", async () => {
    const { client } = fakeClient([OUTLINE, undefined]);
    await expect(
      generateCastScript({
        context: CONTEXT,
        durationMinutes: 15,
        client,
        model: "test-model",
      }),
    ).rejects.toThrow(/valid structured output/);
  });
});
