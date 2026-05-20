import { ClaudeReceiptExtractor } from "./claude-extractor";
import { GeminiReceiptExtractor } from "./gemini-extractor";
import { MockOCRProvider } from "./mock-provider";
import { type ReconcileResult, reconcileReceipt } from "./reconcile";
import type { ReceiptExtraction } from "./schema";

export { ClaudeReceiptExtractor } from "./claude-extractor";
export { GeminiReceiptExtractor } from "./gemini-extractor";
export { MockOCRProvider } from "./mock-provider";
export type { ReconcileResult } from "./reconcile";
export { reconcileReceipt } from "./reconcile";
export type { ReceiptExtraction } from "./schema";
export { receiptExtractionSchema } from "./schema";

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
 * End-to-end receipt OCR: extract → reconcile.
 *
 * Returns the reconciled result (sanitized extraction + warnings + confidence).
 * Callers persist the result and surface warnings to the user.
 */
export async function extractAndReconcileReceipt(input: {
  imageBytes: Buffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  provider?: OCRProvider;
}): Promise<ReconcileResult> {
  const provider = input.provider ?? resolveOCRProvider();
  const extraction = await provider.extract({
    imageBytes: input.imageBytes,
    mimeType: input.mimeType,
  });
  return reconcileReceipt(extraction);
}
