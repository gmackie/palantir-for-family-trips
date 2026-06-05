// Pure helpers extracted from `useTripChat` so the reconnect timing and the
// transient typing-set logic can be unit-tested without a live socket.

/**
 * Exponential backoff with a hard cap. `attempt` is the zero-based retry count
 * (0 = first retry). Delay doubles each attempt: `base * 2^attempt`, clamped to
 * `cap`. The hook resets `attempt` to 0 on a successful open so a healthy socket
 * always reconnects fast after the next blip.
 */
export function backoffDelay(
  attempt: number,
  base = 500,
  cap = 15_000,
): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  // Guard against overflow on large attempt counts before clamping.
  const raw = base * 2 ** Math.min(safeAttempt, 30);
  return Math.min(raw, cap);
}

/**
 * Reducer for the transient "who is typing" set. Each `typing` frame (re)arms a
 * per-user timer in the hook; this helper computes the next set when a user
 * starts typing or when their timer fires. Pure so the membership math is
 * testable independently of timers. Returns a NEW set (never mutates input).
 */
export function nextTypingSet(
  current: ReadonlySet<string>,
  action: { kind: "add"; userId: string } | { kind: "remove"; userId: string },
): Set<string> {
  const next = new Set(current);
  if (action.kind === "add") next.add(action.userId);
  else next.delete(action.userId);
  return next;
}
