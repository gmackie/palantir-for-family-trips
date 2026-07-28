import { describe, expect, it, vi } from "vitest";

// The hook module imports expo-location at top level; the pure state machine
// under test never touches it, so stub the native module out.
vi.mock("expo-location", () => ({}));

import {
  INITIAL_MOTION_STATE,
  MOVING_HOLD_MS,
  type MotionDebounceState,
  nextMotionState,
  normalizeSpeedMps,
  STOPPED_HOLD_MS,
  STOPPED_SPEED_MPS,
} from "./use-motion-mode";

describe("normalizeSpeedMps", () => {
  it("passes through valid speeds including zero", () => {
    expect(normalizeSpeedMps(0)).toBe(0);
    expect(normalizeSpeedMps(12.5)).toBe(12.5);
  });

  it("rejects negative, NaN, infinite, and missing readings", () => {
    expect(normalizeSpeedMps(-1)).toBeNull();
    expect(normalizeSpeedMps(Number.NaN)).toBeNull();
    expect(normalizeSpeedMps(Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalizeSpeedMps(null)).toBeNull();
    expect(normalizeSpeedMps(undefined)).toBeNull();
  });
});

describe("nextMotionState", () => {
  const moving = (state: MotionDebounceState, now: number) =>
    nextMotionState(state, STOPPED_SPEED_MPS + 1, now);
  const stopped = (state: MotionDebounceState, now: number) =>
    nextMotionState(state, 0, now);

  it("settles immediately from unknown in either direction", () => {
    expect(moving(INITIAL_MOTION_STATE, 0)).toEqual({
      mode: "moving",
      candidate: null,
    });
    expect(stopped(INITIAL_MOTION_STATE, 0)).toEqual({
      mode: "stopped",
      candidate: null,
    });
  });

  it("treats the stopped threshold as inclusive (speed == threshold is stopped)", () => {
    const next = nextMotionState(INITIAL_MOTION_STATE, STOPPED_SPEED_MPS, 0);
    expect(next.mode).toBe("stopped");
  });

  it("keeps the previous mode and pending candidate on null speed", () => {
    const state: MotionDebounceState = {
      mode: "moving",
      candidate: { mode: "stopped", since: 1_000 },
    };
    expect(nextMotionState(state, null, 5_000)).toBe(state);
  });

  it("does not flip moving→stopped until STOPPED_HOLD_MS elapses", () => {
    let state: MotionDebounceState = { mode: "moving", candidate: null };

    state = stopped(state, 0);
    expect(state.mode).toBe("moving");
    expect(state.candidate).toEqual({ mode: "stopped", since: 0 });

    state = stopped(state, STOPPED_HOLD_MS - 1);
    expect(state.mode).toBe("moving");

    state = stopped(state, STOPPED_HOLD_MS);
    expect(state).toEqual({ mode: "stopped", candidate: null });
  });

  it("does not flip stopped→moving until MOVING_HOLD_MS elapses", () => {
    let state: MotionDebounceState = { mode: "stopped", candidate: null };

    state = moving(state, 0);
    expect(state.mode).toBe("stopped");

    state = moving(state, MOVING_HOLD_MS - 1);
    expect(state.mode).toBe("stopped");

    state = moving(state, MOVING_HOLD_MS);
    expect(state).toEqual({ mode: "moving", candidate: null });
  });

  it("cancels a pending transition when the settled mode is observed again", () => {
    let state: MotionDebounceState = { mode: "moving", candidate: null };

    state = stopped(state, 0); // light goes red…
    expect(state.candidate?.mode).toBe("stopped");

    state = moving(state, 10_000); // …then green again before the hold
    expect(state).toEqual({ mode: "moving", candidate: null });

    // A fresh stop must restart the clock from scratch.
    state = stopped(state, 20_000);
    state = stopped(state, 20_000 + STOPPED_HOLD_MS - 1);
    expect(state.mode).toBe("moving");
  });

  it("restarts the candidate clock when the candidate direction changes", () => {
    let state: MotionDebounceState = {
      mode: "moving",
      candidate: { mode: "stopped", since: 0 },
    };
    // Same raw mode as the candidate but a different since: clock keeps
    // counting from the original candidate timestamp.
    state = stopped(state, STOPPED_HOLD_MS / 2);
    expect(state.candidate?.since).toBe(0);
  });
});
