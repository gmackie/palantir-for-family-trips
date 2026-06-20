# Plan 007: Add direct unit tests for the auth guards middleware

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat bbc54f6..HEAD -- packages/api/src/auth/guards.ts`
> If `guards.ts` changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (adds tests only; no production code changes)
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `bbc54f6`, 2026-06-12

## Why this matters

`packages/api/src/auth/guards.ts` is the authorization gate every protected
tRPC call passes through (`protectedProcedure → workspaceProcedure →
tripProcedure`), yet it has zero direct tests. CLAUDE.md states auth is
enforced via this middleware chain, "NOT helper functions" — so a regression
here silently removes tenancy isolation across the whole API. Characterization
tests pin the current allow/deny behavior so later refactors (e.g. plan 010's
organizer-check dedup) can't quietly weaken it.

## Current state

Relevant files:

- `packages/api/src/auth/guards.ts` — the middleware factories. Read the whole
  file first (it is ~200 lines). It exports the procedure builders and/or the
  middleware functions that enforce: session presence (`UNAUTHORIZED` when no
  session), workspace membership (`FORBIDDEN`/`NOT_FOUND` when the caller is
  not a member of `input.workspaceId`), and trip membership (`FORBIDDEN`/
  `NOT_FOUND` when not a member of `input.tripId`). Confirm the exact exported
  symbol names and the exact `TRPCError` codes thrown — your assertions must
  match what the code actually does, not what this plan guesses.
- `packages/api/src/router/__tests__/chat.test.ts` — the test-style exemplar
  for this package: Vitest, in-memory data, and the
  `process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/gmacko_test"`
  preamble at the top (set it before importing any module that touches the db
  client).
- `packages/api/src/trpc.ts` — shows how context (`ctx.session`, `ctx.db`,
  `ctx.workspaceId`, `ctx.tripId`) is shaped; your fake context must match
  these field names.

Read `guards.ts` and pick the smallest seam to test directly. Two acceptable
approaches — choose based on what the file actually exports:

1. **If the membership checks are extractable pure-ish functions** (they take
   a `db`-like object + ids and return/throw), test those directly with an
   in-memory fake `db`, mirroring `chat.test.ts`'s in-memory store.
2. **If authorization only exists as tRPC middleware**, build a tiny test
   router with `protectedProcedure`/`workspaceProcedure`/`tripProcedure`
   wrapping a trivial resolver, create a caller with a fake context, and
   assert the thrown `TRPCError.code` for each allow/deny case.

Do NOT refactor `guards.ts` to make it testable in this plan — if neither
approach works without production changes, STOP and report (a separate plan
will introduce the seam).

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Install   | `pnpm install`                   | exit 0              |
| Typecheck | `pnpm -F @sortey/api typecheck`  | exit 0, no errors   |
| Tests     | `pnpm -F @sortey/api test`       | all pass            |
| Lint      | `pnpm -F @sortey/api lint`       | exit 0              |

## Scope

**In scope** (the only files you should create/modify):
- `packages/api/src/auth/__tests__/guards.test.ts` (create)

**Out of scope** (do NOT touch):
- `packages/api/src/auth/guards.ts` — production code. Tests only. If it can't
  be tested without changing it, STOP.
- Any router file.

## Git workflow

- Work on the current branch.
- Commit style: conventional commits, e.g.
  `test(api): add direct unit tests for auth guards middleware`.
- Do NOT push or open a PR.

## Steps

### Step 1: Read guards.ts and confirm the behavior to pin

Open `packages/api/src/auth/guards.ts` fully. Write down, for each guard layer,
the exact condition and the exact `TRPCError` code it throws. These become the
test assertions.

**Verify**: you can state, in the test file's comments, the three deny codes
and the allow condition for each layer.

### Step 2: Write the tests

Create `packages/api/src/auth/__tests__/guards.test.ts`. Include the
`process.env.DATABASE_URL ??=` preamble (copy it verbatim from
`chat.test.ts`). Cover, at minimum:

- **protected**: no session → throws the unauthorized code; valid session →
  passes through to the resolver.
- **workspace**: caller is not a member of `workspaceId` → throws the
  forbidden/not-found code; caller IS a member → passes and exposes
  `ctx.workspaceId`.
- **trip**: caller is not a member of `tripId` → throws; caller IS a member →
  passes and exposes `ctx.tripId`.
- **chaining**: a trip-level call by a non-member of the parent workspace is
  rejected at the workspace layer (does not reach the trip check).

**Verify**: `pnpm -F @sortey/api test` → all pass including the new file.

### Step 3: Full gate

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0;
`pnpm -F @sortey/api lint` → exit 0.

## Test plan

New file `packages/api/src/auth/__tests__/guards.test.ts`, modeled
structurally on `packages/api/src/router/__tests__/chat.test.ts`. Cases as in
Step 2 (≥ 7 assertions across the four groups). No production code changes.

## Done criteria

- [ ] `pnpm -F @sortey/api typecheck` exits 0
- [ ] `pnpm -F @sortey/api test` exits 0; the new guards tests exist and pass
- [ ] `git status` shows only `packages/api/src/auth/__tests__/guards.test.ts` added
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `guards.ts` cannot be exercised without modifying it (no testable seam, no
  way to build a caller with a fake context).
- The actual `TRPCError` codes differ from what you expected and you cannot
  determine the intended behavior from the code.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- These are characterization tests: they encode *current* behavior. If a
  future change intentionally alters a guard's response code, update the test
  in the same commit and call it out in review.
- Plan 010 (organizer-check dedup) should run after this lands so its refactor
  has this safety net.
