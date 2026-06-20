import { AsyncLocalStorage } from "node:async_hooks";

// The rate-limit "seam" that lets tRPC mutations enforce a per-key fixed-window
// counter backed by a Durable Object without any router importing Workers
// bindings directly.
//
// Mirrors `realtime-runtime.ts`: the worker entry (`apps/nextjs/worker/index.ts`)
// wraps each request in `runWithRateLimitRuntime` with a `check` callback bound
// to `env.RATE_LIMITER`. `createTRPCContext` reads the current runtime and
// exposes it as the optional `ctx.rateLimit` field.
//
// In unit tests (and any non-Workers caller) the store is empty, so
// `getRateLimitRuntime()` returns `null`, `ctx.rateLimit` is `null`, and the
// check call in the procedure is skipped (via optional chaining). This keeps
// routers testable without a Workers env.

export interface RateLimitCheck {
  /** Stable bucket key, e.g. `chat-send:<userId>:<tripId>`. */
  key: string;
  /** Max allowed events within the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // epoch ms
}

export interface RateLimitRuntime {
  check(input: RateLimitCheck): Promise<RateLimitResult>;
}

const rateLimitRuntimeStorage = new AsyncLocalStorage<RateLimitRuntime>();

export function runWithRateLimitRuntime<T>(
  runtime: RateLimitRuntime,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return rateLimitRuntimeStorage.run(runtime, fn);
}

export function getRateLimitRuntime(): RateLimitRuntime | null {
  return rateLimitRuntimeStorage.getStore() ?? null;
}
