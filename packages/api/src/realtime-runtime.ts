import { AsyncLocalStorage } from "node:async_hooks";

// The realtime "seam" that lets tRPC mutations fan a persisted event out to the
// TripRoom Durable Object without `chat.ts` (or any router) importing Workers
// bindings directly.
//
// Mirrors `@sortey/db`'s `runWithDatabaseRuntime` pattern: the worker entry
// (`apps/nextjs/worker/index.ts`) wraps each request in `runWithRealtimeRuntime`
// with a `broadcast` callback bound to `env.TRIP_ROOM`. `createTRPCContext` then
// reads the current runtime and exposes it as the optional `ctx.realtime` field.
//
// In unit tests (and any non-Workers caller) the store is empty, so
// `getRealtimeRuntime()` returns `null`, `ctx.realtime` is `undefined`, and the
// broadcast call in the procedure is skipped. This keeps the chat logic fns and
// procedures testable without a Workers env.

/** Payload broadcast to a TripRoom. Either a new message row or a delete tombstone. */
export type RealtimeBroadcast =
  | { type: "delete"; id: string }
  | Record<string, unknown>;

export interface RealtimeRuntime {
  /**
   * Fan an event out to every socket connected to `tripId`'s room. Best-effort:
   * implementations must never throw into the caller — a broadcast failure must
   * not roll back or block an already-persisted mutation.
   */
  broadcast(tripId: string, payload: RealtimeBroadcast): void;
}

const realtimeRuntimeStorage = new AsyncLocalStorage<RealtimeRuntime>();

export function runWithRealtimeRuntime<T>(
  runtime: RealtimeRuntime,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return realtimeRuntimeStorage.run(runtime, fn);
}

export function getRealtimeRuntime(): RealtimeRuntime | null {
  return realtimeRuntimeStorage.getStore() ?? null;
}
