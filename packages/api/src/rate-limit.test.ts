import { TRPCError } from "@trpc/server";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertRateLimit,
  RECEIPT_OCR_RATE_LIMIT,
  receiptOcrRateLimitKey,
  resetRateLimitBuckets,
} from "./rate-limit";

afterEach(() => {
  resetRateLimitBuckets();
});

describe("assertRateLimit", () => {
  it("allows hits under the limit", () => {
    for (let i = 0; i < 5; i++) {
      expect(() =>
        assertRateLimit({ key: "t:a", limit: 5, windowMs: 60_000 }),
      ).not.toThrow();
    }
  });

  it("throws TOO_MANY_REQUESTS when over limit", () => {
    for (let i = 0; i < 3; i++) {
      assertRateLimit({ key: "t:b", limit: 3, windowMs: 60_000 });
    }
    try {
      assertRateLimit({
        key: "t:b",
        limit: 3,
        windowMs: 60_000,
        message: "slow down",
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("TOO_MANY_REQUESTS");
      expect((err as TRPCError).message).toBe("slow down");
    }
  });

  it("isolates buckets by key", () => {
    for (let i = 0; i < 2; i++) {
      assertRateLimit({ key: "t:c1", limit: 2, windowMs: 60_000 });
    }
    expect(() =>
      assertRateLimit({ key: "t:c2", limit: 2, windowMs: 60_000 }),
    ).not.toThrow();
  });
});

describe("receipt OCR rate limit helpers", () => {
  it("keys buckets per user", () => {
    expect(receiptOcrRateLimitKey("user_a")).toBe("receipt:ocr:user_a");
    expect(receiptOcrRateLimitKey("user_b")).not.toBe(
      receiptOcrRateLimitKey("user_a"),
    );
  });

  it("enforces the 5/minute receipt OCR budget", () => {
    const key = receiptOcrRateLimitKey("user_receipt");
    for (let i = 0; i < RECEIPT_OCR_RATE_LIMIT.limit; i++) {
      expect(() =>
        assertRateLimit({ key, ...RECEIPT_OCR_RATE_LIMIT }),
      ).not.toThrow();
    }
    expect(() => assertRateLimit({ key, ...RECEIPT_OCR_RATE_LIMIT })).toThrow(
      TRPCError,
    );
  });
});
