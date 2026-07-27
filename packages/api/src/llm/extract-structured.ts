import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod/v4";

/**
 * Generic Claude → Zod structured-output helper.
 *
 * Wraps `messages.parse()` with a caller-supplied Zod `schema`, `systemPrompt`,
 * and `userText`. The system prompt is cached (prompt-caching ephemeral) so
 * repeat calls only pay for the input + response tokens.
 *
 * Generalized from the OCR-only helper (`../ocr/extract-structured`): the
 * image is now optional, `maxTokens` is configurable (long-form generation
 * like Corridor Cast scripts needs more than the OCR default), and callers
 * can observe token usage for cost accounting.
 */

export type StructuredImageInput = {
  imageBytes: Buffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
};

export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
};

export async function generateStructured<T>(params: {
  client: Anthropic;
  model: string;
  systemPrompt: string;
  userText: string;
  schema: z.ZodType<T>;
  image?: StructuredImageInput;
  maxTokens?: number;
  onUsage?: (usage: LlmUsage) => void;
}): Promise<T> {
  const content: Anthropic.ContentBlockParam[] = [];
  if (params.image) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: params.image.mimeType,
        data: params.image.imageBytes.toString("base64"),
      },
    });
  }
  content.push({ type: "text", text: params.userText });

  const response = await params.client.messages.parse({
    model: params.model,
    max_tokens: params.maxTokens ?? 4096,
    // Cache the large system prompt — every subsequent request only pays
    // for the input + response tokens.
    system: [
      {
        type: "text",
        text: params.systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content }],
    output_config: {
      format: zodOutputFormat(params.schema),
    },
  });

  params.onUsage?.({
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  if (!response.parsed_output) {
    throw new Error(
      `Claude failed to produce a valid structured output. Stop reason: ${response.stop_reason}`,
    );
  }

  return response.parsed_output as T;
}
