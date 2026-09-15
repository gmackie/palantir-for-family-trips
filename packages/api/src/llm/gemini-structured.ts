import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod/v4";

import {
  DEFAULT_SCRIPT_MODELS,
  type StructuredGenerator,
  type StructuredRequest,
} from "./structured";

/**
 * Gemini structured-output generator.
 *
 * Same contract as the Claude one (`extract-structured`): a Zod schema in, a
 * parsed value out. Gemini has no Zod helper, so the schema is converted to
 * the OpenAPI subset Gemini accepts as `responseSchema`, and the JSON it
 * returns is validated with the original Zod schema — refinements included,
 * which `responseSchema` cannot express.
 */

/** Keys Gemini's `responseSchema` understands. Everything else is dropped. */
const GEMINI_SCHEMA_KEYS = new Set([
  "type",
  // `format` is deliberately absent: Gemini accepts only a short allowlist of
  // format values and 400s on anything else, and nothing here needs one.
  "description",
  "nullable",
  "enum",
  "items",
  "properties",
  "required",
  "minItems",
  "maxItems",
]);

/** Extra output budget so reasoning tokens can't eat the prose allowance. */
export const THINKING_HEADROOM_TOKENS = 8192;

type JsonSchema = Record<string, unknown>;

function sanitize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitize);
  if (node === null || typeof node !== "object") return node;

  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(node as JsonSchema)) {
    if (!GEMINI_SCHEMA_KEYS.has(key)) continue;
    if (key === "properties" && value && typeof value === "object") {
      const properties: JsonSchema = {};
      for (const [name, child] of Object.entries(value as JsonSchema)) {
        properties[name] = sanitize(child);
      }
      out[key] = properties;
      continue;
    }
    out[key] = sanitize(value);
  }
  return out;
}

/**
 * Zod → Gemini `responseSchema`. Constraints Gemini rejects (minLength,
 * minimum, additionalProperties, $schema) are stripped; the Zod parse on the
 * way back still enforces them.
 */
export function toGeminiSchema(schema: z.ZodType): JsonSchema {
  return sanitize(z.toJSONSchema(schema, { io: "output" })) as JsonSchema;
}

/** Gemini occasionally fences JSON despite the response mime type. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

export function createGeminiGenerator(params: {
  apiKey?: string;
  model?: string;
  /** Test seam — anything with the SDK's `getGenerativeModel` shape. */
  client?: GoogleGenerativeAI;
}): StructuredGenerator {
  const apiKey =
    params.apiKey ??
    process.env.GEMINI_API_KEY ??
    process.env.GOOGLE_AI_API_KEY;
  if (!params.client && !apiKey) {
    throw new Error("GEMINI_API_KEY is required for Gemini script generation");
  }
  const client = params.client ?? new GoogleGenerativeAI(apiKey as string);
  const modelName = params.model ?? DEFAULT_SCRIPT_MODELS.gemini;

  return async function generate<T>(request: StructuredRequest<T>): Promise<T> {
    const model = client.getGenerativeModel(
      {
        model: modelName,
        systemInstruction: request.systemPrompt,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: toGeminiSchema(request.schema) as never,
          // Gemini 2.5 counts thinking tokens against maxOutputTokens, so a
          // caller's visible-prose budget would truncate long chapters
          // mid-sentence. Give thinking its own headroom on top.
          ...(request.maxTokens != null
            ? { maxOutputTokens: request.maxTokens + THINKING_HEADROOM_TOKENS }
            : {}),
        },
      },
      request.timeoutMs != null ? { timeout: request.timeoutMs } : undefined,
    );

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: request.userText }] }],
    });

    const usage = result.response.usageMetadata;
    if (usage) {
      request.onUsage?.({
        inputTokens: usage.promptTokenCount ?? 0,
        outputTokens: usage.candidatesTokenCount ?? 0,
      });
    }

    let raw: string;
    try {
      raw = result.response.text();
    } catch (error) {
      const reason = result.response.candidates?.[0]?.finishReason;
      throw new Error(
        `Gemini returned no usable text${reason ? ` (finish reason: ${reason})` : ""}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripCodeFence(raw));
    } catch {
      throw new Error(
        `Gemini failed to produce a valid structured output: response was not JSON (${raw.slice(0, 200)})`,
      );
    }

    const validated = request.schema.safeParse(parsed);
    if (!validated.success) {
      throw new Error(
        `Gemini failed to produce a valid structured output: ${z.prettifyError(validated.error)}`,
      );
    }
    return validated.data;
  };
}
