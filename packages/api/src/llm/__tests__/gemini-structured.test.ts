import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import {
  createGeminiGenerator,
  THINKING_HEADROOM_TOKENS,
  toGeminiSchema,
} from "../gemini-structured";

const SCHEMA = z.object({
  episodeTitle: z.string().min(1).max(200),
  segments: z
    .array(
      z.object({
        key: z.string().min(1).describe("stable slug"),
        wordTarget: z.number().int().min(50).max(1500),
      }),
    )
    .min(1)
    .max(10)
    .refine((s) => new Set(s.map((x) => x.key)).size === s.length, "unique"),
});

type GenerateArgs = { generationConfig?: Record<string, unknown> };

function fakeClient(
  responses: Array<{
    text?: string;
    throws?: Error;
    finishReason?: string;
    usage?: { promptTokenCount: number; candidatesTokenCount: number };
  }>,
) {
  let call = 0;
  const modelParams: GenerateArgs[] = [];
  const getGenerativeModel = vi.fn((params: GenerateArgs) => {
    modelParams.push(params);
    return {
      generateContent: async () => {
        const next = responses[call++]!;
        return {
          response: {
            text: () => {
              if (next.throws) throw next.throws;
              return next.text ?? "";
            },
            candidates: next.finishReason
              ? [{ finishReason: next.finishReason }]
              : undefined,
            usageMetadata: next.usage,
          },
        };
      },
    };
  });
  return {
    client: { getGenerativeModel } as never,
    modelParams,
  };
}

describe("toGeminiSchema", () => {
  it("keeps the shape Gemini understands and drops what it rejects", () => {
    // biome-ignore lint/suspicious/noExplicitAny: walking an untyped JSON tree
    const schema = toGeminiSchema(SCHEMA) as any;
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["episodeTitle", "segments"]);
    // Unsupported JSON-Schema keys must not survive the conversion.
    expect(schema.$schema).toBeUndefined();
    expect(schema.additionalProperties).toBeUndefined();
    expect(schema.properties.episodeTitle).toEqual({ type: "string" });

    const segments = schema.properties.segments;
    expect(segments.minItems).toBe(1);
    expect(segments.maxItems).toBe(10);
    expect(segments.items.properties.key).toEqual({
      type: "string",
      description: "stable slug",
    });
    expect(segments.items.properties.wordTarget).toEqual({ type: "integer" });
  });
});

describe("createGeminiGenerator", () => {
  const request = {
    systemPrompt: "system",
    userText: "user",
    schema: SCHEMA,
    maxTokens: 8192,
  };

  it("parses a well-formed response and reports usage", async () => {
    const value = {
      episodeTitle: "Over the Divide",
      segments: [{ key: "intro", wordTarget: 150 }],
    };
    const { client, modelParams } = fakeClient([
      {
        text: JSON.stringify(value),
        usage: { promptTokenCount: 1200, candidatesTokenCount: 340 },
      },
    ]);
    const usages: Array<{ inputTokens: number; outputTokens: number }> = [];

    const generate = createGeminiGenerator({ client, model: "gemini-test" });
    const result = await generate({
      ...request,
      onUsage: (usage) => usages.push(usage),
    });

    expect(result).toEqual(value);
    expect(usages).toEqual([{ inputTokens: 1200, outputTokens: 340 }]);
    // Thinking tokens get their own budget on top of the prose allowance.
    expect(modelParams[0]?.generationConfig?.maxOutputTokens).toBe(
      8192 + THINKING_HEADROOM_TOKENS,
    );
    expect(modelParams[0]?.generationConfig?.responseMimeType).toBe(
      "application/json",
    );
  });

  it("unwraps a fenced JSON response", async () => {
    const { client } = fakeClient([
      {
        text: '```json\n{"episodeTitle":"X","segments":[{"key":"intro","wordTarget":150}]}\n```',
      },
    ]);
    const generate = createGeminiGenerator({ client });
    await expect(generate(request)).resolves.toMatchObject({
      episodeTitle: "X",
    });
  });

  it("rejects output that violates a Zod refinement responseSchema cannot express", async () => {
    const { client } = fakeClient([
      {
        text: JSON.stringify({
          episodeTitle: "Dupes",
          segments: [
            { key: "intro", wordTarget: 150 },
            { key: "intro", wordTarget: 150 },
          ],
        }),
      },
    ]);
    const generate = createGeminiGenerator({ client });
    await expect(generate(request)).rejects.toThrow(
      /valid structured output.*unique/s,
    );
  });

  it("reports non-JSON output rather than returning garbage", async () => {
    const { client } = fakeClient([{ text: "I'm afraid I can't do that." }]);
    const generate = createGeminiGenerator({ client });
    await expect(generate(request)).rejects.toThrow(/was not JSON/);
  });

  it("surfaces the finish reason when the response has no text", async () => {
    const { client } = fakeClient([
      { throws: new Error("no candidates"), finishReason: "SAFETY" },
    ]);
    const generate = createGeminiGenerator({ client });
    await expect(generate(request)).rejects.toThrow(/finish reason: SAFETY/);
  });
});
