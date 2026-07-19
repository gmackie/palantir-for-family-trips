# Plan 009: Guard ferry-linked and transport-draft expenses against mutating/deleting after finalize

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/hardening/README.md` (create it, modeled on `plans/README.md`,
> if it doesn't exist yet) — unless a reviewer dispatched you and told you
> they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 0c1ffab..HEAD -- packages/api/src/router/ferries.ts packages/api/src/expenses/transport-draft.ts packages/api/src/router/expenses.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (additive guards; no behavior changes for the unfinalized-draft path that is the overwhelming common case)
- **Depends on**: none
- **Category**: bug / data-integrity
- **Planned at**: commit `0c1ffab`, 2026-07-19

## Why this matters

A ferry crossing's fare is modeled as a linked, system-spawned `expenses`
draft row (`ferries.expenseId`). The ferry router edits and deletes that
linked expense with **no check on the expense's `status`**. A comment in
`deleteFerryCrossing` explicitly *asserts* the invariant that keeps this
safe — "It never carries a finalized, settlement-bearing balance someone
else owns" — but nothing in the code enforces that assertion. Once a member
finalizes the fare draft through the normal expense flow
(`expenses.finalize`, `packages/api/src/router/expenses.ts:533`), it becomes
a real, claimable, settlement-bearing expense — and `expenses.finalize` has
no ferry-awareness or "system-owned" exemption to stop that from happening.
After that point:

- Editing the ferry's fare (`updateFerryCrossing`) silently overwrites the
  finalized expense's `subtotalCents`/`totalCents`/`currency`
  (`transport-draft.ts`'s `updateTransportDraftAmount`, an unconditional
  `UPDATE ... WHERE id = ?`) — corrupting a balance other trip members may
  already be relying on to settle up, with no re-approval and no audit
  trail.
- Deleting the ferry crossing (`deleteFerryCrossing`) hard-deletes the
  linked expense outright — destroying a finalized, potentially
  claimed/settled balance — via the same unconditional `DELETE`
  (`deleteTransportDraft`, `ferries.ts:463-470`).

This is a real reachable path, not a hypothetical: nothing stops a user from
finalizing a ferry-fare draft (it's an ordinary row in `expenses` with
`status: "draft"` until then, indistinguishable to `expenses.finalize` from
any other draft), other members claiming line items or the trip settling
around it, and then the organizer editing the ferry's fare or deleting the
crossing — silently corrupting or destroying money data mid-settlement.

## Current state

### `packages/api/src/router/ferries.ts`

`updateFerryCrossing` (lines 207-271), the fare-reconciliation branch (lines 229-268):

```ts
// Reconcile the linked fare expense when fare/currency changed on this update.
const fareTouched =
  fields.fareCents !== undefined || fields.currency !== undefined;
if (!fareTouched) {
  return updated;
}

const fareCents = updated.fareCents ?? 0;

if (fareCents > 0 && updated.expenseId) {
  // Existing link — push the new amount/currency onto the draft.
  await store.updateExpenseAmount({          // line 240 — NO status check
    expenseId: updated.expenseId,
    amountCents: fareCents,
    currency: updated.currency,
  });
  return updated;
}
...
if (fareCents <= 0 && updated.expenseId) {
  // Fare cleared — drop the linked draft and unlink.
  await store.deleteExpense({ expenseId: updated.expenseId });   // line 261 — NO status check
  ...
}
```

`deleteFerryCrossing` (lines 273-294):

```ts
export async function deleteFerryCrossing(
  store: FerryStore,
  input: { id: string; tripId: string },
): Promise<{ deleted: boolean }> {
  // Hard-delete the linked draft first so it doesn't dangle once the crossing
  // is gone. Unlike `expenses.delete`, this intentionally skips the
  // organizer/payer (`requireOrganizerOrSelf`) check: a ferry-fare draft is
  // always an unfinalized, trip-scoped, system-spawned row owned by the
  // crossing's lifecycle — anyone authorized to delete the crossing (already
  // gated by `tripProcedure`) deletes its fare with it. It never carries a
  // finalized, settlement-bearing balance someone else owns.
  const existing = await store.getFerry(input);
  if (existing?.expenseId) {
    await store.deleteExpense({ expenseId: existing.expenseId });   // line 286 — NO status check; the comment's claim is unenforced
  }

  const deleted = await store.deleteFerry(input);
  ...
}
```

`FerryStore`'s Drizzle-backed implementations of these two store methods
(`ferries.ts:444-454`):

```ts
updateExpenseAmount: async ({ expenseId, amountCents, currency }) => {
  await updateTransportDraftAmount({ db, expenseId, amountCents, currency });
},
deleteExpense: async ({ expenseId }) => {
  await deleteTransportDraft({ db, expenseId });
},
```

`deleteTransportDraft` (`ferries.ts:463-470`, a local re-export shim, also
unconditional):

```ts
async function deleteTransportDraft(input: { db: any; expenseId: string }): Promise<void> {
  const { expenses } = await import("@sortey/db/schema");
  await input.db.delete(expenses).where(eq(expenses.id, input.expenseId));
}
```

### `packages/api/src/expenses/transport-draft.ts`

`updateTransportDraftAmount` (lines 69-84), unconditional:

```ts
export async function updateTransportDraftAmount(input: {
  db: any;
  expenseId: string;
  amountCents: number;
  currency: string;
}): Promise<void> {
  await input.db
    .update(expenses)
    .set({
      subtotalCents: input.amountCents,
      totalCents: input.amountCents,
      currency: input.currency,
    })
    .where(eq(expenses.id, input.expenseId));   // no status filter, no returning/existence check
}
```

### `packages/api/src/router/expenses.ts`

`finalize` (lines 533-599 approx) — the only gate is "already finalized" and organizer/payer authorization; there is no ferry/system-draft exemption:

```ts
finalize: tripProcedure()
  .input(z.object({ workspaceId: z.string().min(1), tripId: z.string().min(1), expenseId: z.string().min(1) }))
  .mutation(async ({ ctx, input }) => {
    const [existing] = (await ctx.db.select().from(expenses).where(
      and(eq(expenses.id, input.expenseId), eq(expenses.tripId, ctx.tripId)),
    ).limit(1)) as Array<typeof expenses.$inferSelect>;

    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found." });
    if (existing.status !== "draft") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Expense is already finalized." });
    }
    requireOrganizerOrSelf(ctx.tripRole, existing.payerUserId, ctx.session.user.id);
    // ... mixed-currency check (see plan 010(d)) ...
    const [updated] = (await ctx.db.update(expenses).set({ status: "finalized" })
      .where(eq(expenses.id, input.expenseId)).returning())...
```

Nothing here checks whether `existing.id` is referenced by `ferries.expenseId`
(or any other system-spawned-draft table). Any authorized user (organizer,
or the payer themself — `requireOrganizerOrSelf`) can finalize a
ferry-linked draft exactly like any other expense.

### Expense `status` values

Confirm the full `status` enum (check `packages/db/src/schema.ts`'s
`expenses` table definition — `finalize` transitions `"draft"` →
`"finalized"`) before writing the guard, in case there's a third state
(e.g. `"voided"`) worth distinguishing from "still a draft."

## Commands you will need

| Purpose   | Command                                                            | Expected on success |
|-----------|---------------------------------------------------------------------|---------------------|
| Typecheck | `pnpm -F @sortey/api typecheck`                                     | exit 0               |
| Lint      | `pnpm -F @sortey/api lint`                                          | exit 0               |
| Format    | `pnpm format:check` (fix with `pnpm format:fix`)                    | exit 0               |
| Tests     | `pnpm -F @sortey/api test`                                          | all pass             |
| Focused   | `pnpm --filter @sortey/api exec vitest run src/router/__tests__/ferries.test.ts src/expenses/__tests__/transport-draft.test.ts src/router/__tests__/expenses.test.ts` | all pass (create missing files) |

## Scope

**In scope** (the only files you should modify/create):
- `packages/api/src/expenses/transport-draft.ts` (guard `updateTransportDraftAmount`; add a matching guard-or-check for delete, whichever module owns the delete — see Step 2)
- `packages/api/src/router/ferries.ts` (guard `updateFerryCrossing`'s reconcile branch and `deleteFerryCrossing`; surface a clear error instead of silently no-oping)
- `packages/api/src/router/expenses.ts` (`finalize` — decide, per Step 1, whether a ferry-linked draft should even be finalizable at all; if the product intent is "no," add the exemption here instead of/in addition to guarding the ferry side)
- `packages/api/src/expenses/__tests__/transport-draft.test.ts` (create)
- `packages/api/src/router/__tests__/ferries.test.ts` (extend, or create if it doesn't exist — check first)
- `packages/api/src/router/__tests__/expenses.test.ts` (extend, only if Step 1 concludes `finalize` needs the exemption)

**Out of scope** (do NOT touch, even though they look related):
- `expenses.delete`'s own organizer/payer authorization path (`requireOrganizerOrSelf`) — untouched; this plan is about the *ferry-owned* delete/update bypassing status, not about who's allowed to call it.
- The `expenses.update` procedure's general patch logic (around `expenses.ts:500-527`) — it already only reaches drafts in the normal flow; do not add a redundant status check there unless Step 1 finds it's also reachable for a finalized expense without a status guard (if so, STOP and report — that would be a related but distinct finding).
- Any UI changes in `apps/nextjs` or `apps/expo` that surface ferry fare editing — the guard is server-side; a clear TRPCError message is enough for clients to render, matching the existing `finalize`/`delete` error-surfacing convention.
- Redesigning the fare→expense link into a "supersede" model (new draft + void old) — Step 3 asks you to choose between a hard reject and a supersede flow; default to the simpler hard-reject unless Step 1's investigation shows a supersede flow is trivially cheap given existing primitives.

## Git workflow

- Branch: `advisor/009-guard-ferry-finalized-expenses` (branch from current branch; repo default is `master`)
- Commits: conventional, e.g. `fix(api): guard finalized expenses from ferry fare edits and deletes` + `test(api): ferry-finalized-expense guard coverage`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Decide the product invariant, then encode it

Read `packages/db/src/schema.ts`'s `expenses` table for the full `status`
enum. Then decide (this is a product decision baked into the guard, not
just a bug fix — get it right before writing code):

- **Option A (recommended default — hard reject)**: once a ferry-linked
  expense is finalized, `updateFerryCrossing`'s fare-reconcile branch and
  `deleteFerryCrossing` refuse to touch it — throw a `TRPCError({ code:
  "BAD_REQUEST", message: "This ferry's fare has already been finalized and
  claimed — edit the expense directly, or unfinalize it first." })` (adjust
  wording to whatever "unfinalize" affordance actually exists; check
  whether `expenses.ts` has any finalized→draft transition today — if not,
  the message should say to void/settle instead, whatever is accurate).
  The ferry's own fields (times, terminals, vehicle reservation, etc.)
  still update normally; only the fare-reconcile side effect (amount
  change / draft delete) is blocked when the linked expense is no longer a
  draft.
- **Option B (supersede flow)**: only pursue this if Step 1's read of
  `expenses.ts` shows an existing "void + recreate" pattern to reuse (grep
  for anything like `voided`/`superseded` in `packages/db/src/schema.ts`
  and `expenses.ts`). If no such pattern exists, do not invent one in this
  plan — that's meaningfully more surface area (a new status value, new
  settlement-math edge cases) than a hardening pass should take on. Default
  to Option A and note Option B as a Maintenance follow-up.

Also decide: should `expenses.finalize` itself refuse to finalize a
ferry-linked draft at all (i.e., ferry fares are meant to stay
system-managed forever and never enter the claim/settle flow)? Check
`apps/nextjs`/`apps/expo` UI for whether ferry-fare drafts are shown in the
normal "finalize this expense" UI alongside user-entered expenses (grep for
where `ferries.expenseId` or a ferry fare's linked expense is rendered) —
if the UI never exposes a finalize action for a ferry-linked draft, guarding
only the ferry-side mutation (Option A) is sufficient and simpler; if the UI
does let it be finalized like any other expense (this appears to be the
case per Step 1's schema read finding no distinguishing flag), keep both
guards: `finalize` proceeds (it's a legitimate, splittable, real expense at
that point — the money still needs to be settled), and the ferry-side
mutation/delete becomes the one place enforcing "don't touch it after
that."

**Verify**: written decision + rationale in your report before writing code.

### Step 2: Guard `updateTransportDraftAmount` (and its delete counterpart)

In `packages/api/src/expenses/transport-draft.ts`, change
`updateTransportDraftAmount` to check status before writing:

```ts
export async function updateTransportDraftAmount(input: {
  db: any;
  expenseId: string;
  amountCents: number;
  currency: string;
}): Promise<{ updated: boolean }> {
  const [existing] = (await input.db
    .select({ status: expenses.status })
    .from(expenses)
    .where(eq(expenses.id, input.expenseId))
    .limit(1)) as Array<{ status: string }>;

  if (!existing || existing.status !== "draft") {
    return { updated: false };
  }

  await input.db.update(expenses).set({ ... }).where(
    and(eq(expenses.id, input.expenseId), eq(expenses.status, "draft")),
  );
  return { updated: true };
}
```

Use `and(eq(id), eq(status, "draft"))` in the `WHERE`, not just a
pre-check, to close the check-then-act race (a concurrent finalize between
the read and the write). Return a boolean (or throw — pick whichever the
call site in Step 3 needs) so `ferries.ts` can surface a clear error instead
of silently no-oping.

Do the equivalent for the delete path — `deleteTransportDraft` currently
lives in `ferries.ts:463-470` as a local shim, not in
`transport-draft.ts`; decide whether to move/rename it into
`transport-draft.ts` alongside `updateTransportDraftAmount` for symmetry
(recommended — it's expense-table logic, matching this file's stated
purpose) or guard it in place in `ferries.ts`. Either way, the delete must
become `DELETE ... WHERE id = ? AND status = 'draft'` (or a pre-check +
transaction), returning whether it actually deleted a row.

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0

### Step 3: Wire the guard into `ferries.ts`

- `updateFerryCrossing`'s fare-reconcile branch (lines 229-268): when
  `store.updateExpenseAmount` reports `{ updated: false }` (finalized),
  throw `TRPCError({ code: "BAD_REQUEST", message: "..." })` from Step 1's
  wording — do NOT silently return `updated` as if the fare change applied;
  the ferry's own `fareCents` field would then disagree with the linked
  expense, which is its own inconsistency.
- Same for the `fareCents <= 0 && updated.expenseId` branch (line 259-268,
  "fare cleared — drop the linked draft") — if the delete reports
  not-deleted (finalized), throw instead of unlinking as if it succeeded.
- `deleteFerryCrossing` (lines 273-294): before calling
  `store.deleteFerry`, if `existing?.expenseId` exists, check/guard its
  deletion the same way; if the linked expense is finalized, throw and do
  **not** delete the ferry crossing either (a ferry crossing whose fare is
  already settled shouldn't vanish out from under the settlement — surface
  the conflict instead of silently orphaning data). Update the stale
  comment (lines 277-283) to describe the enforced invariant instead of
  asserting an unenforced one.

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0

### Step 4: `expenses.finalize` exemption (only if Step 1 concluded it's needed)

If Step 1 decided ferry-linked drafts should never be finalizable at all,
add the check in `finalize` (`expenses.ts:533` region, after the
`existing.status !== "draft"` check): select whether `ferries` has a row
with `expenseId = existing.id` (a simple existence check, indexed on
`expenseId` if such an index exists — check `packages/db/src/schema.ts`'s
`ferries`/`ferryCrossings` table); if so, throw `BAD_REQUEST` with a message
directing the user to edit the ferry crossing instead. Skip this step
entirely if Step 1 concluded ferry-linked drafts finalize normally and only
the ferry-side mutation needs guarding.

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0

### Step 5: Tests

- `packages/api/src/expenses/__tests__/transport-draft.test.ts` (create):
  in-memory or lightly-mocked `db` (match this file's existing lack of a
  store-interface abstraction — a minimal fake with `select`/`update`/
  `delete` chain stubs is fine, or add a thin `TransportDraftStore` seam if
  that's cleaner; follow whatever pattern nearby files like
  `fuel-logs.test.ts` use for DB mocking). Cases: updating a `draft`
  expense succeeds and returns `{ updated: true }`; updating a `finalized`
  expense is a no-op and returns `{ updated: false }`, and the row's
  `subtotalCents`/`totalCents`/`currency` are unchanged; same two cases for
  the delete path.
- `packages/api/src/router/__tests__/ferries.test.ts` (extend or create):
  through `updateFerryCrossing`/`deleteFerryCrossing` with an in-memory
  `FerryStore` — fare edit on a ferry linked to a `draft` expense updates
  it; fare edit on a ferry linked to a `finalized` expense throws
  `BAD_REQUEST` and does not call the underlying update; same two cases for
  `deleteFerryCrossing` (draft → deletes both; finalized → throws, neither
  the expense nor the ferry crossing is deleted).
- If Step 4 applied: extend `packages/api/src/router/__tests__/expenses.test.ts`
  — finalizing a ferry-linked draft throws `BAD_REQUEST`; finalizing an
  ordinary (non-ferry) draft is unaffected.

**Verify**: `pnpm -F @sortey/api test` → all pass

### Step 6: Full package check

**Verify**: `pnpm -F @sortey/api test` → all pass; `pnpm -F @sortey/api lint` → exit 0; `pnpm -F @sortey/api typecheck` → exit 0; `pnpm format:check` → exit 0 (run `pnpm format:fix` if not)

## Test plan

Covered by Step 5. The load-bearing cases are the two "already finalized"
paths on the ferry side (fare edit, crossing delete) — both must reject
cleanly with no partial mutation (i.e., a failed fare-edit attempt must not
have changed the ferry's own `fareCents` either, since `updateFerryCrossing`
already wrote `store.updateFerry` for the base fields before reaching the
reconcile branch — verify the base ferry fields still update even when the
expense-reconcile step throws, or explicitly decide and test that the whole
mutation should roll back together, whichever matches Step 1's intended
semantics).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm -F @sortey/api typecheck` exits 0
- [ ] `pnpm -F @sortey/api test` exits 0, including new tests for: draft update succeeds, finalized update rejected; draft delete succeeds, finalized delete rejected (both via `transport-draft.test.ts` and `ferries.test.ts`)
- [ ] `grep -n "status" packages/api/src/expenses/transport-draft.ts` shows the update/delete paths now filter or check on `status`
- [ ] The stale comment in `ferries.ts`'s `deleteFerryCrossing` (asserting an unenforced invariant) is updated to describe the now-enforced check
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/hardening/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `packages/db/src/schema.ts`'s `expenses.status` enum has more than
  `draft`/`finalized` (e.g. a `voided` state) — the guard condition
  (`status !== "draft"`) may need to be more nuanced than a simple
  not-equal check; report the actual enum before proceeding.
- The UI (Step 1's grep) turns out to already assume ferry-linked drafts
  are always editable/deletable without a finalize step in between (i.e.,
  there's a client-side invariant this guard would newly violate) — that's
  a product conflict, not a pure hardening fix; report it instead of
  guessing which side is "right."
- Any existing test asserts that editing/deleting a ferry crossing always
  succeeds regardless of the linked expense's state — that test encodes
  the bug; report it rather than silently changing its expectation.
- `ferries.ts`'s `updateFerry`/`deleteFerry` base-row writes and the
  expense-reconcile step are not already atomic (no shared transaction) —
  if Step 3's throw happens after the base ferry row already wrote, decide
  with the STOP-and-report escalation whether that partial-write behavior
  is acceptable or needs a transaction wrap, since that's a slightly larger
  change than "add a status check."

## Maintenance notes

- A `voided`/`superseded` expense-status model (Option B from Step 1) would
  let a ferry fare change post-finalization create a new draft that
  replaces the old finalized one in the UI while preserving history —
  friendlier than a hard reject, but out of scope here; flag for a future
  plan if organizers report the hard-reject UX is too blunt in practice.
- The same "system-spawned draft with no status guard" shape may exist for
  other auto-created expense drafts in the codebase (fuel-log splits via
  `buildFuelExpenseValues`, see plan 011(d), create drafts too, though they
  don't appear to have an update/delete path back from their source table
  the way ferries do — confirm during Step 1 whether `fuel-logs.ts` has an
  analogous edit/delete-the-source-record path that also needs this guard;
  if so, note it as a follow-up rather than expanding this plan's scope).
