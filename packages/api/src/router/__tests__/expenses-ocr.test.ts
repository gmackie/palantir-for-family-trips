import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/gmacko_test";

const {
  extractReceiptFromImage,
  MAX_RECEIPT_IMAGE_BASE64_CHARS,
  receiptExtractInputSchema,
} = await import("../expenses");

describe("expenses router — extractFromReceipt", () => {
  it("returns the reconciled fixture fields and persists nothing", async () => {
    const prev = process.env.OCR_PROVIDER;
    process.env.OCR_PROVIDER = "fixture";
    try {
      // Any image bytes resolve to the `default.json` receipt fixture (the mock
      // falls back to it when no hash matches), so no real OCR call is made.
      const imageBase64 = Buffer.from("any-receipt-photo").toString("base64");

      const result = await extractReceiptFromImage({
        imageBase64,
        mimeType: "image/png",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const { receipt } = result;
        expect(receipt.merchant).toBe("Corner Cafe");
        expect(receipt.currency).toBe("USD");
        expect(receipt.subtotalCents).toBe(2850);
        expect(receipt.taxCents).toBe(228);
        expect(receipt.tipCents).toBe(500);
        expect(receipt.totalCents).toBe(3578);
        expect(receipt.lineItems).toHaveLength(4);
        expect(receipt.lineItems[0]?.name).toBe("Avocado toast");
        expect(receipt.lineItems[0]?.lineTotalCents).toBe(1200);
        // Fixture provider, fully-reconciling amounts → max confidence, no review.
        expect(receipt.ocrProvider).toBe("fixture");
        expect(receipt.ocrStatus).toBe("success");
        expect(receipt.ocrConfidence).toBe(1);
        expect(receipt.ocrWarnings).toEqual([]);
        expect(receipt.needsReview).toBe(false);
      }
    } finally {
      if (prev === undefined) {
        process.env.OCR_PROVIDER = undefined;
      } else {
        process.env.OCR_PROVIDER = prev;
      }
    }
  });

  it("rejects an over-limit imageBase64 at the input boundary", () => {
    const tooBig = "a".repeat(MAX_RECEIPT_IMAGE_BASE64_CHARS + 1);
    const result = receiptExtractInputSchema.safeParse({
      workspaceId: "ws_1",
      tripId: "trip_1",
      imageBase64: tooBig,
      mimeType: "image/png",
    });
    expect(result.success).toBe(false);
  });

  it("accepts an imageBase64 at the size limit", () => {
    const atLimit = "a".repeat(MAX_RECEIPT_IMAGE_BASE64_CHARS);
    const result = receiptExtractInputSchema.safeParse({
      workspaceId: "ws_1",
      tripId: "trip_1",
      imageBase64: atLimit,
      mimeType: "image/png",
    });
    expect(result.success).toBe(true);
  });

  it("returns { ok: false } on an extraction failure without throwing", async () => {
    const prev = process.env.OCR_PROVIDER;
    // Force the Claude provider with no API key so extraction throws — the
    // mutation must fold that into `{ ok: false }`, never propagate it.
    process.env.OCR_PROVIDER = "claude";
    try {
      const result = await extractReceiptFromImage({
        imageBase64: Buffer.from("x").toString("base64"),
        mimeType: "image/png",
      });
      expect(result.ok).toBe(false);
    } finally {
      if (prev === undefined) {
        process.env.OCR_PROVIDER = undefined;
      } else {
        process.env.OCR_PROVIDER = prev;
      }
    }
  });
});
