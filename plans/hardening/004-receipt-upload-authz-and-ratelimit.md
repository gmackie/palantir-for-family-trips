# Plan 004: Authorize receipt uploads before storage/OCR side effects; make the OCR rate limit durable

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/hardening/README.md` (create it with a one-row table if it
> doesn't exist yet) — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 0c1ffab..HEAD -- apps/nextjs/src/app/api/receipts/upload/route.ts packages/api/src/auth/guards.ts packages/api/src/rate-limit.ts packages/api/package.json`
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

`apps/nextjs/src/app/api/receipts/upload/route.ts` is a Next.js Route
Handler (not a tRPC procedure), so it doesn't get `tripProcedure()`'s
membership check for free. The handler:

1. Requires a signed-in session (line 44-46).
2. Validates form fields exist and the mime type is allowed (61-79).
3. Rate-limits (81-93, receipt-OCR-specific, skippable via `skipOcr`).
4. **Writes the image to durable storage** (`storeReceiptImage`, line 101).
5. **Calls the paid OCR provider** (`extractAndReconcileReceipt`, line 169,
   only when `skipOcr` is false).
6. Only *after* both of those side effects, calls
   `caller.expenses.attachReceiptImage(...)` (line 206) — which runs inside
   `tripProcedure()` and is the **only** point in this handler that checks
   the caller belongs to `workspaceId`/`tripId`, or that `expenseId`
   belongs to that trip.

Session auth (step 1) proves *who* the caller is; it proves nothing about
*which trips they can touch*. Between step 1 and step 6, the handler trusts
client-supplied `workspaceId`/`tripId`/`expenseId` form fields with zero
membership check. A signed-in user for any workspace can `POST` arbitrary
image bytes with someone else's `tripId`/`expenseId` and:

- Force a durable-storage write billed/quota'd to that trip/workspace
  (`storeReceiptImage`), which only fails at step 6 (too late — the write
  already happened, `stored.storageKey` is simply discarded on the
  `attachReceiptImage` throw).
- Force a **paid** OCR provider call (`extractAndReconcileReceipt`) against
  the trip's/workspace's budget, again discarded after the fact.
- Consume the OCR rate-limit bucket for their own `userId` regardless of
  which trip they targeted — this part is at least correctly scoped to the
  caller, but it doesn't stop the two side effects above.

Separately, `assertRateLimit` (`packages/api/src/rate-limit.ts`) is an
in-memory `Map` at module scope (line 42, `const buckets = new Map()`). Its
own doc comment says it plainly: "Suitable for Cloudflare Workers isolates
and Node: each isolate enforces its own limits (defense in depth, not a
global quota)." On Cloudflare Workers (this app deploys there —
`apps/nextjs/package.json`'s `deploy:cloudflare*` scripts, `vinext` +
`wrangler`), every isolate gets its own `buckets` Map, so the "5 scans /
minute" `RECEIPT_OCR_RATE_LIMIT` is actually "5 scans / minute / isolate,
times however many isolates are live" — effectively unenforced under any
real traffic spread, on the one route in the codebase calling a paid,
per-request LLM OCR provider.

## Current state

**`apps/nextjs/src/app/api/receipts/upload/route.ts`** (verified line
numbers against `0c1ffab`):

```ts
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // ... (48-60) parse formData: file, workspaceId, tripId, expenseId, skipOcr
  // ... (61-71) validate required fields present
  // ... (73-79) validate mime type

  if (!skipOcr) {                                   // 81
    try {
      assertRateLimit({ key: receiptOcrRateLimitKey(session.user.id), ...RECEIPT_OCR_RATE_LIMIT });
    } catch (error) { /* 429 */ }
  }

  const bytes = Buffer.from(await file.arrayBuffer());  // 95

  const r2 = getR2Bucket() as ...;
  let stored;
  try {
    stored = await storeReceiptImage({ bytes, mimeType, r2: r2 ?? undefined });  // 101 — DURABLE WRITE, no membership check yet
  } catch (error) { /* 400 */ }

  // ... (116-166) skipOcr branch: parse client-supplied OCR provenance, no membership check
  // else (167-194):
  const result = await extractAndReconcileReceipt({ imageBytes: bytes, mimeType });  // 169 — PAID OCR CALL, no membership check yet

  const caller = appRouter.createCaller(await createTRPCContext({ headers: new Headers(request.headers), authApi: auth.api }));  // 198
  try {
    await caller.expenses.attachReceiptImage({ workspaceId, tripId, expenseId, storageKey: stored.storageKey, ... });  // 206 — FIRST membership/trip check, via tripProcedure()
  } catch (error) { /* 400 */ }

  return NextResponse.json({ storageKey: stored.storageKey, ... });
}
```

**`packages/api/src/auth/guards.ts`** has the primitives this route needs,
but `createTripAccessStore` (line 62) is **not exported** — only
`resolveWorkspaceAccess` (136), `resolveTripAccess` (155),
`workspaceProcedure` (175), `tripProcedure` (205) are:

```ts
function createTripAccessStore(db: any): TripAccessStore {   // line 62 — not exported
  return {
    findWorkspaceAccess: async ({ userId, workspaceId }) => { ... },
    findTripAccess: async ({ userId, workspaceId, tripId }) => { ... },
  };
}

export async function resolveTripAccess(
  store: TripAccessStore,
  input: { userId: string; workspaceId: string; tripId: string },
): Promise<TripAccess> {
  const access = await store.findTripAccess(input);
  if (!access) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You do not belong to this trip." });
  }
  return access;
}
```

`packages/api/package.json`'s `exports` map has no `"./auth/guards"`
subpath today — only `.`, `./openapi`, `./versioning`, `./deprecation`,
`./workspace`, `./ocr`, `./ocr/review`. The `"./ocr/review"` entry is the
pattern to copy for a new `"./auth/guards"` entry.

**`packages/api/src/rate-limit.ts`** (84 lines total):

```ts
/**
 * Best-effort in-process sliding-window rate limiter.
 *
 * Suitable for Cloudflare Workers isolates and Node: each isolate enforces
 * its own limits (defense in depth, not a global quota). Prefer Durable
 * Objects or CF rate-limit bindings for harder multi-tenant abuse controls
 * later.
 */
import { platformPrimitives } from "@sortey/config";
import { TRPCError } from "@trpc/server";

export const RECEIPT_OCR_RATE_LIMIT = { limit: 5, windowMs: 60_000, message: "..." } as const;
export function receiptOcrRateLimitKey(userId: string): string { return `receipt:ocr:${userId}`; }

const buckets = new Map<string, Bucket>();   // line 42 — module-scope, per-isolate

export function assertRateLimit(opts: RateLimitOptions): void {
  if (!platformPrimitives.rateLimits.enabled) return;
  // sliding window over `buckets`
}
```

`packages/config/src/integrations.ts:69-80` shows `platformPrimitives.rateLimits.enabled` is a static `true` (not a runtime/DB flag), so `assertRateLimit` is always active — the gap is purely that its state doesn't survive across isolates/instances, not that it's disabled.

This repo has no existing test harness for Next.js Route Handlers —
`apps/nextjs/vitest.worker.config.ts` only includes
`worker/__tests__/**/*.test.ts` (Cloudflare Durable Object tests, run under
`@cloudflare/vitest-pool-workers`), so `pnpm -F @sortey/nextjs test` will
not discover or run a test placed under `src/app/api/**`. This plan does
not expand that test surface (see Scope/STOP conditions) — it relies on the
existing `packages/api` vitest setup for what it can, and a source-level
pinning check for the ordering property.

## Scope

**In scope** (the only files you should modify/create):
- `apps/nextjs/src/app/api/receipts/upload/route.ts`
- `packages/api/src/auth/guards.ts` (export `createTripAccessStore`)
- `packages/api/package.json` (add `"./auth/guards"` subpath export)
- `packages/api/src/auth/__tests__/guards.test.ts` (new)
- `packages/api/src/router/__tests__/receipt-upload-authz-order.test.ts` (new — cross-package source-grep pinning test, see Step 4)
- `packages/api/src/rate-limit.ts`
- `packages/api/src/rate-limit-store.ts` (new — the durable-limiter abstraction, see Step 5)

**Out of scope** (do NOT touch, even though related):
- `apps/nextjs/vitest.worker.config.ts` / adding a general Next.js route-handler test harness — real, valuable follow-up, but a test-infra change with its own blast radius; do not fold it into a security-authz fix. Flag it in Maintenance notes instead.
- Any other route under `apps/nextjs/src/app/api/**` — this plan only touches the receipt upload route; if the audit turns up the same before-auth-side-effect shape elsewhere, report it, don't fix it here.
- `packages/api/src/router/expenses.ts` `attachReceiptImage` itself — it's already correctly gated by `tripProcedure()`; the fix here is calling an equivalent check *earlier*, not changing that mutation.
- Actually provisioning a Durable Object or KV namespace — Step 5 only builds the storage-agnostic interface and an in-memory default (matching today's behavior) plus a documented seam; wiring a real Cloudflare Durable Object binding is infra work with its own deploy/rollout considerations and needs a human decision on binding name/wrangler config, not something to improvise inside this plan.

## Commands you will need

| Purpose         | Command                              | Expected on success |
|------------------|--------------------------------------|----------------------|
| API typecheck    | `pnpm -F @sortey/api typecheck`      | exit 0               |
| API test         | `pnpm -F @sortey/api test`           | all pass             |
| API lint         | `pnpm -F @sortey/api lint`           | exit 0               |
| Next.js typecheck| `pnpm -F @sortey/nextjs typecheck`   | exit 0               |
| Next.js lint     | `pnpm -F @sortey/nextjs lint`        | exit 0               |
| Format check     | `pnpm format:check` (fix with `pnpm format:fix`) | exit 0   |

## Git workflow

- Branch: `hardening/004-receipt-upload-authz-and-ratelimit`
- Commits: e.g. `fix(api): export createTripAccessStore for cross-package reuse`, `fix(nextjs): authorize receipt uploads before storage/OCR side effects`, `refactor(api): pluggable rate-limit store, keep in-memory default`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Export `createTripAccessStore` and add a subpath export

In `packages/api/src/auth/guards.ts`, add `export` to `function
createTripAccessStore(db: any): TripAccessStore { ... }`. In
`packages/api/package.json`'s `exports` map, add:

```json
"./auth/guards": {
  "types": "./dist/auth/guards.d.ts",
  "default": "./src/auth/guards.ts"
}
```

(copy the `"./ocr/review"` entry's shape exactly, only the path differs).

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0

### Step 2: Authorize before side effects in `route.ts`

Immediately after the mime-type validation block (ends ~line 79) and
**before** the `if (!skipOcr) { assertRateLimit(...) }` block (~line 81),
insert:

```ts
import { createTripAccessStore, resolveTripAccess } from "@sortey/api/auth/guards";
import { db } from "@sortey/db/client"; // or however this route already gets a db handle — check createTRPCContext's construction below for the established pattern first; reuse it rather than opening a second connection if createTRPCContext already exposes one cheaply.

try {
  await resolveTripAccess(createTripAccessStore(db), {
    userId: session.user.id,
    workspaceId,
    tripId,
  });
} catch (error) {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
```

Check how `createTRPCContext` (already imported at the top of this file for
the later `attachReceiptImage` call) obtains its `db` — if it's cheap to
call `createTRPCContext` once, early, and reuse `ctx.db` for this check
(rather than importing `@sortey/db/client` directly and opening a second
connection), prefer that; only fall back to a direct `@sortey/db/client`
import if `createTRPCContext` can't be constructed before `session` is
fully resolved into the shape this needs. Either way, the router caller
construction at what is currently line 198-203 can stay where it is and
reuse the same context/caller for the final `attachReceiptImage` call — do
not construct it twice.

This check does **not** replace `caller.expenses.attachReceiptImage(...)`'s
own `tripProcedure()` check later in the handler (which also verifies
`expenseId` belongs to the trip, something this early check doesn't cover
since `expenseId`-to-trip validation already lives inside
`attachReceiptImage`) — it's an *additional*, *earlier* gate that stops the
storage write and paid OCR call from running for a non-member, while
leaving the existing expense-ownership check exactly where it is.

**Verify**: `pnpm -F @sortey/nextjs typecheck` → exit 0

### Step 3: Regression test for the auth primitives

Add `packages/api/src/auth/__tests__/guards.test.ts`. `resolveTripAccess`/
`resolveWorkspaceAccess` are pure functions over the `TripAccessStore`
interface — no DB stub gymnastics needed, just a literal fake store:

```ts
import { describe, expect, it } from "vitest";
import { resolveTripAccess, resolveWorkspaceAccess } from "../guards";

describe("resolveTripAccess", () => {
  it("throws FORBIDDEN when the store finds no access", async () => {
    const store = { findWorkspaceAccess: async () => null, findTripAccess: async () => null };
    await expect(
      resolveTripAccess(store, { userId: "u1", workspaceId: "w1", tripId: "t1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns access when the store finds a match", async () => {
    const access = { workspaceId: "w1", workspaceRole: "member" as const, tripId: "t1", tripRole: "member" as const };
    const store = { findWorkspaceAccess: async () => access, findTripAccess: async () => access };
    await expect(
      resolveTripAccess(store, { userId: "u1", workspaceId: "w1", tripId: "t1" }),
    ).resolves.toEqual(access);
  });
});

describe("resolveWorkspaceAccess", () => {
  it("throws FORBIDDEN when the store finds no membership", async () => {
    const store = { findWorkspaceAccess: async () => null, findTripAccess: async () => null };
    await expect(
      resolveWorkspaceAccess(store, { userId: "u1", workspaceId: "w1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
```

**Verify**: `pnpm -F @sortey/api exec vitest run src/auth/__tests__/guards.test.ts` → all pass

### Step 4: Pinning test for the ordering property

There is no wired test runner for `apps/nextjs/src/app/api/**` (see Current
State), so add the ordering guard as a source-grep test inside
`packages/api` instead — Node's `fs` doesn't care about package
boundaries, and this repo already has precedent for this style
(`packages/api/src/router/__tests__/tenant-scoping.test.ts`'s itinerary
guard). Add `packages/api/src/router/__tests__/receipt-upload-authz-order.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "..", "..", "apps", "nextjs", "src", "app", "api", "receipts", "upload", "route.ts"),
  "utf8",
);

describe("receipt upload route: authorize before side effects", () => {
  it("checks trip access before writing to storage", () => {
    const authzIndex = routeSource.indexOf("resolveTripAccess(");
    const storeIndex = routeSource.indexOf("storeReceiptImage(");
    expect(authzIndex).toBeGreaterThan(-1);
    expect(storeIndex).toBeGreaterThan(-1);
    expect(authzIndex).toBeLessThan(storeIndex);
  });

  it("checks trip access before calling the paid OCR provider", () => {
    const authzIndex = routeSource.indexOf("resolveTripAccess(");
    const ocrIndex = routeSource.indexOf("extractAndReconcileReceipt(");
    expect(authzIndex).toBeGreaterThan(-1);
    expect(ocrIndex).toBeGreaterThan(-1);
    expect(authzIndex).toBeLessThan(ocrIndex);
  });
});
```

Confirm the relative path resolves correctly from
`packages/api/src/router/__tests__/` to
`apps/nextjs/src/app/api/receipts/upload/route.ts` in this repo's actual
directory depth (count the `..` segments against the real tree — the
snippet above is illustrative, verify it before trusting it) — this is a
cross-package reach-through by design, note it as a STOP-adjacent
fragility in the test's own comment (if the repo is ever restructured, this
test's path needs updating).

**Verify**: `pnpm -F @sortey/api exec vitest run src/router/__tests__/receipt-upload-authz-order.test.ts` → all pass

### Step 5: Pluggable rate-limit store

Do not attempt to actually provision a Cloudflare Durable Object or KV
namespace in this plan (see Scope). Instead, extract the storage seam so a
durable backend can be dropped in later without touching call sites:

In a new `packages/api/src/rate-limit-store.ts`:

```ts
export interface RateLimitStore {
  /** Returns the hit timestamps (ms) currently inside the window, after recording `now`. */
  recordAndList(key: string, now: number, windowMs: number): Promise<number[]> | number[];
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, number[]>();
  recordAndList(key: string, now: number, windowMs: number): number[] {
    const windowStart = now - windowMs;
    const hits = (this.buckets.get(key) ?? []).filter((t) => t > windowStart);
    hits.push(now);
    this.buckets.set(key, hits);
    if (this.buckets.size > 5_000) {
      for (const [k, v] of this.buckets) {
        if (v.every((t) => t <= windowStart)) this.buckets.delete(k);
      }
    }
    return hits;
  }
  clear(): void {
    this.buckets.clear();
  }
}
```

In `rate-limit.ts`, replace the module-scope `buckets` Map with a
module-scope `let store: RateLimitStore = new InMemoryRateLimitStore();`
(preserves today's exact behavior/default), add `export function
setRateLimitStore(next: RateLimitStore): void { store = next; }` (the seam
a future Durable-Object-backed store plugs into), rewrite
`assertRateLimit`/`resetRateLimitBuckets` to go through `store` instead of
the raw Map, and re-export `RateLimitStore`/`InMemoryRateLimitStore` from
`rate-limit.ts` for convenience. Keep `RECEIPT_OCR_RATE_LIMIT`,
`receiptOcrRateLimitKey`, and `assertRateLimit`'s public signature
unchanged — this step must be a pure refactor with no behavior change for
existing callers (verify by running the full API test suite before/after
and confirming no rate-limit-adjacent test changes result).

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0; `pnpm -F @sortey/api test` → all pass, no rate-limit test behavior changed

### Step 6: Full package checks

**Verify**: `pnpm -F @sortey/api test` → all pass; `pnpm -F @sortey/api lint` → exit 0; `pnpm -F @sortey/nextjs typecheck` → exit 0; `pnpm -F @sortey/nextjs lint` → exit 0; `pnpm format:check` → exit 0

## Test plan

See Steps 3-4. `guards.test.ts` locks in `resolveTripAccess`/
`resolveWorkspaceAccess`'s FORBIDDEN-on-no-match behavior (the primitive
the route now depends on). `receipt-upload-authz-order.test.ts` pins the
ordering property directly against the route's source, since there's no
runnable Next.js route-handler test harness in this repo to exercise it
behaviorally. Rate-limit refactor (Step 5) is covered by the existing
`packages/api` test suite continuing to pass unchanged — no new test is
required there beyond confirming zero behavior drift.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm -F @sortey/api typecheck` exits 0
- [ ] `pnpm -F @sortey/api test` exits 0, including the two new test files
- [ ] `pnpm -F @sortey/api lint` exits 0
- [ ] `pnpm -F @sortey/nextjs typecheck` exits 0
- [ ] `pnpm -F @sortey/nextjs lint` exits 0
- [ ] `grep -n '"./auth/guards"' packages/api/package.json` matches
- [ ] `grep -n "export function createTripAccessStore\|export.*createTripAccessStore" packages/api/src/auth/guards.ts` matches
- [ ] `grep -n "resolveTripAccess" apps/nextjs/src/app/api/receipts/upload/route.ts` matches, and its line number is lower than both `storeReceiptImage(` and `extractAndReconcileReceipt(` in the same file
- [ ] `grep -n "class InMemoryRateLimitStore\|InMemoryRateLimitStore" packages/api/src/rate-limit-store.ts` matches
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/hardening/README.md` status row updated (create the file with a one-row table if it doesn't exist)

## STOP conditions

Stop and report back (do not improvise) if:

- Any excerpt above doesn't match the live code (the route may have changed since `0c1ffab`).
- `createTRPCContext` can't cheaply be constructed before the point in the handler where you need `db`/the trip-access check — if getting a `db` handle for the early check requires meaningfully restructuring how the route builds its tRPC context/caller, stop and report the shape of the problem rather than duplicating context-construction logic.
- The relative path in Step 4's pinning test doesn't resolve, or feels too fragile to be worth keeping (e.g., more than 5 `..` segments, or the two packages are further apart than expected) — report and propose an alternative location rather than forcing it.
- Step 5's refactor changes any existing rate-limit test's expected behavior — that means the extraction wasn't behavior-preserving; stop and reconcile before proceeding.
- Fixing this appears to require changing the multipart form field names or the JSON response shape the client (whatever calls this route from `apps/nextjs`'s own UI, or `apps/expo` if it also posts here — check before assuming only one caller) depends on.

## Maintenance notes

- This plan deliberately stops short of wiring a real durable rate limiter
  (Cloudflare Durable Object or KV) — `rate-limit-store.ts`'s
  `setRateLimitStore` seam is the intended extension point. A follow-up
  plan should: pick a binding (Durable Object recommended over KV for this
  use case — KV's eventual consistency is a poor fit for a hard per-minute
  cap), add it to `apps/nextjs`'s `wrangler.jsonc`, implement
  `RateLimitStore` against it, and call `setRateLimitStore(...)` once at
  startup. Until then, the in-memory store means the "5 scans/minute" cap
  is still soft under multi-isolate Cloudflare traffic — this plan makes
  that fixable without another call-site-touching refactor, it does not
  fix the underlying softness itself.
- `apps/nextjs/src/app/api/**` has no test harness at all in this repo
  (`vitest.worker.config.ts` only covers `worker/__tests__/**`). If more
  Route Handlers accumulate authz-adjacent logic, that gap is worth closing
  with a proper Node-environment vitest project for `src/app/api/**` —
  out of scope here, flagged for a future plan.
- Audit whether any other Route Handler under `apps/nextjs/src/app/api/**`
  has the same "trust client-supplied ids, side-effect before authz" shape
  — this plan only checked `receipts/upload`.
