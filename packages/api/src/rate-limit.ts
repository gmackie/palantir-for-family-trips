/**
 * Best-effort in-process sliding-window rate limiter.
 *
 * Suitable for Cloudflare Workers isolates and Node: each isolate enforces its
 * own limits (defense in depth, not a global quota). Prefer Durable Objects or
 * CF rate-limit bindings for harder multi-tenant abuse controls later.
 */

import { platformPrimitives } from "@sortey/config";
import { TRPCError } from "@trpc/server";

export interface RateLimitOptions {
  /** Unique bucket key, e.g. `chat:send:userId:tripId`. */
  key: string;
  /** Max allowed hits inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Optional human message for TOO_MANY_REQUESTS. */
  message?: string;
}

/**
 * Per-user receipt OCR budget (plan A17): 5 scans / minute across the
 * `extractFromReceipt` mutation and `/api/receipts/{scan,upload}` routes.
 */
export const RECEIPT_OCR_RATE_LIMIT = {
  limit: 5,
  windowMs: 60_000,
  message: "Too many receipt scans. Wait a moment and try again.",
} as const;

/** Build the shared bucket key for a user's receipt OCR calls. */
export function receiptOcrRateLimitKey(userId: string): string {
  return `receipt:ocr:${userId}`;
}

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();

/** Test helper — clears all buckets. */
export function resetRateLimitBuckets(): void {
  buckets.clear();
}

/**
 * Record a hit and throw TRPCError TOO_MANY_REQUESTS when over limit.
 * No-ops when platform rate limits are disabled.
 */
export function assertRateLimit(opts: RateLimitOptions): void {
  if (!platformPrimitives.rateLimits.enabled) return;

  const now = Date.now();
  const windowStart = now - opts.windowMs;
  let bucket = buckets.get(opts.key);
  if (!bucket) {
    bucket = { hits: [] };
    buckets.set(opts.key, bucket);
  }

  bucket.hits = bucket.hits.filter((t) => t > windowStart);

  if (bucket.hits.length >= opts.limit) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message:
        opts.message ??
        "Too many requests. Slow down and try again in a moment.",
    });
  }

  bucket.hits.push(now);

  // Bound map growth: drop empty buckets occasionally.
  if (buckets.size > 5_000) {
    for (const [k, b] of buckets) {
      if (b.hits.every((t) => t <= windowStart)) buckets.delete(k);
    }
  }
}
