// `@sortey/realtime` — client realtime surface for the app.
//
// Primary export: the `useTripChat` hook (shared by `apps/nextjs` and
// `apps/expo`) plus the pure `mergeMessages` util it is built on. The legacy
// in-memory `triggerEvent` event log is re-exported as a compatibility shim for
// the expense tap-to-claim path (`packages/api/src/router/expenses.ts`) until it
// migrates to the Durable Object model.

export { backoffDelay, nextTypingSet } from "./backoff";
export type { RealtimeEvent } from "./event-log";
// Legacy compatibility shim — see ./event-log.ts.
export {
  getEventsSince,
  getLatestTimestamp,
  triggerEvent,
} from "./event-log";
export type {
  ChatMessage,
  DeleteTombstone,
  MergeItem,
} from "./messages";
export { mergeMessages } from "./messages";
export type {
  UseTripChatOptions,
  UseTripChatResult,
} from "./use-trip-chat";
export { useTripChat } from "./use-trip-chat";
