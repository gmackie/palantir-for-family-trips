// Pure, client-safe OCR review helpers.
//
// This module deliberately imports NOTHING from the provider SDKs (Anthropic /
// Gemini) or any server-only code, so it is safe to import into client
// components (e.g. the expense detail UI) AND the server alike. It is exposed
// via the `@sortey/api/ocr/review` subpath for exactly that reason — importing
// from `@sortey/api/ocr` would drag the extractor SDKs into the client bundle.

/** OCR providers the pipeline can resolve to. `fixture` is the dev/test mock. */
export const OCR_PROVIDERS = ["claude", "gemini", "fixture"] as const;
export type OcrProvider = (typeof OCR_PROVIDERS)[number];

/** Whether an OCR attempt produced a usable extraction or threw. */
export const OCR_STATUSES = ["success", "failed"] as const;
export type OcrStatus = (typeof OCR_STATUSES)[number];

/**
 * Below this reconciler confidence, a human should eyeball the extracted
 * expense before it is trusted. Mirrors (and now centralizes) the threshold the
 * web client previously hard-coded inline when deciding whether to auto-fill.
 */
export const OCR_REVIEW_CONFIDENCE_THRESHOLD = 0.8;

/**
 * Whether an OCR-derived expense needs a human review pass: the extraction
 * failed outright, or it came back below the confidence threshold.
 *
 * Returns `false` for manually-entered expenses (no OCR metadata) and for
 * confident extractions. Reconciler warnings are surfaced in the UI regardless;
 * they already depress `ocrConfidence`, so they don't independently force review.
 */
export function needsOcrReview(state: {
  ocrConfidence: number | null;
  ocrStatus: OcrStatus | null;
}): boolean {
  if (state.ocrStatus === "failed") return true;
  return (
    state.ocrConfidence != null &&
    state.ocrConfidence < OCR_REVIEW_CONFIDENCE_THRESHOLD
  );
}
