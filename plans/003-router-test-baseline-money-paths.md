# Plan 003: Add router-level test coverage for the expenses and planning money/coordination paths

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2408b3e..HEAD -- packages/api/src/router/expenses.ts packages/api/src/router/planning.ts packages/api/src/router/__tests__/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: LOW
- **Depends on**: plans/001-fix-settlement-summary-claims-query.md, plans/002-scope-trip-mutations-to-tenant.md (ordering only — they add files to the same `__tests__/` directory and 001 establishes the settlements harness this plan extends)
- **Category**: tests
- **Planned at**: commit `2408b3e`, 2026-06-12

## Why this matters

Only 7 of 19 routers have tests (`admin`, `chat`, `fuel-logs`, `location`, `settings`, `trips-share-link`, `trips`). The two largest untested routers are the product's core: `expenses.ts` (844 lines — draft/finalize lifecycle, line items, claims) and `planning.ts` (570 lines — polls, votes, proposals, lock-in). The settlement-summary bug fixed in plan 001 shipped precisely because this layer had no tests: the pure math was tested, the queries gluing it together were not. This plan establishes characterization coverage on those two routers so future refactors (including the planned split of god files) are safe.

## Current state

- `packages/api/src/router/expenses.ts` — expenses router. Procedures include (read the file for the full list): `create`, `list` (lines 145-172), `get` (lines 178+, loads line items + claims via `inArray` — see lines 212-221), line-item and claim mutations, finalize/draft transitions, delete (correctly trip-scoped per the audit).
- `packages/api/src/router/planning.ts` — polls/proposals router. Known shape: `closePoll` (lines ~185-200) requires organizer and scopes by `and(eq(polls.id, ...), eq(polls.tripId, ctx.tripId))`; proposal status updates (lines ~435-450) gate `selected`/`rejected` behind `requireOrganizer` and set `bookedByUserId` on `booked`.
- `packages/api/src/router/__tests__/fuel-logs.test.ts` and `trips.test.ts` — the harness pattern to copy. Key traits:

```ts
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/gmacko_test";

const { createFuelLogWithSplit } = await import("../fuel-logs");
// in-memory store factory over plain arrays; store interface imported as a type
```

- The repo's testing convention is: routers export store interfaces + domain functions; tests drive the domain functions through in-memory stores (`trips.test.ts` tests `createTripRecord`, `updateTripRecord`, etc. this way). Where `expenses.ts`/`planning.ts` procedures query `ctx.db` inline instead of through a store, prefer **extracting the minimal store seam** (as plan 001 did for settlements) over heavy `ctx.db` chain-mocking — but only where extraction is mechanical; otherwise test through a stub `ctx` and accept chain stubs.
- Money is integer cents everywhere. Trip roles are `"organizer" | "member"` (`packages/api/src/auth/guards.ts`). Currency is stored per expense; settlement refuses mixed currencies (settled product decision — do not "fix" it).

## Commands you will need

| Purpose   | Command                                                            | Expected on success |
|-----------|--------------------------------------------------------------------|---------------------|
| Typecheck | `pnpm turbo run typecheck -F @sortey/api`                          | exit 0              |
| Lint      | `pnpm turbo run lint -F @sortey/api`                               | exit 0              |
| Format    | `pnpm format:check` (fix with `pnpm format:fix`)                   | exit 0              |
| One file  | `pnpm --filter @sortey/api exec vitest run src/router/__tests__/expenses.test.ts` | all pass |
| All api tests | `pnpm --filter @sortey/api test`                               | all pass            |

## Scope

**In scope** (the only files you should modify/create):
- `packages/api/src/router/__tests__/expenses.test.ts` (create)
- `packages/api/src/router/__tests__/planning.test.ts` (create)
- `packages/api/src/router/expenses.ts` (ONLY mechanical store-seam extraction; zero behavior change)
- `packages/api/src/router/planning.ts` (same constraint)

**Out of scope** (do NOT touch):
- All other routers and their tests.
- `packages/api/src/expenses/{settle,shares}.ts` — already tested.
- Any zod input schema, error code, or response shape — characterization means *current* behavior, including behavior you suspect is wrong. If you find a real bug, record it in your final report; do not fix it here.
- E2E tests (`apps/nextjs/e2e/`) — separate effort.

## Git workflow

- Branch: `advisor/003-router-test-baseline`
- Commits: `test(api): expenses router characterization coverage`, `test(api): planning router characterization coverage`; any extraction commit as `refactor(api): extract <X>Store seam (no behavior change)`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Read both routers end to end

List every procedure in `expenses.ts` and `planning.ts` with its guard (`tripProcedure`), role requirements (`requireOrganizer`-style checks), and writes. This list drives the test matrix in steps 3–4. Keep it in your report.

**Verify**: list produced; no code changed; `git status` clean.

### Step 2: Extract store seams where mechanical

For each procedure cluster that queries `ctx.db` inline, extract the queries into an exported store interface + `create<X>Store(db)` factory + exported domain function, exactly mirroring what `fuel-logs.ts` does (`FuelLogStore` + `createFuelLogWithSplit`) and what plan 001 did for settlements. Rules:

- Procedure bodies become one-line calls into the domain function.
- No query may change shape — copy the Drizzle calls verbatim into the store factory.
- If a procedure's logic is a single trivial query (e.g. `list`), extraction is optional; testing it adds little — note it as skipped.

**Verify**: `pnpm turbo run typecheck -F @sortey/api` → exit 0; `pnpm --filter @sortey/api test` → existing tests still pass.

### Step 3: `expenses.test.ts`

Model on `fuel-logs.test.ts`. Minimum cases:

1. Create draft expense → status `draft`, integer-cents fields stored as given.
2. Finalize: draft → finalized transition; already-finalized behavior characterized (whatever it is today — error or no-op).
3. Line items: add items, totals tracked in cents; claims: claim/unclaim by member; `get` aggregates claims per line item (the `claimantsByLineItem` shape at `expenses.ts:223-230`).
4. Shares: a fully-claimed expense attributes line totals to claimants; unclaimed items split across the member pool (drive through whatever `get` returns, asserting against `computeExpenseShares` from `../../expenses/shares`).
5. Authorization characterization: non-member paths are blocked by the guard layer (out of unit scope) but role-gated branches inside procedures (payer-only/organizer-only edits, if present per the Step 1 list) get a test each.
6. Currency: expense stores its currency; creating with a different currency than the trip's is characterized as-is (recent commit `4b0c6fe` made gas-split inherit trip currency — do not assume the same for manual expenses; test what the code does).

**Verify**: `pnpm --filter @sortey/api exec vitest run src/router/__tests__/expenses.test.ts` → all pass (≥8 tests)

### Step 4: `planning.test.ts`

Minimum cases:

1. Poll create + vote + tally (single and changed vote; the dedup/replace behavior as it exists).
2. `closePoll`: organizer required (`requireOrganizer` throws for `member`); closing scopes by tripId (cross-trip pollId → not found/no-op as the code behaves).
3. Proposal lifecycle: create → react → status changes; `selected`/`rejected` require organizer; `booked` records `bookedByUserId`.
4. Lock-in path (the `update(trips)` call near `planning.ts:556`): characterize what it sets on the trip.

**Verify**: `pnpm --filter @sortey/api exec vitest run src/router/__tests__/planning.test.ts` → all pass (≥6 tests)

### Step 5: Full check

**Verify**: `pnpm --filter @sortey/api test` → all pass; `pnpm turbo run typecheck -F @sortey/api` → exit 0; `pnpm turbo run lint -F @sortey/api` → exit 0; `pnpm format:check` → exit 0

## Test plan

This plan *is* the test plan; pattern files are `fuel-logs.test.ts` (store harness) and `trips.test.ts` (role/permission matrix style).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `expenses.test.ts` exists with ≥8 passing tests; `planning.test.ts` exists with ≥6 passing tests
- [ ] `pnpm --filter @sortey/api test` exits 0
- [ ] `pnpm turbo run typecheck -F @sortey/api` exits 0
- [ ] `git diff` on `expenses.ts`/`planning.ts` shows only extraction (no changed query conditions, error codes, or response fields) — reviewer-checkable by reading the diff
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- A store-seam extraction cannot be done without changing behavior (e.g. a transaction wraps multiple queries in a way the seam would break).
- You find what looks like a real bug (wrong table, missing scope, broken math). Record it with file:line in your report and write the characterization test against *current* behavior only if it doesn't mask the bug; otherwise skip that case and flag it.
- Plans 001/002 are not yet merged into your base and their files conflict with yours.

## Maintenance notes

- This unlocks the deferred "split trips.ts god file" refactor (1,757 lines) — do not attempt that split until this plan plus the existing trips tests are green in CI.
- The in-memory-store pattern tests logic, not SQL. The audit also flagged the absence of any DB-backed integration layer (real Drizzle against real Postgres); that remains open backlog — these tests do not substitute for it.
- New routers should ship with a test file in the same pattern; reviewers should treat a routerless test as a smell.
