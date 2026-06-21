import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod/v4";

/**
 * Generic Claude vision → Zod structured-output helper.
 *
 * Wraps `messages.parse()` with a caller-supplied Zod `schema`, `systemPrompt`,
 * and `userText`. The system prompt is cached (prompt-caching ephemeral) so
 * repeat calls only pay for the image + response tokens.
 *
 * This is the DRY core extracted from `ClaudeReceiptExtractor.extract` so that
 * receipt and ferry extraction (and any future vision→JSON task) share one
 * implementation. The `parsed_output` null-check / throw is preserved.
 */
export async function extractStructured<T>(params: {
  client: Anthropic;
  model: string;
  systemPrompt: string;
  userText: string;
  schema: z.ZodType<T>;
  imageBytes: Buffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
}): Promise<T> {
  const response = await params.client.messages.parse({
    model: params.model,
    max_tokens: 4096,
    // Cache the large system prompt — every subsequent request only pays
    // for the image + response tokens.
    system: [
      {
        type: "text",
        text: params.systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: params.mimeType,
              data: params.imageBytes.toString("base64"),
            },
          },
          {
            type: "text",
            text: params.userText,
          },
        ],
      },
    ],
    output_config: {
      format: zodOutputFormat(params.schema),
    },
  });

  if (!response.parsed_output) {
    throw new Error(
      `Claude vision failed to produce a valid structured extraction. Stop reason: ${response.stop_reason}`,
    );
  }

  return response.parsed_output as T;
}
