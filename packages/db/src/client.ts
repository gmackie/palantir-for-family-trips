import { drizzle } from "drizzle-orm/d1";

import * as schema from "./schema";

export type DB = ReturnType<typeof drizzle<typeof schema>>;
// Derive the D1 binding type from drizzle so we don't need @cloudflare/workers-types.
type D1 = Parameters<typeof drizzle>[0];

// vinext (unlike OpenNext) has no getCloudflareContext(); the worker entry
// receives `env` in its fetch handler and hands us the D1 binding via
// setD1Binding(). The binding is stable per isolate, so the client is cached.
let d1Binding: D1 | undefined;
let cached: DB | undefined;

export function setD1Binding(d1: D1): void {
  d1Binding = d1;
}

function getD1(): D1 {
  if (!d1Binding) {
    throw new Error('Missing D1 binding "DB" — worker-entry must call setD1Binding(env.DB)');
  }
  return d1Binding;
}

export function createDb(): DB {
  cached ??= drizzle(getD1(), { schema, casing: "snake_case" });
  return cached;
}

export function resetDbClient(): void {
  cached = undefined;
}

// Same lazy proxy the app already imports as `db` — callers are unchanged.
export const db = new Proxy({} as DB, {
  get(_t, prop) {
    return Reflect.get(createDb(), prop);
  },
});
