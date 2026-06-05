// Pure reconnect scheduler extracted from `useTripChat` so the idempotency +
// timer-cancellation logic can be unit-tested without a live socket or React.
//
// The bug this guards against: in the hook, `onDown` is registered on BOTH the
// socket's `close` and `error` events. A failed connection fires `error` THEN
// `close`, so without a guard the scheduling would run twice — orphaning the
// first reconnect timer (the cleanup's `clearTimeout` only holds the last one)
// and firing TWO parallel `connect()` calls. That compounds (2 → 4 → 8 sockets)
// on every blip and defeats the backoff entirely.
//
// `createReconnectScheduler` encapsulates a SINGLE connection attempt's "down"
// transition: a per-instance re-entry guard so the schedule runs at most once,
// plus cancellation of any pending timer before (re)scheduling. The hook creates
// a fresh scheduler per `connect()`, so the `down` guard resets naturally on the
// next attempt.

import { backoffDelay } from "./backoff";

export interface ReconnectSchedulerDeps {
  /** Whether the consumer intentionally closed the socket (suppresses retry). */
  isClosedByUs: () => boolean;
  /** Called once when the connection goes down (e.g. flip `connected` false). */
  onDisconnected: () => void;
  /** Schedule `connect` after `delayMs`; returns a cancellable timer handle. */
  setReconnectTimer: (
    connect: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  /** Cancel a previously scheduled reconnect timer. */
  clearReconnectTimer: (timer: ReturnType<typeof setTimeout>) => void;
  /** Reconnect to invoke after the backoff delay elapses. */
  connect: () => void;
  /** Zero-based retry count; read fresh and incremented per scheduled retry. */
  getAttempt: () => number;
  setAttempt: (attempt: number) => void;
}

export interface ReconnectScheduler {
  /**
   * Handle a socket going down. Idempotent for the lifetime of this scheduler:
   * the first call (from `error` OR `close`) schedules a reconnect; any further
   * calls (the matching `close`/`error`) are no-ops. Always cancels a pending
   * timer before scheduling so exactly one reconnect is ever in flight.
   */
  onDown: () => void;
}

/**
 * Create a per-connection reconnect scheduler. Each `connect()` in the hook
 * builds a new one, giving every attempt its own `down` guard.
 */
export function createReconnectScheduler(
  deps: ReconnectSchedulerDeps,
): ReconnectScheduler {
  let down = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const onDown = () => {
    // Re-entry guard: `error` then `close` both call this — only act once.
    if (down) return;
    down = true;

    deps.onDisconnected();

    if (deps.isClosedByUs()) return;

    // Cancel any pending reconnect before scheduling a fresh one so we never
    // orphan a timer (which would escape the hook's cleanup) or stack sockets.
    if (timer !== undefined) deps.clearReconnectTimer(timer);

    const attempt = deps.getAttempt();
    timer = deps.setReconnectTimer(deps.connect, backoffDelay(attempt));
    deps.setAttempt(attempt + 1);
  };

  return { onDown };
}
