import { describe, expect, it } from "vitest";

import {
  needsOcrReview,
  OCR_PROVIDERS,
  OCR_REVIEW_CONFIDENCE_THRESHOLD,
  OCR_STATUSES,
} from "../review";

describe("needsOcrReview", () => {
  it("flags a failed extraction regardless of confidence", () => {
    expect(needsOcrReview({ ocrConfidence: 1, ocrStatus: "failed" })).toBe(
      true,
    );
    expect(needsOcrReview({ ocrConfidence: null, ocrStatus: "failed" })).toBe(
      true,
    );
  });

  it("flags a successful but low-confidence extraction", () => {
    expect(
      needsOcrReview({
        ocrConfidence: OCR_REVIEW_CONFIDENCE_THRESHOLD - 0.01,
        ocrStatus: "success",
      }),
    ).toBe(true);
  });

  it("does not flag a confident extraction at or above the threshold", () => {
    expect(
      needsOcrReview({
        ocrConfidence: OCR_REVIEW_CONFIDENCE_THRESHOLD,
        ocrStatus: "success",
      }),
    ).toBe(false);
    expect(needsOcrReview({ ocrConfidence: 1, ocrStatus: "success" })).toBe(
      false,
    );
  });

  it("does not flag a manually-entered expense (no OCR metadata)", () => {
    expect(needsOcrReview({ ocrConfidence: null, ocrStatus: null })).toBe(
      false,
    );
  });

  it("exposes the provider and status unions for input validation", () => {
    expect(OCR_PROVIDERS).toContain("claude");
    expect(OCR_PROVIDERS).toContain("gemini");
    expect(OCR_PROVIDERS).toContain("fixture");
    expect(OCR_STATUSES).toEqual(["success", "failed"]);
  });
});
