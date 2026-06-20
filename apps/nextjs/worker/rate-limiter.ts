// `RateLimiter` — fixed-window rate limiter Durable Object.
//
// One instance per bucket key (addressed via `idFromName(key)`). The key is
// caller-defined, e.g. `chat-send:<userId>:<tripId>`. Each instance stores a
// simple `{ count, resetAt }` counter in DO storage and responds to POST
// `/check` requests with a `RateLimitResult` JSON body.
//
// Modeled on TripRoom: no external deps, only awaits DO storage, and declares
// the minimal Workers runtime surface it actually uses so `tsc --noEmit` stays
// clean without the full `@cloudflare/workers-types` package.

import type { Env } from "./index";

// --- Minimal ambient Cloudflare runtime surface ----------------------------

interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

interface DurableObjectState {
  storage: DurableObjectStorage;
}

// --- Pure helpers (unit-testable without the DO harness) -------------------

export interface FixedWindowState {
  count: number;
  resetAt: number; // epoch ms
}

export interface FixedWindowResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // epoch ms
  state: FixedWindowState; // updated state to persist
}

/**
 * Compute the next fixed-window state and decide whether the request is
 * allowed. Pure function: takes current state + current time + policy params,
 * returns the updated state and the decision. No I/O — the DO class handles
 * storage reads/writes around this call.
 *
 * Window resets when `now >= state.resetAt` (or on the very first call when
 * `state.resetAt === 0`).
 */
export function applyFixedWindow(
  state: FixedWindowState,
  now: number,
  limit: number,
  windowMs: number,
): FixedWindowResult {
  let { count, resetAt } = state;

  if (now >= resetAt) {
    // Start a fresh window.
    count = 0;
    resetAt = now + windowMs;
  }

  count += 1;
  const allowed = count <= limit;
  const remaining = Math.max(0, limit - count);

  return { allowed, remaining, resetAt, state: { count, resetAt } };
}

// --- The Durable Object -----------------------------------------------------

export class RateLimiter {
  private state: DurableObjectState;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname !== "/check" || req.method !== "POST") {
      return new Response("not found", { status: 404 });
    }

    let body: { key: string; limit: number; windowMs: number };
    try {
      body = (await req.json()) as {
        key: string;
        limit: number;
        windowMs: number;
      };
    } catch {
      return new Response("invalid json", { status: 400 });
    }

    const { limit, windowMs } = body;
    if (
      typeof limit !== "number" ||
      typeof windowMs !== "number" ||
      limit <= 0 ||
      windowMs <= 0
    ) {
      return new Response("invalid params", { status: 400 });
    }

    // Read current window state from DO storage.
    const stored = await this.state.storage.get<FixedWindowState>("w");
    const current: FixedWindowState = stored ?? { count: 0, resetAt: 0 };

    const now = Date.now();
    const result = applyFixedWindow(current, now, limit, windowMs);

    // Persist updated state.
    await this.state.storage.put("w", result.state);

    return new Response(
      JSON.stringify({
        allowed: result.allowed,
        remaining: result.remaining,
        resetAt: result.resetAt,
      }),
      { headers: { "content-type": "application/json" } },
    );
  }
}
