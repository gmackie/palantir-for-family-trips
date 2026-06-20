import { describe, expect, it } from "vitest";

import { applyFixedWindow, type FixedWindowState } from "../rate-limiter";

// Unit tests for the pure `applyFixedWindow` helper that drives the RateLimiter
// Durable Object. All cases are deterministic: we pass an explicit `now` so
// the window boundary behaviour can be tested without real time.

const LIMIT = 3;
const WINDOW_MS = 60_000;
const BASE_NOW = 1_000_000; // arbitrary epoch ms

/** Fresh state: no prior calls this window. */
const fresh: FixedWindowState = { count: 0, resetAt: 0 };

describe("applyFixedWindow", () => {
  it("allows the first hit", () => {
    const r = applyFixedWindow(fresh, BASE_NOW, LIMIT, WINDOW_MS);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(LIMIT - 1);
    expect(r.resetAt).toBe(BASE_NOW + WINDOW_MS);
    expect(r.state.count).toBe(1);
    expect(r.state.resetAt).toBe(BASE_NOW + WINDOW_MS);
  });

  it("allows hits up to the limit", () => {
    let state = fresh;
    for (let i = 0; i < LIMIT; i++) {
      const r = applyFixedWindow(state, BASE_NOW, LIMIT, WINDOW_MS);
      expect(r.allowed).toBe(true);
      state = r.state;
    }
    // count == LIMIT, remaining == 0
    expect(state.count).toBe(LIMIT);
  });

  it("blocks the (N+1)th hit within the same window", () => {
    // Exhaust the limit.
    let state = fresh;
    for (let i = 0; i < LIMIT; i++) {
      state = applyFixedWindow(state, BASE_NOW, LIMIT, WINDOW_MS).state;
    }
    // One more hit in the same window.
    const r = applyFixedWindow(state, BASE_NOW + 1, LIMIT, WINDOW_MS);
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it("resets the window after resetAt and allows again", () => {
    // Exhaust the limit.
    let state = fresh;
    for (let i = 0; i < LIMIT; i++) {
      state = applyFixedWindow(state, BASE_NOW, LIMIT, WINDOW_MS).state;
    }
    // Confirm blocked just before reset.
    expect(
      applyFixedWindow(state, state.resetAt - 1, LIMIT, WINDOW_MS).allowed,
    ).toBe(false);

    // At exactly resetAt, a new window starts and the hit is allowed.
    const r = applyFixedWindow(state, state.resetAt, LIMIT, WINDOW_MS);
    expect(r.allowed).toBe(true);
    expect(r.state.count).toBe(1);
    expect(r.state.resetAt).toBe(state.resetAt + WINDOW_MS);
  });

  it("remaining is clamped to 0 (never negative) when over-limit", () => {
    // Over-drive by calling multiple times past the limit.
    let state = fresh;
    for (let i = 0; i < LIMIT + 5; i++) {
      const r = applyFixedWindow(state, BASE_NOW, LIMIT, WINDOW_MS);
      state = r.state;
      if (!r.allowed) {
        expect(r.remaining).toBe(0);
      }
    }
  });
});
