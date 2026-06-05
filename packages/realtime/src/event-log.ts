// Legacy in-memory event log.
//
// This is the original `@sortey/realtime` stub, kept as a compatibility shim:
// `packages/api/src/router/expenses.ts` still calls `triggerEvent` for the
// tap-to-claim flow (line-item claim/unclaim). The trip-chat work repurposes the
// package's PUBLIC surface around `useTripChat`/`mergeMessages`, but until the
// expense realtime path migrates to the Durable Object model these exports must
// keep working unchanged. Re-exported from `index.ts`.

import { integrations } from "@sortey/config";

export interface RealtimeEvent {
  channel: string;
  event: string;
  data: Record<string, unknown>;
  timestamp: number;
}

const eventLog = new Map<string, RealtimeEvent[]>();
const MAX_EVENTS_PER_CHANNEL = 50;
const EVENT_TTL_MS = 60_000;

/**
 * Record an event in the in-memory log for a channel.
 *
 * Server-side callers (e.g. tRPC mutations) fire this after a state
 * change. Clients currently discover changes via 3-second polling;
 * a future SSE endpoint can stream from the same event log.
 */
export function triggerEvent(
  channel: string,
  event: string,
  data: Record<string, unknown>,
): boolean {
  if (!integrations.realtime.enabled) {
    return false;
  }

  const entry: RealtimeEvent = { channel, event, data, timestamp: Date.now() };

  if (!eventLog.has(channel)) {
    eventLog.set(channel, []);
  }

  const events = eventLog.get(channel)!;
  events.push(entry);

  // Prune old events
  const cutoff = Date.now() - EVENT_TTL_MS;
  const fresh = events.filter((e) => e.timestamp > cutoff);
  if (fresh.length > MAX_EVENTS_PER_CHANNEL) {
    fresh.splice(0, fresh.length - MAX_EVENTS_PER_CHANNEL);
  }
  eventLog.set(channel, fresh);

  return true;
}

/**
 * Return all events on a channel newer than `since` (epoch ms).
 * Useful for a future SSE or long-poll endpoint.
 */
export function getEventsSince(
  channel: string,
  since: number,
): RealtimeEvent[] {
  const events = eventLog.get(channel);
  if (!events) return [];
  return events.filter((e) => e.timestamp > since);
}

/**
 * Return the timestamp of the most recent event on a channel,
 * or 0 if no events exist.
 */
export function getLatestTimestamp(channel: string): number {
  const events = eventLog.get(channel);
  if (!events || events.length === 0) return 0;
  return events[events.length - 1]!.timestamp;
}
