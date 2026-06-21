import Anthropic from "@anthropic-ai/sdk";

import {
  ClaudeReceiptExtractor,
  FERRY_EXTRACTION_SYSTEM_PROMPT,
} from "./claude-extractor";
import { extractStructured } from "./extract-structured";
import { GeminiReceiptExtractor } from "./gemini-extractor";
import { MockOCRProvider } from "./mock-provider";
import { type ReconcileResult, reconcileReceipt } from "./reconcile";
import type { OcrProvider } from "./review";
import {
  type FerryBooking,
  ferryBookingSchema,
  type ReceiptExtraction,
} from "./schema";

export {
  ClaudeReceiptExtractor,
  FERRY_EXTRACTION_SYSTEM_PROMPT,
} from "./claude-extractor";
export { extractStructured } from "./extract-structured";
export { GeminiReceiptExtractor } from "./gemini-extractor";
export { MockOCRProvider } from "./mock-provider";
export type { ReconcileResult } from "./reconcile";
export { reconcileReceipt } from "./reconcile";
export {
  needsOcrReview,
  OCR_PROVIDERS,
  OCR_REVIEW_CONFIDENCE_THRESHOLD,
  OCR_STATUSES,
  type OcrProvider,
  type OcrStatus,
} from "./review";
export type { FerryBooking, ReceiptExtraction } from "./schema";
export { ferryBookingSchema, receiptExtractionSchema } from "./schema";

export interface OCRProvider {
  extract(input: {
    imageBytes: Buffer;
    mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  }): Promise<ReceiptExtraction>;
}

/**
 * Resolves the OCR provider based on environment:
 * - DEV_MODE=local → MockOCRProvider (reads fixtures, no API cost)
 * - OCR_PROVIDER=fixture → MockOCRProvider (explicit override)
 * - OCR_PROVIDER=claude → ClaudeReceiptExtractor (explicit Claude)
 * - Otherwise → GeminiReceiptExtractor (Gemini Flash-Lite, default)
 */
export function resolveOCRProvider(): OCRProvider {
  const devMode = process.env.DEV_MODE === "local";
  const ocrOverride = process.env.OCR_PROVIDER;

  if (devMode || ocrOverride === "fixture") {
    const mock = new MockOCRProvider();
    return {
      async extract(input) {
        return mock.extract(input.imageBytes);
      },
    };
  }

  if (ocrOverride === "claude") {
    return new ClaudeReceiptExtractor();
  }

  return new GeminiReceiptExtractor();
}

/**
 * The provider name `resolveOCRProvider` would select, for persistence/audit.
 * Mirrors the same env precedence so the name matches the resolved provider.
 */
export function resolveOCRProviderName(): OcrProvider {
  const devMode = process.env.DEV_MODE === "local";
  const ocrOverride = process.env.OCR_PROVIDER;
  if (devMode || ocrOverride === "fixture") return "fixture";
  if (ocrOverride === "claude") return "claude";
  return "gemini";
}

/**
 * End-to-end receipt OCR: extract → reconcile.
 *
 * Returns the reconciled result (sanitized extraction + warnings + confidence)
 * plus the resolved provider name. Callers persist the result and surface
 * warnings to the user.
 */
export async function extractAndReconcileReceipt(input: {
  imageBytes: Buffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  provider?: OCRProvider;
}): Promise<ReconcileResult & { provider: OcrProvider }> {
  const provider = input.provider ?? resolveOCRProvider();
  const extraction = await provider.extract({
    imageBytes: input.imageBytes,
    mimeType: input.mimeType,
  });
  return {
    ...reconcileReceipt(extraction),
    provider: resolveOCRProviderName(),
  };
}

/**
 * Ferry booking OCR: extract a structured `FerryBooking` from a ticket/
 * confirmation image.
 *
 * Resolves the provider via the SAME env precedence as receipts:
 * - DEV_MODE=local or OCR_PROVIDER=fixture → MockOCRProvider (reads the ferry
 *   fixture, no API cost)
 * - OCR_PROVIDER=claude (and the Gemini default) → Claude via `extractStructured`
 *   with the ferry schema + prompt.
 *
 * Unlike receipts, there is no reconciliation pass — the booking fields are
 * surfaced directly to the form for review before persist.
 *
 * TODO(ferry): gemini ferry extraction — the Gemini receipt extractor isn't
 * generalized to arbitrary schemas yet, so the non-fixture/non-claude path
 * routes through Claude's `extractStructured` for v1.
 */
export async function extractFerryBooking(input: {
  imageBytes: Buffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
}): Promise<FerryBooking> {
  const devMode = process.env.DEV_MODE === "local";
  const ocrOverride = process.env.OCR_PROVIDER;

  if (devMode || ocrOverride === "fixture") {
    const mock = new MockOCRProvider();
    return mock.extractFerry(input.imageBytes);
  }

  return extractStructured({
    client: new Anthropic(),
    model: "claude-sonnet-4-6",
    systemPrompt: FERRY_EXTRACTION_SYSTEM_PROMPT,
    userText: "Extract this ferry booking into the structured JSON format.",
    schema: ferryBookingSchema,
    imageBytes: input.imageBytes,
    mimeType: input.mimeType,
  });
}
