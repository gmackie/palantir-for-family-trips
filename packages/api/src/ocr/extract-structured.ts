import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod/v4";

import { generateStructured } from "../llm/extract-structured";

/**
 * Claude vision → Zod structured-output helper for OCR callers.
 *
 * Thin adapter over the generic `generateStructured` in `../llm` — the image
 * is required here and `max_tokens` stays at the OCR default of 4096. Receipt
 * and ferry extraction (and any future vision→JSON task) share the one
 * implementation; the `parsed_output` null-check / throw lives there too.
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
  return generateStructured({
    client: params.client,
    model: params.model,
    systemPrompt: params.systemPrompt,
    userText: params.userText,
    schema: params.schema,
    image: {
      imageBytes: params.imageBytes,
      mimeType: params.mimeType,
    },
  });
}
