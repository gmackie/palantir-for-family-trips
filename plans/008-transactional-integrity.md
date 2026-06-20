# Plan 008: Make pins.setAttendees atomic and guard settlements.record against idempotency-key payload mismatch

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat bbc54f6..HEAD -- packages/api/src/router/pins.ts packages/api/src/router/settlements.ts`
> Compare against "Current state" before proceeding; on a mismatch, treat it
> as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED (touches write paths; transactions can change failure modes)
- **Depends on**: none
- **Category**: bug (correctness)
- **Planned at**: commit `bbc54f6`, 2026-06-12

## Why this matters

Two write paths have integrity gaps:

1. `pins.setAttendees` replaces a pin's attendee list with a **delete-all then
   insert** sequence that is NOT wrapped in a transaction. If the insert fails
   (or the worker is evicted between the two statements), the pin is left with
   **zero** attendees — silent data loss, not a rolled-back no-op.
2. `settlements.record` deduplicates on `idempotencyKey` via
   `onConflictDoNothing` + re-fetch, which is correct for *identical* retries.
   But if a client retries the same `idempotencyKey` with a **different**
   payload (amount/parties), it silently returns the *original* settlement and
   the mismatch goes undetected — masking a real client bug and a possible
   double-spend confusion. The fix is a defensive equality check, not a
   behavior change for honest retries.

(Note for the reviewer: `expenses.claimLineItem` was also flagged in the
original audit but already uses `.onConflictDoNothing({ target: [lineItemId,
userId] })`, so its check-then-insert is already race-safe. It is intentionally
OUT of scope here.)

## Current state

### Site 1 — `packages/api/src/router/pins.ts`, `setAttendees` (the delete+insert tail)

```ts
      // Replace: delete all, then insert
      await ctx.db
        .delete(pinAttendees)
        .where(eq(pinAttendees.pinId, input.pinId));

      if (input.userIds.length > 0) {
        await ctx.db.insert(pinAttendees).values(
          input.userIds.map((userId) => ({
            pinId: input.pinId,
            userId,
          })),
        );
      }
```

The membership/ownership checks above this block stay as-is; only the
delete+insert pair must become atomic.

### Site 2 — `packages/api/src/router/settlements.ts`, `record` (the conflict branch)

```ts
      const [created] = (await ctx.db
        .insert(settlements)
        .values({
          tripId: ctx.tripId,
          fromUserId: input.fromUserId,
          toUserId: input.toUserId,
          amountCents: input.amountCents,
          idempotencyKey: input.idempotencyKey,
          note: input.note ?? null,
        })
        .onConflictDoNothing({ target: settlements.idempotencyKey })
        .returning()) as Array<typeof settlements.$inferSelect>;

      // If conflict (duplicate key), return the existing one
      if (!created) {
        const [existing] = (await ctx.db
          .select()
          .from(settlements)
          .where(eq(settlements.idempotencyKey, input.idempotencyKey))
          .limit(1)) as Array<typeof settlements.$inferSelect>;
        return existing!;
      }

      return created;
```

### Transaction convention in this repo

`packages/api/src/router/expenses.ts` already uses
`await ctx.db.transaction(async (tx: any) => { ... })` (around line 868) —
follow that exact shape: do all writes for the unit through `tx`, not
`ctx.db`.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Install   | `pnpm install`                   | exit 0              |
| Typecheck | `pnpm -F @sortey/api typecheck`  | exit 0, no errors   |
| Tests     | `pnpm -F @sortey/api test`       | all pass            |
| Lint      | `pnpm -F @sortey/api lint`       | exit 0              |

## Scope

**In scope**:
- `packages/api/src/router/pins.ts` — `setAttendees` delete+insert only
- `packages/api/src/router/settlements.ts` — `record` conflict branch only
- `packages/api/src/router/__tests__/settlements.test.ts` — add the
  payload-mismatch case (this file already exists from plan 001)

**Out of scope** (do NOT touch):
- `expenses.claimLineItem` — already race-safe (see "Why this matters").
- The membership-validation logic above each write — leave unchanged.
- The `settlements` DB schema / the `idempotencyKey` unique constraint.

## Git workflow

- Work on the current branch.
- Commit style: `fix(api): make setAttendees atomic + detect settlement idempotency payload mismatch`.
- Do NOT push or open a PR.

## Steps

### Step 1: Wrap setAttendees' delete+insert in a transaction

Replace the delete+insert tail (Site 1) with a single
`await ctx.db.transaction(async (tx: any) => { ... })` that performs the
`delete` and the conditional `insert` through `tx`. The membership checks stay
outside (before) the transaction.

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0.

### Step 2: Detect payload mismatch in settlements.record

In the `if (!created)` branch (Site 2), after fetching `existing`, compare the
incoming payload against the stored row. If `existing.amountCents !==
input.amountCents || existing.fromUserId !== input.fromUserId ||
existing.toUserId !== input.toUserId`, throw
`new TRPCError({ code: "CONFLICT", message: "Idempotency key reused with a
different settlement payload." })`. Otherwise return `existing` as before.
(Import `TRPCError` if not already imported in this file — check the top.)

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0.

### Step 3: Add the regression test

In `packages/api/src/router/__tests__/settlements.test.ts`, add a test that
exercises the `record` idempotency mismatch path. Follow the existing in-memory
store style already used in that file. If `record` is not currently covered by
an in-memory seam in that test file (it may test a different function), and
wiring it would require production refactors, instead add a focused test that
constructs the same comparison logic the procedure uses — but PREFER testing
the real `record` path if the file's existing harness supports it. If neither
is feasible without production changes beyond Step 2, note it and rely on the
done-criteria grep for Step 2.

Cases:
- Same key + identical payload → returns the original row (no throw).
- Same key + different `amountCents` → throws `{ code: "CONFLICT" }`.

**Verify**: `pnpm -F @sortey/api test` → all pass including the new case.

### Step 4: Full gate

**Verify**: `pnpm -F @sortey/api test` → all pass;
`pnpm -F @sortey/api lint` → exit 0.

## Test plan

- Extend `packages/api/src/router/__tests__/settlements.test.ts` with the two
  cases in Step 3.
- `pins.setAttendees` has no router test harness; the transaction change is a
  structural wrap with unchanged success-path output, so it is covered by
  typecheck + the existing suite (do NOT build a new pins harness here — out of
  scope).
- Verification: `pnpm -F @sortey/api test` → all pass.

## Done criteria

- [ ] `pnpm -F @sortey/api typecheck` exits 0
- [ ] `pnpm -F @sortey/api test` exits 0; the settlement mismatch case exists and passes
- [ ] `grep -n "transaction" packages/api/src/router/pins.ts` shows `setAttendees` now uses a transaction
- [ ] `grep -n "CONFLICT" packages/api/src/router/settlements.ts` shows the new mismatch guard
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Either "Current state" excerpt doesn't match the live code (drift).
- `ctx.db.transaction` is not available (the db client doesn't expose it) —
  the expenses.ts precedent says it should; if it's gone, stop.
- Adding the settlement test would require production changes beyond Step 2.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- If `setAttendees` later grows additional writes (e.g. an audit-log row), add
  them inside the same transaction.
- Reviewer should confirm the membership checks remain OUTSIDE the transaction
  (no need to hold a write transaction open during read-only validation).
