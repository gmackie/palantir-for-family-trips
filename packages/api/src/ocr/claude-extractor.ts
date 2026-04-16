import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { receiptExtractionSchema, type ReceiptExtraction } from "./schema";

/**
 * Claude vision-based receipt extractor.
 *
 * Uses `messages.parse()` with a Zod schema to guarantee a valid
 * ReceiptExtraction shape. The system prompt is cached (prompt-caching
 * ephemeral) so repeat calls only pay for the image + response tokens.
 *
 * This is a thin wrapper — the caller is responsible for:
 * - Running reconciliation via `reconcileReceipt(extraction)`
 * - Persisting the result to the DB
 * - Handling rate limits (the SDK retries transient errors automatically)
 *
 * The real OCR pipeline defaults to Claude Sonnet 4.6 (cheaper than Opus,
 * plenty capable for receipts). This is an explicit override of the
 * claude-api skill's default — receipts are a narrow, well-structured task
 * and Sonnet's cost/latency profile fits the per-receipt use case better.
 * Override via the `model` option if you want to test against Opus.
 */

const RECEIPT_EXTRACTION_SYSTEM_PROMPT = `You are a receipt extraction system. Given an image of a receipt, produce a structured JSON object matching the provided schema.

Rules:
- Read every visible line item and return them in the order they appear.
- Use minor currency units (cents for USD, pence for GBP, yen as-is since JPY has no minor unit — treat 1 JPY = 100 "cents" for schema purposes).
- Detect the currency from the symbol or printed code. USD for $, EUR for €, GBP for £, JPY for ¥, etc. Return the ISO 4217 code.
- If the receipt's tax, tip, or subtotal are clearly printed, use those values exactly.
- If tip is not visible on the receipt, return tipCents: 0.
- lineItems should include only the purchased goods — never include tax, tip, subtotal, or total as line items.
- lineTotalCents for each item must equal quantity × unitPriceCents.
- The sum of lineTotalCents across all items should match subtotalCents within 2 cents. If it doesn't, return your best-effort interpretation and the downstream reconciliation check will flag it.
- For occurredAt, use the receipt's printed date and time as an ISO 8601 string. If time is missing, use 12:00:00 in the receipt's local time.
- Do not invent line items. If an item is unreadable, return "[unreadable]" as the name.
- Do not include card numbers, loyalty numbers, or other PII in the merchant name or line item names. The downstream PII scrubber will catch card patterns, but you should avoid emitting them in the first place.

Return only the JSON object matching the schema. No prose, no explanation.`;

export interface ClaudeOCROptions {
  /** Override the default Anthropic client (e.g. for tests). */
  client?: Anthropic;
  /** Override the model ID. Defaults to claude-sonnet-4-6. */
  model?: string;
  /** Override the system prompt (tests only — invalidates caching). */
  systemPrompt?: string;
}

export class ClaudeReceiptExtractor {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly systemPrompt: string;

  constructor(options: ClaudeOCROptions = {}) {
    this.client = options.client ?? new Anthropic();
    this.model = options.model ?? "claude-sonnet-4-6";
    this.systemPrompt = options.systemPrompt ?? RECEIPT_EXTRACTION_SYSTEM_PROMPT;
  }

  async extract(input: {
    imageBytes: Buffer;
    mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  }): Promise<ReceiptExtraction> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 4096,
      // Cache the large system prompt — every subsequent request only pays
      // for the image + response tokens.
      system: [
        {
          type: "text",
          text: this.systemPrompt,
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
                media_type: input.mimeType,
                data: input.imageBytes.toString("base64"),
              },
            },
            {
              type: "text",
              text: "Extract this receipt into the structured JSON format.",
            },
          ],
        },
      ],
      output_config: {
        format: zodOutputFormat(receiptExtractionSchema),
      },
    });

    if (!response.parsed_output) {
      throw new Error(
        `Claude vision failed to produce a valid receipt extraction. Stop reason: ${response.stop_reason}`,
      );
    }

    return response.parsed_output;
  }
}
