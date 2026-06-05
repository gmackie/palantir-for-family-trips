import { describe, expect, it, vi } from "vitest";

import { backoffDelay } from "../backoff";
import {
  createReconnectScheduler,
  type ReconnectSchedulerDeps,
} from "../reconnect";

// Test harness: a fake timer registry + attempt cell, mirroring how the hook
// wires the effect-level `reconnectTimer`/`attempt` into the scheduler. We track
// each scheduled timer by a monotonic handle so we can assert how many distinct
// reconnects were ever scheduled (the bug stacked sockets) and which were
// cancelled before firing.
function makeHarness(over: Partial<ReconnectSchedulerDeps> = {}) {
  let nextHandle = 1;
  const scheduled: Array<{ handle: number; fn: () => void; delayMs: number }> =
    [];
  const cleared: number[] = [];
  let attempt = 0;
  const onDisconnected = vi.fn();
  const connect = vi.fn();

  const deps: ReconnectSchedulerDeps = {
    isClosedByUs: () => false,
    onDisconnected,
    setReconnectTimer: (fn, delayMs) => {
      const handle = nextHandle++;
      scheduled.push({ handle, fn, delayMs });
      // Cast: the hook uses real `setTimeout` handles; tests only need identity.
      return handle as unknown as ReturnType<typeof setTimeout>;
    },
    clearReconnectTimer: (timer) => {
      cleared.push(timer as unknown as number);
    },
    connect,
    getAttempt: () => attempt,
    setAttempt: (next) => {
      attempt = next;
    },
    ...over,
  };

  return {
    deps,
    scheduled,
    cleared,
    onDisconnected,
    connect,
    getAttempt: () => attempt,
  };
}

describe("createReconnectScheduler", () => {
  it("schedules exactly one reconnect when error+close both fire (the storm bug)", () => {
    const h = makeHarness();
    const { onDown } = createReconnectScheduler(h.deps);

    // A failed connection fires `error` THEN `close` — both call onDown.
    onDown();
    onDown();

    expect(h.scheduled).toHaveLength(1);
    expect(h.connect).not.toHaveBeenCalled(); // not until the timer fires
    // The single scheduled reconnect uses the attempt-0 backoff.
    expect(h.scheduled[0]?.delayMs).toBe(backoffDelay(0));
  });

  it("only flips disconnected + advances backoff once across the double-fire", () => {
    const h = makeHarness();
    const { onDown } = createReconnectScheduler(h.deps);

    onDown();
    onDown();
    onDown();

    expect(h.onDisconnected).toHaveBeenCalledTimes(1);
    expect(h.getAttempt()).toBe(1); // incremented once, not three times
  });

  it("fires connect when the single scheduled timer elapses", () => {
    const h = makeHarness();
    const { onDown } = createReconnectScheduler(h.deps);

    onDown();
    onDown();
    h.scheduled[0]?.fn();

    expect(h.connect).toHaveBeenCalledTimes(1);
  });

  it("does not schedule a reconnect when the close was intentional", () => {
    const h = makeHarness({ isClosedByUs: () => true });
    const { onDown } = createReconnectScheduler(h.deps);

    onDown();
    onDown();

    // Still flips connected=false exactly once, but never schedules a retry.
    expect(h.onDisconnected).toHaveBeenCalledTimes(1);
    expect(h.scheduled).toHaveLength(0);
  });

  it("uses the current attempt for the backoff delay (grows per attempt)", () => {
    let attempt = 3;
    const h = makeHarness({
      getAttempt: () => attempt,
      setAttempt: (next) => {
        attempt = next;
      },
    });
    const { onDown } = createReconnectScheduler(h.deps);

    onDown();

    expect(h.scheduled[0]?.delayMs).toBe(backoffDelay(3));
    expect(attempt).toBe(4);
  });

  it("a fresh scheduler per attempt resets the down guard (mirrors per-connect closures)", () => {
    // Simulate the hook creating a NEW scheduler on each connect(): the second
    // attempt's down-transition must schedule again, proving `down` is per
    // instance and not shared/sticky across reconnects.
    const h = makeHarness();

    const first = createReconnectScheduler(h.deps);
    first.onDown();
    first.onDown(); // double-fire on attempt 1 → 1 schedule

    const second = createReconnectScheduler(h.deps);
    second.onDown();
    second.onDown(); // double-fire on attempt 2 → 1 more schedule

    expect(h.scheduled).toHaveLength(2);
    expect(h.getAttempt()).toBe(2);
  });

  it("never orphans a timer: at most one is in flight per scheduler", () => {
    // The bug orphaned timers because two onDown calls each did
    // `reconnectTimer = setTimeout(...)`, losing the first handle so unmount's
    // clearTimeout could not cancel it. With the guard, a single onDown (even
    // when called twice) leaves exactly one scheduled timer and clears nothing
    // spuriously — so the hook's unmount cleanup can always cancel the live one.
    const h = makeHarness();
    const { onDown } = createReconnectScheduler(h.deps);

    onDown();
    onDown();

    expect(h.scheduled).toHaveLength(1);
    expect(h.cleared).toHaveLength(0);
  });
});
