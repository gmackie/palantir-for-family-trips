# Plan 006: Add a Durable Object-backed rate limiter and apply it to chat.send and the share-link join

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat bbc54f6..HEAD -- packages/api/src/router/chat.ts packages/api/src/router/trips.ts packages/api/src/trpc.ts apps/nextjs/worker apps/nextjs/wrangler.jsonc`
> Compare against "Current state" before proceeding; on a mismatch, treat it
> as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED-HIGH — new Workers infra (a Durable Object + binding +
  migration) plus changes to two hot write paths. Wrong limits or a throwing
  limiter could block legitimate traffic.
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `bbc54f6`, 2026-06-12

## Why this matters

Two procedures carry explicit `TODO(ratelimit)` markers and are the obvious
abuse surfaces, but there is **no shared rate-limit utility yet** — the TODOs
say "once a shared util exists." This plan builds that util the way the rest of
this codebase reaches Durable Objects (the realtime seam) and applies it:

- `chat.send` (`chat.ts:229`) — a high-frequency authenticated write; a member
  can spam a trip's chat and its push-notification fan-out.
- `trips.*` share-link join (`trips.ts:1087`) — an authenticated-token entry
  point; brute force / join spam.

On Cloudflare Workers, an in-memory counter is useless (per-isolate, ephemeral).
A Durable Object gives a single consistent counter per key — matching the
existing `TripRoom` DO pattern this repo already runs.

## Current state — the seam pattern to mirror

This repo already has a "runtime seam" that lets routers reach a Durable Object
without importing Workers bindings, and degrades to a no-op in unit tests.
**You will clone this pattern for rate limiting.** Read these first:

- `packages/api/src/realtime-runtime.ts` — defines `RealtimeRuntime`, an
  `AsyncLocalStorage`, `runWithRealtimeRuntime(runtime, fn)`, and
  `getRealtimeRuntime()` returning `null` off-Workers.
- `packages/api/src/trpc.ts` — exposes `realtime: getRealtimeRuntime()` on the
  context in **both** return objects (the apiKey branch near line 202 and the
  main `return` near line 231). `ctx.realtime` is therefore `undefined`/`null`
  in tests.
- `apps/nextjs/worker/index.ts` — wraps the request: `broadcastToTripRoom(env,
  tripId, payload)` (lines ~101–118) talks to `env.TRIP_ROOM` via
  `idFromName`/`get`/`fetch`; the handler is wrapped in
  `runWithRealtimeRuntime({ broadcast: ... }, () => handler.fetch(...))` (lines
  ~282–293); `export { TripRoom } from "./trip-room";` (line ~302).
- `apps/nextjs/worker/trip-room.ts` — a Durable Object class implementation to
  model the new one on.
- `apps/nextjs/wrangler.jsonc` — `durable_objects.bindings` has `{ name:
  "TRIP_ROOM", class_name: "TripRoom" }` (line ~55) and `migrations` has
  `{ tag: "v1", new_sqlite_classes: ["TripRoom"] }` (line ~57).

The two target procedures:

- `chat.ts:228-231`:
```ts
    .mutation(async ({ ctx, input }) => {
      // TODO(ratelimit): chat send is a high-frequency authenticated write —
      // wrap with a per-user / per-trip rate limiter once a shared util exists.
      const message = await sendMessage(createChatStore(ctx.db), {
```
- `trips.ts:1087-1089`:
```ts
    .mutation(async ({ ctx, input }) => {
      // TODO(ratelimit): this is an unauthenticated-token entry point — wrap
      // with a per-IP / per-user rate limiter once a shared util exists.
      const result = await joinTripByShareToken(createTripStore(ctx.db), {
```

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Install   | `pnpm install`                   | exit 0              |
| Typecheck (api) | `pnpm -F @sortey/api typecheck` | exit 0          |
| Typecheck (nextjs) | `pnpm -F @sortey/nextjs typecheck` | exit 0       |
| Tests     | `pnpm -F @sortey/api test`       | all pass (unchanged — limiter is no-op in tests) |
| Worker tests | `pnpm -F @sortey/nextjs test` (if a worker test script exists) | pass |
| Lint      | `pnpm -F @sortey/api lint`       | exit 0              |

## Scope

**In scope**:
- `packages/api/src/ratelimit-runtime.ts` (create — the seam, mirrors realtime-runtime.ts)
- `packages/api/src/trpc.ts` (add `rateLimit: getRateLimitRuntime()` to both ctx objects)
- `packages/api/src/router/chat.ts` (apply the check in `send`)
- `packages/api/src/router/trips.ts` (apply the check in the share-link join)
- `apps/nextjs/worker/rate-limiter.ts` (create — the Durable Object class)
- `apps/nextjs/worker/index.ts` (add `checkRateLimit` helper + wrap handler + export class)
- `apps/nextjs/wrangler.jsonc` (add binding + migration)
- A test for the limiter logic (see Test plan)

**Out of scope** (do NOT touch):
- The realtime seam / `TripRoom` — model on it, don't modify it.
- Other procedures — only the two named hot paths get a limiter in this plan.
- The `integrations.rateLimits` config flags — leave as-is.

## Git workflow

- Work on the current branch.
- Commit style: `feat(api): add Durable Object rate limiter for chat.send + share-link join`.
- Do NOT push or open a PR.

## Steps

### Step 1: Create the rate-limit seam

Create `packages/api/src/ratelimit-runtime.ts`, mirroring
`realtime-runtime.ts` exactly but for an **async** check:

```ts
import { AsyncLocalStorage } from "node:async_hooks";

export interface RateLimitCheck {
  /** Stable bucket key, e.g. `chat-send:<userId>:<tripId>`. */
  key: string;
  /** Max allowed events within the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // epoch ms
}

export interface RateLimitRuntime {
  check(input: RateLimitCheck): Promise<RateLimitResult>;
}

const rateLimitRuntimeStorage = new AsyncLocalStorage<RateLimitRuntime>();

export function runWithRateLimitRuntime<T>(
  runtime: RateLimitRuntime,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return rateLimitRuntimeStorage.run(runtime, fn);
}

export function getRateLimitRuntime(): RateLimitRuntime | null {
  return rateLimitRuntimeStorage.getStore() ?? null;
}
```

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0.

### Step 2: Expose ctx.rateLimit

In `packages/api/src/trpc.ts`, add `rateLimit: getRateLimitRuntime()` to BOTH
context return objects, right next to the existing `realtime:
getRealtimeRuntime()` line (import `getRateLimitRuntime` at the top). In unit
tests this is `null`, so `ctx.rateLimit?` is a no-op.

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0.

### Step 3: Apply the check in the two procedures

Add a small private helper near each procedure (or inline) that throws when
not allowed:

```ts
const rl = await ctx.rateLimit?.check({
  key: `chat-send:${ctx.session.user.id}:${ctx.tripId}`,
  limit: 30,
  windowMs: 60_000,
});
if (rl && !rl.allowed) {
  throw new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: "You're sending messages too quickly. Please slow down.",
  });
}
```

For the share-link join in `trips.ts`, key on the joining user:
`key: \`share-join:${ctx.session.user.id}\``, `limit: 10`, `windowMs: 60_000`,
message "Too many join attempts. Please wait a moment." Place each check at the
very top of the `.mutation` body, replacing the `TODO(ratelimit)` comment.
Confirm `TRPCError` is already imported in each file (it is used elsewhere in
both).

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0;
`pnpm -F @sortey/api test` → all pass (limiter is `null` in tests, so behavior
is unchanged).

### Step 4: Implement the Durable Object

Create `apps/nextjs/worker/rate-limiter.ts` modeled on `trip-room.ts`. A
fixed-window counter is sufficient: the DO is addressed by the bucket key
(`idFromName(key)`), stores `{ count, resetAt }` in DO storage, and on each
`fetch`:
- read current state; if `now >= resetAt`, reset `count = 0`, `resetAt = now +
  windowMs`;
- increment `count`;
- `allowed = count <= limit`;
- persist and return JSON `{ allowed, remaining: max(0, limit - count),
  resetAt }`.

The DO receives `limit`/`windowMs` per request (pass them in the fetch URL/body
from the helper in Step 5). Keep it dependency-free and synchronous-ish (only
`await` DO storage).

**Verify**: `pnpm -F @sortey/nextjs typecheck` → exit 0.

### Step 5: Wire the DO into the worker

In `apps/nextjs/worker/index.ts`:
- Add `RATE_LIMITER: DurableObjectNamespace;` to the `Env` interface (next to
  `TRIP_ROOM`).
- Add a `checkRateLimit(env, input): Promise<RateLimitResult>` helper modeled
  on `broadcastToTripRoom`: `env.RATE_LIMITER.idFromName(input.key)` → `get` →
  `fetch` a request carrying `key/limit/windowMs`, parse the JSON result. On
  ANY error, **fail open** (return `{ allowed: true, ... }`) so a limiter
  outage never blocks all writes — and log it.
- Wrap the handler in `runWithRateLimitRuntime({ check: (input) =>
  checkRateLimit(env, input) }, () => ...)`, nested with the existing
  `runWithRealtimeRuntime` wrap.
- `export { RateLimiter } from "./rate-limiter";` alongside the `TripRoom`
  export.

**Verify**: `pnpm -F @sortey/nextjs typecheck` → exit 0.

### Step 6: Register the DO in wrangler

In `apps/nextjs/wrangler.jsonc`:
- Add `{ name: "RATE_LIMITER", class_name: "RateLimiter" }` to
  `durable_objects.bindings`.
- Add a new migration entry: `{ tag: "v2", new_sqlite_classes: ["RateLimiter"]
  }` (keep the existing `v1` entry; migrations are append-only).

**Verify**: the file is valid JSONC (no trailing-comma/syntax error) and
`pnpm -F @sortey/nextjs typecheck` → exit 0. If the repo has a wrangler
dry-run/validate script, run it.

### Step 7: Full gate

**Verify**: `pnpm -F @sortey/api test` → all pass;
`pnpm -F @sortey/api lint` → exit 0;
`pnpm -F @sortey/nextjs typecheck` → exit 0.

## Test plan

- **Limiter logic unit test**: extract the fixed-window decision (the
  `count/resetAt` update + `allowed` computation) into a pure function inside
  `rate-limiter.ts` (e.g. `applyFixedWindow(state, now, limit, windowMs)`), and
  unit-test it where the worker tests live (see
  `apps/nextjs/worker/__tests__/`). Cases: first hit allowed; Nth hit at the
  limit allowed; (N+1)th blocked; after `resetAt` the window resets and allows
  again.
- **Router no-op**: the existing `@sortey/api` tests must pass unchanged,
  proving `ctx.rateLimit?` is a safe no-op when the runtime is absent.
- Verification: `pnpm -F @sortey/api test` and the worker test command → all
  pass.

## Done criteria

- [ ] `packages/api/src/ratelimit-runtime.ts` exists and mirrors the realtime seam
- [ ] `grep -n "rateLimit:" packages/api/src/trpc.ts` shows it added to both ctx objects
- [ ] `grep -n "TOO_MANY_REQUESTS" packages/api/src/router/chat.ts packages/api/src/router/trips.ts` → one hit each
- [ ] `grep -rn "TODO(ratelimit)" packages/api/src` → no matches
- [ ] `apps/nextjs/worker/rate-limiter.ts` exists; `RateLimiter` exported from the worker entry; `RATE_LIMITER` binding + `v2` migration in `wrangler.jsonc`
- [ ] `pnpm -F @sortey/api typecheck`, `pnpm -F @sortey/nextjs typecheck` exit 0
- [ ] `pnpm -F @sortey/api test` exits 0 (unchanged); the new limiter-logic test passes
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `realtime-runtime.ts` / the worker wiring doesn't match the "Current state"
  description (the seam was refactored) — the mirror approach may not apply.
- The Workers runtime types for Durable Objects aren't available to
  `rate-limiter.ts` the way `trip-room.ts` has them (binding/types mismatch).
- Wrangler rejects the second migration tag or the new binding.
- Applying the check changes the existing `@sortey/api` test results (it must
  not — the runtime is null in tests; if tests break, the wiring leaked a
  non-null runtime into tests).
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The limiter **fails open** by design (availability over strict enforcement).
  If strict enforcement is ever required, revisit `checkRateLimit`'s catch.
- Limits (30/min chat, 10/min join) are conservative starting points — a
  reviewer/operator may tune them; they live at the call sites in Step 3.
- Fixed-window has burst edges at boundaries; if that matters later, swap the
  DO internals for a sliding window without touching the seam or call sites.
- Adding a limiter to a third procedure is now a one-liner via `ctx.rateLimit`.
