import Anthropic from "@anthropic-ai/sdk";

import { extractStructured } from "./extract-structured";
import { type ReceiptExtraction, receiptExtractionSchema } from "./schema";

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

export const FERRY_EXTRACTION_SYSTEM_PROMPT = `You are a ferry booking extraction system. Given an image (or PDF page) of a ferry ticket or booking confirmation, produce a structured JSON object matching the provided schema.

Rules:
- operator: the ferry operator or line as printed, e.g. "Washington State Ferries", "BC Ferries", "Caledonian MacBrayne".
- departureTerminal / arrivalTerminal: the dock/terminal names for the crossing, e.g. "Edmonds" → "Kingston". Use the printed terminal names, not city names, when both appear.
- departureAt: the scheduled departure as an ISO 8601 string. Use the printed sailing date and time. If only a date is printed with no time, use 12:00:00 in local time.
- confirmationNumber: the booking/confirmation/reservation number if printed, otherwise null.
- fareCents: the total fare actually charged, in minor currency units (cents for USD, pence for GBP, etc.). If no price is printed, return null. Do not invent a fare.
- currency: the ISO 4217 code detected from the symbol or printed code (USD for $, EUR for €, GBP for £, CAD, etc.).
- vehicleReservation: true if the booking includes a reserved vehicle space (car/RV/motorcycle), false for a passenger-only/walk-on ticket.
- passengerNote: a short free-text summary of what was booked, e.g. "Car + 2 passengers" or "2 adult walk-on", if such detail is printed; otherwise null.
- Do not include card numbers, loyalty numbers, or other PII in any field.

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
    this.systemPrompt =
      options.systemPrompt ?? RECEIPT_EXTRACTION_SYSTEM_PROMPT;
  }

  async extract(input: {
    imageBytes: Buffer;
    mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  }): Promise<ReceiptExtraction> {
    return extractStructured({
      client: this.client,
      model: this.model,
      systemPrompt: this.systemPrompt,
      userText: "Extract this receipt into the structured JSON format.",
      schema: receiptExtractionSchema,
      imageBytes: input.imageBytes,
      mimeType: input.mimeType,
    });
  }
}
