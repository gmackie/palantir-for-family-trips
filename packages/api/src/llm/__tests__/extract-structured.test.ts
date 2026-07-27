import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { generateStructured } from "../extract-structured";

const schema = z.object({ answer: z.string() });

function fakeClient(response: {
  parsed_output?: unknown;
  stop_reason?: string;
}) {
  const parse = vi.fn(async () => ({
    usage: { input_tokens: 10, output_tokens: 5 },
    stop_reason: "end_turn",
    ...response,
  }));
  return { client: { messages: { parse } } as unknown as Anthropic, parse };
}

describe("generateStructured", () => {
  it("text-only call: no image block, default max_tokens, usage reported", async () => {
    const { client, parse } = fakeClient({ parsed_output: { answer: "42" } });
    let usage: unknown;

    const result = await generateStructured({
      client,
      model: "m",
      systemPrompt: "sys",
      userText: "question",
      schema,
      onUsage: (u) => {
        usage = u;
      },
    });

    expect(result).toEqual({ answer: "42" });
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 5 });

    const call = parse.mock.calls[0]?.[0] as {
      max_tokens: number;
      messages: Array<{ content: Array<{ type: string }> }>;
      system: Array<{ cache_control?: unknown }>;
    };
    expect(call.max_tokens).toBe(4096);
    expect(call.messages[0]?.content.map((c) => c.type)).toEqual(["text"]);
    // System prompt stays cached (prompt-caching ephemeral).
    expect(call.system[0]?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("image call: image block precedes text; maxTokens override applies", async () => {
    const { client, parse } = fakeClient({ parsed_output: { answer: "ok" } });

    await generateStructured({
      client,
      model: "m",
      systemPrompt: "sys",
      userText: "read this",
      schema,
      image: { imageBytes: Buffer.from("img"), mimeType: "image/png" },
      maxTokens: 8192,
    });

    const call = parse.mock.calls[0]?.[0] as {
      max_tokens: number;
      messages: Array<{ content: Array<{ type: string }> }>;
    };
    expect(call.max_tokens).toBe(8192);
    expect(call.messages[0]?.content.map((c) => c.type)).toEqual([
      "image",
      "text",
    ]);
  });

  it("throws with the stop reason when no structured output came back", async () => {
    const { client } = fakeClient({
      parsed_output: null,
      stop_reason: "max_tokens",
    });
    await expect(
      generateStructured({
        client,
        model: "m",
        systemPrompt: "sys",
        userText: "q",
        schema,
      }),
    ).rejects.toThrow(/max_tokens/);
  });
});
