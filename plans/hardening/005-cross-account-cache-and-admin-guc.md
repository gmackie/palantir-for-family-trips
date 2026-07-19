# Plan 005: Wipe persisted caches on sign-out; stop workspaceProcedure from downgrading the admin RLS role

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. This plan has two independent fixes (A: mobile
> shared-device cache leak, B: server-side RLS role downgrade) — they touch
> disjoint files and can be done in either order or split across two
> branches if preferred, but land in this one plan/PR unless told
> otherwise. When done, update the status row for this plan in
> `plans/hardening/README.md` (create it with a one-row table if it doesn't
> exist yet) — unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**: `git diff --stat 0c1ffab..HEAD -- apps/expo/src/utils/query-persist.ts apps/expo/src/utils/trip-offline-cache.ts apps/expo/src/utils/today-cache.ts apps/expo/src/utils/capture-outbox.ts apps/expo/src/utils/fuel-outbox.ts apps/expo/src/utils/journey-outbox.ts apps/expo/src/app/index.tsx apps/expo/src/app/settings.tsx packages/api/src/trpc.ts packages/api/src/auth/guards.ts packages/db/src/tenant.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MEDIUM
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `0c1ffab`, 2026-07-19

## Why this matters

### Part A — shared-device cross-account cache leak (`apps/expo`)

The Expo app persists trip data to the device's filesystem and SecureStore
so it works with weak cell service. None of that persisted state is wiped
on sign-out — only the in-memory react-query cache and three auth-specific
SecureStore keys are cleared. On a shared or reused device (a family
member's tablet, a demo device, a phone passed to a new trip member), the
**next** person to open the app and sign in with their own account can
still have the previous account's trip data sitting on disk, and outbox
queues can still contain the previous account's queued mutations
(expenses, pins, fuel logs, journey stops) waiting to sync — which would
then sync **under the new session's identity** if the outbox flush fires
before anyone notices.

### Part B — `workspaceProcedure` silently downgrades the platform-admin RLS role

`packages/api/src/trpc.ts`'s `rlsSessionMiddleware` looks up the caller's
real platform role from the `user` table and sets it as a Postgres session
GUC (`app.platform_role`) inside a transaction, so RLS policies that grant
platform-admin bypass (e.g. `application_settings`'s admin-only mutation
policies, `workspace_membership`'s `ownOrAdmin` predicate in
`packages/db/src/tenant.ts`) see the truth. `workspaceProcedure` — which
runs on the **same transaction** (`ctx.db` is already the `tx` from
`rlsSessionMiddleware` by the time `workspaceProcedure` runs, since it's a
middleware chained after `protectedProcedure`) — then re-applies the
session context with `platformRole: null` hardcoded, and
`packages/db/src/tenant.ts`'s `getDatabaseSessionSettings` turns `null`
into the string `"user"`. This overwrites the real role with `"user"` via
`set_config(..., true)` (transaction-local, so it doesn't leak *across*
requests, but it absolutely takes effect for the *rest of this one*). Any
platform admin calling a `workspaceProcedure`/`tripProcedure`-gated
mutation loses their RLS admin bypass for the remainder of that request,
silently — no error, just policies evaluating as if they were a regular
member.

## Current state

### Part A

Three file-backed cache modules, all writing under the same
`expo-file-system` directory (`${FileSystem.documentDirectory ??
""}sortey-cache/`), and three SecureStore-backed outbox queues:

**`apps/expo/src/utils/query-persist.ts`** (100 lines) — writes the
dehydrated react-query cache to
`${documentDirectory}sortey-cache/rq-persist-v1.json`. Exports
`persistQueryClient`, `restoreQueryClient`, `schedulePersist`. **No
clear/wipe export.**

**`apps/expo/src/utils/trip-offline-cache.ts`** (68 lines) — writes one
JSON file per trip to `${documentDirectory}sortey-cache/trip_<tripId>.json`
(driving summary, segments, zones, day plan, etc). Exports
`saveTripOfflineBundle`, `loadTripOfflineBundle`,
`tripOfflineBundleMeta`. **No clear/wipe export, and no "list all trip
files" export either** — wiping requires either a directory-level delete or
a list-and-delete-each helper.

**`apps/expo/src/utils/today-cache.ts`** (48 lines) — writes one JSON file
per `tripId`+`date` to `${documentDirectory}sortey-cache/today_<tripId>_<date>.json`.
Exports `saveTodaySnapshot`, `loadTodaySnapshot`. **No clear/wipe export.**

**Three outbox modules**, each pairing a platform-agnostic queue class
(`*-outbox.ts`, storage-backend-agnostic via a small `{ get, set }`
interface) with a native SecureStore-backed instance (`*-outbox-native.ts`,
the only backend actually instantiated anywhere in `apps/expo/src`):

| Module | SecureStore key | Class |
|---|---|---|
| `capture-outbox.ts` / `capture-outbox-native.ts` | `sortey.capture-outbox.v1` | `CaptureOutbox` |
| `fuel-outbox.ts` / `fuel-outbox-native.ts` | `sortey.fuel-outbox.v1` | (fuel outbox class) |
| `journey-outbox.ts` / `journey-outbox-native.ts` | `sortey.journey-outbox.v1` | (journey outbox class) |

None of the three expose a clear/reset method today (`CaptureOutbox` has
`list`/`pendingCount`/`enqueue`/`flush`/private `save` — no `clear`).

**Sign-out call sites** — there are **four**, not the two the initial
framing suggested (`index.tsx` alone has three separate inline handlers):

1. `apps/expo/src/app/index.tsx` `UserHeader.handleSignOut` (≈ lines 321-343)
2. `apps/expo/src/app/index.tsx` `WorkspaceGate`'s `noCookie` branch "Sign
   in" button (≈ lines 828-851) — a session-recovery path, not
   user-labeled "sign out", but it does the identical
   `authClient.signOut()` + SecureStore-delete + `queryClient.clear()`
   sequence and has the same gap
3. `apps/expo/src/app/index.tsx` `WorkspaceGate`'s `isError` branch "Sign
   out & retry" button (≈ lines 937-961)
4. `apps/expo/src/app/settings.tsx` `SignOutSection.handleSignOut` (≈ lines 1046-1068)

All four run the exact same sequence, verbatim:

```ts
try {
  await authClient.signOut();
} catch {
  // signOut may fail if session already expired
}
await SecureStore.deleteItemAsync("expo_cookie");
await SecureStore.deleteItemAsync("expo_session_data");
await SecureStore.deleteItemAsync("active_workspace_id");
queryClient.clear();
setSigningOut(false); // (or DevSettings.reload() in __DEV__, varies slightly)
```

None of the four touch `query-persist.ts`'s file, `trip-offline-cache.ts`'s
files, `today-cache.ts`'s files, or the three outbox SecureStore keys.

A fifth, related-but-out-of-scope gap found during this audit:
`apps/expo/src/app/settings.tsx`'s `AccountSection.handleDeleteAccount`
(≈ lines 1127-1150) calls `authClient.signOut()` on success but does
**none** of the SecureStore/cache clearing the four sign-out sites do —
worth fixing, but "delete account" already destroys the account
server-side, so its local-cache blast radius is smaller and its own
onSuccess path is a materially different code shape (a `useMutation`
success callback, not a `Pressable` handler). Flagged in Maintenance
notes, not fixed here to keep this plan's diff reviewable.

### Part B

**`packages/api/src/trpc.ts`** `rlsSessionMiddleware` (lines 328-363):

```ts
const rlsSessionMiddleware = t.middleware(async ({ ctx, next }) => {
  if (!ctx.session?.user) return next();

  let platformRole: string | null = null;
  try {
    const [dbUser] = await ctx.db.select({ role: user.role }).from(user).where(eq(user.id, ctx.session.user.id)).limit(1);
    platformRole = dbUser?.role ?? null;
  } catch { platformRole = null; }

  const sessionCtx = {
    tenancyMode: DEFAULT_TENANCY_MODE,
    userId: ctx.session.user.id,
    userEmail: ctx.session.user.email,
    workspaceId: null as string | null,
    platformRole: platformRole as "user" | "admin" | null,   // the REAL role
  };

  return withDatabaseSessionContext(ctx.db as never, sessionCtx, async (tx) =>
    next({ ctx: { ...ctx, db: tx as typeof ctx.db } }),   // ctx.db is now `tx` for everything downstream
  );
});

export const protectedProcedure = t.procedure
  .use(timingMiddleware)
  .use(({ ctx, next }) => { /* throws UNAUTHORIZED if no session */ })
  .use(rlsSessionMiddleware);   // line 381
```

**`packages/api/src/auth/guards.ts`** `workspaceProcedure` (175-203) is
built on `protectedProcedure` (via `tripProcedure` → `workspaceProcedure` →
implicitly runs after `protectedProcedure`'s middleware chain, since
`workspaceProcedure` calls `protectedProcedure.use(...)` — confirm this
chaining at the call site before assuming, but the doc comment on
`rlsSessionMiddleware` — "Runs the procedure inside a transaction so
`set_config(..., true)` stays local to the request" — plus `ctx.db` being
reassigned to `tx` inside it are strong evidence `workspaceProcedure`'s
`ctx.db` **is** that same transaction by the time it runs):

```ts
export function workspaceProcedure(workspaceIdKey = "workspaceId") {
  return protectedProcedure.use(async ({ ctx, input, next, getRawInput }) => {
    const rawInput = input ?? (await getRawInput());
    const workspaceId = readScopedId(rawInput, workspaceIdKey);
    const access = await resolveWorkspaceAccess(createTripAccessStore(ctx.db), {
      userId: ctx.session.user.id,
      workspaceId,
    });

    // Scope remaining RLS checks to this workspace (same transaction as rlsSessionMiddleware).
    await applyDatabaseSessionContext(ctx.db as never, {
      tenancyMode: "multi-tenant",
      userId: ctx.session.user.id,
      userEmail: ctx.session.user.email,
      workspaceId: access.workspaceId,
      platformRole: null,   // line 192 — HARDCODED, overwrites the real role rlsSessionMiddleware just set
    });

    return next({ ctx: { ...ctx, workspaceId: access.workspaceId, workspaceRole: access.workspaceRole } });
  });
}
```

**`packages/db/src/tenant.ts`** `getDatabaseSessionSettings` (23-33) is
where `null` becomes `"user"`:

```ts
export function getDatabaseSessionSettings(context: DatabaseSessionContext): Record<string, string> {
  return {
    "app.platform_role": context.platformRole ?? "user",   // line 27
    "app.tenancy_mode": context.tenancyMode,
    "app.user_email": context.userEmail ?? "",
    "app.user_id": context.userId,
    "app.workspace_id": context.workspaceId ?? "",
  };
}
```

`workspaceProcedure`'s own comment ("Scope remaining RLS checks to this
workspace — same transaction as rlsSessionMiddleware") shows the intent was
only to update `app.workspace_id`; `platformRole: null` looks like an
oversight from treating this as a from-scratch session-context object
instead of an update to the existing one — there's no code path that
re-reads `ctx.session.user`'s role here the way `rlsSessionMiddleware`
does, so the fix is to thread the value through, not re-derive it.

## Scope

**In scope** (the only files you should modify/create):
- `apps/expo/src/utils/query-persist.ts`
- `apps/expo/src/utils/trip-offline-cache.ts`
- `apps/expo/src/utils/today-cache.ts`
- `apps/expo/src/utils/capture-outbox.ts` (+ `capture-outbox-native.ts` if the clear needs a storage-level primitive beyond `set`)
- `apps/expo/src/utils/fuel-outbox.ts` (+ `-native.ts` likewise)
- `apps/expo/src/utils/journey-outbox.ts` (+ `-native.ts` likewise)
- `apps/expo/src/utils/sign-out.ts` (new — the single shared wipe helper, see Step 4)
- `apps/expo/src/app/index.tsx`
- `apps/expo/src/app/settings.tsx`
- `apps/expo/src/utils/sign-out.test.ts` (new)
- `packages/api/src/trpc.ts` (export the resolved `platformRole` on `ctx`, or export `rlsSessionMiddleware`'s resolution as a reusable value — see Step 6, pick the smaller-diff option once you're in the code)
- `packages/api/src/auth/guards.ts` (`workspaceProcedure`)
- `packages/api/src/auth/__tests__/guards.test.ts` (extend — if Step 3 of `plans/hardening/004-receipt-upload-authz-and-ratelimit.md` already created this file, add to it rather than recreating; check first)

**Out of scope** (do NOT touch, even though related):
- `apps/expo/src/app/settings.tsx` `AccountSection.handleDeleteAccount` — flagged in Current State as a related gap, not fixed here.
- `apps/nextjs/**` — the dashboard app doesn't persist this kind of local cache; this is an Expo-specific (shared-device, offline-first) problem.
- `packages/db/src/tenant.ts` `getDatabaseSessionSettings`'s `?? "user"` fallback itself — that fallback is correct behavior for a session that genuinely has no resolved role (e.g., `rlsSessionMiddleware`'s own `catch { platformRole = null }` on a DB error); the bug is `workspaceProcedure` passing a **hardcoded** `null` instead of the **already-resolved** value, not the fallback's existence.
- Any other `workspaceProcedure`/`tripProcedure` behavior — only the `platformRole` field of the `applyDatabaseSessionContext` call changes.

## Commands you will need

| Purpose            | Command                              | Expected on success |
|----------------------|--------------------------------------|----------------------|
| Expo typecheck       | `pnpm -F @sortey/expo typecheck`     | exit 0               |
| Expo lint            | `pnpm -F @sortey/expo lint`          | exit 0               |
| API typecheck        | `pnpm -F @sortey/api typecheck`      | exit 0               |
| API test             | `pnpm -F @sortey/api test`           | all pass             |
| API lint             | `pnpm -F @sortey/api lint`           | exit 0               |
| Format check         | `pnpm format:check` (fix with `pnpm format:fix`) | exit 0   |

**Important environment note, verified against `0c1ffab`**: `apps/expo`
has **no `test` script** in its `package.json`, and **no `vitest`
dependency** — despite five existing `*.test.ts` files under
`apps/expo/src/utils/` (`capture-outbox.test.ts`, `fuel-outbox.test.ts`,
`journey-outbox.test.ts`, `journey-timeline.test.ts`,
`workspace-store.test.ts`) that import from `vitest`. Running `pnpm -F
@sortey/expo exec vitest ...` in this environment fails with `ERR_PNPM_
RECURSIVE_EXEC_FIRST_FAIL Command "vitest" not found`. These existing test
files are, as far as this plan's audit could determine, **not currently run
by any `pnpm`/`turbo` command** in this repo. This plan does not fix that
gap (see Maintenance notes) — the new `sign-out.test.ts` in Step 5 follows
the same pattern as the existing outbox tests for consistency and future-
readiness, but its Done-criteria bar is "written and internally consistent
with the existing test files' style," not "passes via a command you can
run today." Do not report a false green by inventing a passing test-run
command that doesn't actually exist in this repo.

## Git workflow

- Branch: `hardening/005-cross-account-cache-and-admin-guc`
- Commits: e.g. `feat(expo): add clear/wipe APIs to persisted cache and outbox modules`, `fix(expo): wipe all persisted state on every sign-out path`, `fix(api): stop workspaceProcedure from downgrading the resolved platform role`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add `clear()` to the three file-backed cache modules

- `query-persist.ts`: `export async function clearPersistedQueryCache(): Promise<void> { try { await FileSystem.deleteAsync(CACHE_PATH, { idempotent: true }); } catch { /* best-effort, matches the module's existing error style */ } }`
- `trip-offline-cache.ts`: there's no existing "list all trip files" export, so add one and a clear built on it: `export async function clearAllTripOfflineBundles(): Promise<void> { try { const info = await FileSystem.getInfoAsync(DIR); if (!info.exists) return; const names = await FileSystem.readDirectoryAsync(DIR); await Promise.all(names.filter((n) => n.startsWith("trip_")).map((n) => FileSystem.deleteAsync(`${DIR}${n}`, { idempotent: true }))); } catch { /* best-effort */ } }`
- `today-cache.ts`: same pattern, filtering on the `today_` prefix: `export async function clearAllTodaySnapshots(): Promise<void> { ... names.filter((n) => n.startsWith("today_")) ... }`

Match each module's existing best-effort `try { ... } catch { /* best-effort */ }` error-handling convention exactly — don't introduce a new error-propagation style into files that are consistently silent-on-failure today.

**Verify**: `pnpm -F @sortey/expo typecheck` → exit 0

### Step 2: Add `clear()` to the three outbox classes

In each of `capture-outbox.ts`, `fuel-outbox.ts`, `journey-outbox.ts`, add
a `clear()` method to the outbox class that writes an empty list through
the existing storage interface (reuse the existing private `save`
method/pattern where one exists):

```ts
async clear(): Promise<void> {
  await this.save([]); // or the module's equivalent private persist call
}
```

This goes through the same `CaptureOutboxStorage`-style `{ get, set }`
interface every other mutation in these classes uses — no changes needed
to the `*-outbox-native.ts` files, since `clear()` calls `storage.set(...)`
exactly like `enqueue`/`flushOnce` already do. Confirm `fuel-outbox.ts` and
`journey-outbox.ts` have the same `private save(...)`-shaped internals as
`capture-outbox.ts` before assuming this pattern transfers directly — read
both files first.

**Verify**: `pnpm -F @sortey/expo typecheck` → exit 0

### Step 3: Regression tests for the new clear methods

Follow the existing `capture-outbox.test.ts` convention (`memoryStorage()`
fake implementing the storage interface) — add a case per outbox module:

```ts
it("clear empties the outbox", async () => {
  const outbox = new CaptureOutbox(memoryStorage());
  await outbox.enqueue(expense({ clientId: "e1" }));
  expect(await outbox.pendingCount()).toBe(1);
  await outbox.clear();
  expect(await outbox.pendingCount()).toBe(0);
});
```

Add equivalent tests to `fuel-outbox.test.ts` and `journey-outbox.test.ts`.
Per the environment note above, these run under the same "written, not
provably run via a repo command today" caveat as the files they extend —
do not block on getting them to execute if the pre-existing sibling tests
in the same files also don't execute in this environment; confirm that
premise first, though (verify it's still true, don't just assume the
environment note above is permanently accurate).

### Step 4: One shared `signOutAndWipe()` helper

Rather than repeating the same growing list of `SecureStore.deleteItemAsync`
+ cache-clear calls at all four call sites (already duplicated three ways
before this plan even started), consolidate into
`apps/expo/src/utils/sign-out.ts`:

```ts
import * as SecureStore from "expo-secure-store";
import type { QueryClient } from "@tanstack/react-query";

import { clearPersistedQueryCache } from "./query-persist";
import { clearAllTripOfflineBundles } from "./trip-offline-cache";
import { clearAllTodaySnapshots } from "./today-cache";
import { captureOutbox } from "./capture-outbox-native";
import { fuelOutbox } from "./fuel-outbox-native"; // confirm the actual exported instance name in this file before assuming
import { journeyOutbox } from "./journey-outbox-native"; // same

/**
 * Full local wipe for sign-out: auth session, active workspace, every
 * persisted trip/today cache file, and every outbox queue. Call this from
 * every sign-out / forced-reauth path — do not hand-roll the individual
 * deletes at a new call site.
 */
export async function signOutAndWipe(queryClient: QueryClient): Promise<void> {
  await Promise.allSettled([
    SecureStore.deleteItemAsync("expo_cookie"),
    SecureStore.deleteItemAsync("expo_session_data"),
    SecureStore.deleteItemAsync("active_workspace_id"),
    clearPersistedQueryCache(),
    clearAllTripOfflineBundles(),
    clearAllTodaySnapshots(),
    captureOutbox.clear(),
    fuelOutbox.clear(),
    journeyOutbox.clear(),
  ]);
  queryClient.clear();
}
```

Use `Promise.allSettled`, not `Promise.all` — a single failing wipe
(e.g. a locked file) must not stop the others from running, matching the
existing best-effort ethos of every module this touches. Confirm the real
exported singleton names in `capture-outbox-native.ts` /
`fuel-outbox-native.ts` / `journey-outbox-native.ts` before writing the
imports (the plan's audit found `captureOutbox` in the capture module;
verify the fuel/journey equivalents rather than assuming identical naming).

**Verify**: `pnpm -F @sortey/expo typecheck` → exit 0

### Step 5: Wire `signOutAndWipe()` into all four sign-out call sites

In `apps/expo/src/app/index.tsx`:
- `UserHeader.handleSignOut`: replace the `authClient.signOut()` + four
  manual lines with `try { await authClient.signOut(); } catch {} await
  signOutAndWipe(queryClient);`
- `WorkspaceGate`'s `noCookie` branch button and `isError` branch "Sign out
  & retry" button: same replacement.

In `apps/expo/src/app/settings.tsx`:
- `SignOutSection.handleSignOut`: same replacement.

All four already import `queryClient` from `~/utils/api` — confirm this
import exists at each call site (it does in the excerpts read for this
plan) before assuming it's already in scope; add the import if a given
call site doesn't already have it.

Add `apps/expo/src/utils/sign-out.test.ts` mirroring the outbox test
convention: a fake `QueryClient`-shaped object with a `clear` spy, fake
storage-backed instances of each dependency, and assert
`signOutAndWipe(...)` calls every one of the nine operations exactly once
and then `queryClient.clear()`. Same "written but not provably run today"
caveat as Step 3.

**Verify**: `pnpm -F @sortey/expo typecheck` → exit 0; `pnpm -F @sortey/expo lint` → exit 0; manually re-read all four call sites and confirm none still contains a bare `SecureStore.deleteItemAsync("expo_cookie")`-style inline sequence (`grep -n "expo_cookie" apps/expo/src/app/index.tsx apps/expo/src/app/settings.tsx` should show it only inside `sign-out.ts` after this step, not inline in either app file)

### Step 6: Fix `workspaceProcedure`'s `platformRole` downgrade

Two viable approaches — pick whichever is the smaller diff once you're
reading the real code, and confirm your choice doesn't fight `tRPC`'s
context-typing:

**Option A (preferred if it typechecks cleanly)**: have
`rlsSessionMiddleware` put the resolved `platformRole` on `ctx` (e.g.
`ctx.platformRole`) via its `next({ ctx: { ...ctx, db: tx, platformRole } })`
call, then have `workspaceProcedure` read `ctx.platformRole` instead of
hardcoding `null`:

```ts
// trpc.ts, inside rlsSessionMiddleware:
return withDatabaseSessionContext(ctx.db as never, sessionCtx, async (tx) =>
  next({ ctx: { ...ctx, db: tx as typeof ctx.db, platformRole: sessionCtx.platformRole } }),
);
```

```ts
// guards.ts, inside workspaceProcedure:
await applyDatabaseSessionContext(ctx.db as never, {
  tenancyMode: "multi-tenant",
  userId: ctx.session.user.id,
  userEmail: ctx.session.user.email,
  workspaceId: access.workspaceId,
  platformRole: (ctx as { platformRole?: "user" | "admin" | null }).platformRole ?? null,
});
```

**Option B**: export a small resolver from `trpc.ts` (or a shared module)
that both `rlsSessionMiddleware` and `workspaceProcedure` call — riskier
because it means re-querying the `user` table a second time per request
unless memoized, and this plan should not introduce a second DB round-trip
per request as a side effect of a one-line fix; only reach for this option
if Option A's `ctx` typing turns out to be genuinely unworkable (e.g. the
tRPC context type is sealed in a way that rejects the extra field) — in
that case, stop and report the typing obstacle rather than silently
degrading to the extra-query approach.

Either way, when `ctx.session?.user` is falsy `rlsSessionMiddleware`
`return next()`s immediately (no transaction, no `platformRole` on ctx) —
`workspaceProcedure` runs on `protectedProcedure`, which already throws
`UNAUTHORIZED` before this point if there's no session, so `ctx.platformRole`
being `undefined` in that branch is unreachable in practice, but keep the
`?? null` fallback in the read so the types stay honest.

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0

### Step 7: Regression test for the role passthrough

Extend `packages/api/src/auth/__tests__/guards.test.ts` (created by
`plans/hardening/004-receipt-upload-authz-and-ratelimit.md`'s Step 3 if
that plan already ran — check first and add to the existing file rather
than recreating it; otherwise create it fresh here). Since
`applyDatabaseSessionContext` ultimately calls `ctx.db.execute(...)` with a
raw `sql` tagged template, the cleanest unit-level assertion is against
`getDatabaseSessionSettings` directly (already tested in
`packages/db/src/__tests__/tenant.test.ts` for the `?? "user"` fallback
behavior) plus a source-grep pin on `workspaceProcedure` itself, since
`workspaceProcedure` isn't built with an injectable store the way
`resolveTripAccess` is:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

it("workspaceProcedure does not hardcode platformRole: null", () => {
  const source = readFileSync(join(import.meta.dirname, "..", "guards.ts"), "utf8");
  const fnBody = source.slice(source.indexOf("export function workspaceProcedure"));
  expect(fnBody).not.toMatch(/platformRole:\s*null,?\s*\n/);
});
```

Adjust the regex/slice once you see the actual post-fix source (the point
is: assert the literal `platformRole: null` is gone from
`workspaceProcedure`, however you choose to word the guard once the real
diff exists).

**Verify**: `pnpm -F @sortey/api exec vitest run src/auth/__tests__/guards.test.ts` → all pass

### Step 8: Full package checks

**Verify**: `pnpm -F @sortey/expo typecheck` → exit 0; `pnpm -F @sortey/expo lint` → exit 0; `pnpm -F @sortey/api test` → all pass; `pnpm -F @sortey/api typecheck` → exit 0; `pnpm -F @sortey/api lint` → exit 0; `pnpm format:check` → exit 0

## Test plan

See Steps 3, 5, 7. Part A: each cache/outbox module's `clear()` is unit
tested per-module (in-memory fakes, matching existing convention);
`signOutAndWipe()` is unit tested against fakes of all nine dependencies;
manual `grep` confirms no sign-out call site still hand-rolls the old
partial sequence. Part B: a source-grep pin confirms the hardcoded
`platformRole: null` is gone from `workspaceProcedure`; existing
`tenant.test.ts` coverage of `getDatabaseSessionSettings`'s `?? "user"`
fallback is untouched (that fallback is correct and out of scope).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm -F @sortey/expo typecheck` exits 0
- [ ] `pnpm -F @sortey/expo lint` exits 0
- [ ] `pnpm -F @sortey/api typecheck` exits 0
- [ ] `pnpm -F @sortey/api test` exits 0, including the extended/new `guards.test.ts`
- [ ] `pnpm -F @sortey/api lint` exits 0
- [ ] `grep -rn "signOutAndWipe" apps/expo/src/app/index.tsx apps/expo/src/app/settings.tsx` shows exactly four call sites (one per handler identified in Current State)
- [ ] `grep -n "expo_cookie" apps/expo/src/app/index.tsx apps/expo/src/app/settings.tsx` shows **no** matches (the inline delete sequences are gone, consolidated into `sign-out.ts`)
- [ ] `grep -n "clear" apps/expo/src/utils/query-persist.ts apps/expo/src/utils/trip-offline-cache.ts apps/expo/src/utils/today-cache.ts apps/expo/src/utils/capture-outbox.ts apps/expo/src/utils/fuel-outbox.ts apps/expo/src/utils/journey-outbox.ts` shows a new export/method in every file
- [ ] `grep -n "platformRole: null" packages/api/src/auth/guards.ts` shows **no** matches
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/hardening/README.md` status row updated (create the file with a one-row table if it doesn't exist)

## STOP conditions

Stop and report back (do not improvise) if:

- Any excerpt above doesn't match the live code (call sites/line numbers may have shifted since `0c1ffab`).
- `fuel-outbox.ts` or `journey-outbox.ts`'s internal shape doesn't actually match `capture-outbox.ts`'s `private save(...)` pattern closely enough for Step 2's `clear()` to transfer directly — report the actual shape rather than forcing a mismatched abstraction.
- The exported singleton names in `fuel-outbox-native.ts` / `journey-outbox-native.ts` aren't `fuelOutbox`/`journeyOutbox` (Step 4 assumed parallelism with `capture-outbox-native.ts`'s `captureOutbox` without reading those two files directly) — use the real names, don't rename the modules to fit the plan's guess.
- Option A in Step 6 doesn't typecheck cleanly against tRPC's context typing — do not fall back to Option B's extra-DB-query approach without reporting the obstacle first; a second per-request `user` table lookup is a meaningful enough behavior change that it deserves explicit sign-off.
- You discover `workspaceProcedure` is NOT actually running on the same transaction `rlsSessionMiddleware` produced (i.e. `ctx.db` at that point is not `tx`) — that would mean Part B's root-cause analysis is wrong and the actual bug (or non-bug) needs re-diagnosis before any fix lands.

## Maintenance notes

- `apps/expo` has no wired unit-test runner (`test` script or `vitest`
  dependency) despite five pre-existing `*.test.ts` files that assume one.
  This plan follows that existing (broken) convention for its own new
  tests rather than fixing the gap, to keep this security plan's diff
  focused — a follow-up plan should either add `vitest` +  a `test` script
  + a `vitest.config.ts` to `apps/expo`, or delete the dead test files if
  the intent was always to test outbox logic indirectly via `packages/api`
  instead. Either way, leaving this silently broken means Part A's own new
  tests (and the five pre-existing ones) currently provide **zero**
  actual CI protection — flag this loudly to whoever reviews this plan's
  PR, don't let the new test files create a false sense of coverage.
- `AccountSection.handleDeleteAccount` in `settings.tsx` has the same
  missing-wipe gap as the four sign-out sites (see Current State) — worth a
  small follow-up once `signOutAndWipe()` exists, since it'd likely be a
  one-line call to the same helper (account deletion probably wants to
  skip the `authClient.signOut()` try/catch since the mutation itself
  already invalidates the session server-side — check before assuming
  it's a drop-in call).
- Any *future* persisted-storage module in `apps/expo` (new offline cache,
  new outbox) should register its wipe in `sign-out.ts` in the same PR that
  introduces it — this plan doesn't add an enforcement mechanism (e.g. a
  registry the app asserts is fully drained at startup after a fresh
  sign-in), just the fix for what exists today.
