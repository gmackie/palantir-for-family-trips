# Plan 010: Money input validation and membership/concurrency guards

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/hardening/README.md` (create it, modeled on `plans/README.md`,
> if it doesn't exist yet) — unless a reviewer dispatched you and told you
> they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 0c1ffab..HEAD -- packages/api/src/router/lodging.ts packages/api/src/router/rooms.ts packages/api/src/router/trips.ts packages/api/src/router/expenses.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW for (a)/(b)/(c) — additive validation matching an existing in-repo pattern; MED for (d) — a transaction/index change touching the money-finalization hot path
- **Depends on**: none (independent sub-items; (d) should not run concurrently with plan 009's `expenses.ts` changes — see Dependency note)
- **Category**: bug / correctness
- **Planned at**: commit `0c1ffab`, 2026-07-19

## Why this matters

Four independent, small correctness gaps, each following an established
correct pattern that already exists elsewhere in the same codebase — these
are omissions, not design questions:

- **(a) Negative money accepted.** `lodging.ts` accepts negative
  `nightlyRateCents`/`totalCostCents`/`costCents` because those Zod schemas
  are missing `.nonnegative()`, while `expenses.ts` consistently applies it
  to every money field. A negative lodging cost corrupts trip cost totals
  and any settlement math that reads from lodging.
- **(b) Unvalidated room assignment.** `rooms.assignOccupant` inserts
  `{ roomId, userId }` without checking `userId` is actually a member of the
  trip, while the sibling procedure `expenses.assignLineItem` validates
  exactly this (`userId` against `tripMembers`) before writing. Anyone who
  can call `assignOccupant` (gated only by trip membership, not
  organizer-only) can assign an arbitrary user id to a room.
- **(c) Non-idempotent invite accept.** `trips.acceptInvite` does a
  check-then-insert on `tripMembers` with no `onConflictDoNothing`, while
  the sibling `joinTripMembership` (same file) already does exactly this
  correctly. A double-tap or two concurrent requests on the same invite
  link throws an unhandled unique-constraint violation (500) instead of the
  idempotent no-op the invite-accept UX implies.
- **(d) Mixed-currency finalize race.** `expenses.finalize`'s
  currency-match enforcement is a check-then-act: it reads whether any
  finalized expense in the trip has a different currency, then writes
  `status: "finalized"` — two concurrent `finalize` calls on
  different-currency drafts can both pass the check before either commits,
  landing two different currencies as "finalized" in the same trip despite
  the code's explicit intent to forbid that (settlement math assumes one
  currency per trip).

## Current state

### (a) `packages/api/src/router/lodging.ts` — missing `.nonnegative()`

Lines 107-108 (create-lodging input):
```ts
nightlyRateCents: z.number().int().optional(),
totalCostCents: z.number().int().optional(),
```
Lines 170-171 (update-lodging input):
```ts
nightlyRateCents: z.number().int().nullable().optional(),
totalCostCents: z.number().int().nullable().optional(),
```
Line 529 (a third money field, in a different procedure in the same file):
```ts
costCents: z.number().int().optional(),
```

Contrast, `packages/api/src/router/expenses.ts` (the established pattern),
e.g. lines 182-185:
```ts
subtotalCents: z.number().int().nonnegative().default(0),
taxCents: z.number().int().nonnegative().default(0),
tipCents: z.number().int().nonnegative().default(0),
totalCents: z.number().int().nonnegative().default(0),
```
(repeated at lines 417-420, 653-654, 716-717 for line items).

### (b) `packages/api/src/router/rooms.ts` — `assignOccupant` skips membership check

Domain function (lines 136-144):
```ts
export async function assignOccupant(
  store: RoomStore,
  input: { tripId: string; roomId: string; userId: string },
): Promise<{ ok: true }> {
  await assertRoomInTrip(store, input.roomId, input.tripId);
  // Idempotent: the unique(room, user) constraint backs onConflictDoNothing.
  await store.insertOccupant(input.roomId, input.userId);
  return { ok: true };
}
```
Router wiring (lines 287-302):
```ts
assignOccupant: tripProcedure()
  .input(z.object({ workspaceId: z.string().min(1), tripId: z.string().min(1), roomId: z.string().min(1), userId: z.string().min(1) }))
  .mutation(({ ctx, input }) =>
    assignOccupant(createRoomStore(ctx.db), { tripId: ctx.tripId, roomId: input.roomId, userId: input.userId }),
  ),
```
`assertRoomInTrip` only checks the *room* belongs to the trip — never that
`input.userId` is a trip member.

Contrast, `packages/api/src/router/expenses.ts`'s `assignLineItem`
(lines 940-973), which validates every `userId` in its input against
`tripMembers` before writing, and additionally gates the whole procedure to
organizers:
```ts
if (ctx.tripRole !== "organizer") {
  throw new TRPCError({ code: "FORBIDDEN", message: "Only organizers can reassign line items for others." });
}
const members = (await ctx.db.select({ userId: tripMembers.userId }).from(tripMembers).where(eq(tripMembers.tripId, ctx.tripId))) as Array<{ userId: string }>;
const memberIds = new Set(members.map((m) => m.userId));
for (const userId of input.userIds) {
  if (!memberIds.has(userId)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `User ${userId} is not a member of this trip.` });
  }
}
```
(This plan only asks for the membership-existence check on `rooms.ts`, not
necessarily the organizer-only gate — see Step 2 for the scoping decision.)

### (c) `packages/api/src/router/trips.ts` — `acceptInvite` check-then-insert race

`acceptInvite` (lines 1380-1507), the membership-write block
(lines 1442-1493):
```ts
await ctx.db.transaction(async (tx: any) => {
  const existingWorkspaceMember = await tx.query.workspaceMembership.findFirst({...});
  if (!existingWorkspaceMember) {
    await tx.insert(workspaceMembership).values({...});
  }

  const existingTripMember = await tx.query.tripMembers?.findFirst?.({
    where: and(eq(tripMembers.userId, ctx.session.user.id), eq(tripMembers.tripId, invite.tripId)),
  });                                                          // line 1462 — check

  if (existingTripMember) {
    await tx.update(tripMembers).set({ role: invite.role }).where(...);
  } else {
    await tx.insert(tripMembers).values({                      // line 1480-1485 — act, no onConflictDoNothing
      tripId: invite.tripId,
      userId: ctx.session.user.id,
      role: invite.role,
    });
  }

  await tx.update(tripInvites).set({ acceptedAt: new Date() }).where(
    and(eq(tripInvites.id, invite.id), isNull(tripInvites.acceptedAt)),
  );
});
```
Two concurrent `acceptInvite` calls for the same user+trip can both pass the
`findFirst` check (neither sees the other's uncommitted insert, depending on
isolation level — and even at default Postgres `READ COMMITTED`, the second
transaction's `insert` after the first commits will hit the unique
constraint) before either inserts, so the second `insert` throws a raw
constraint violation instead of a clean tRPC error.

Contrast, the same file's `joinTripMembership` (lines 831-860), the correct
pattern already used one function away:
```ts
joinTripMembership: async ({ workspaceId, tripId, userId }) => {
  return await db.transaction(async (tx: any) => {
    await tx.insert(workspaceMembership).values({ workspaceId, userId, role: "member" })
      .onConflictDoNothing({ target: [workspaceMembership.workspaceId, workspaceMembership.userId] });
    const insertedTripMembers = (await tx.insert(tripMembers).values({ tripId, userId, role: "member" })
      .onConflictDoNothing({ target: [tripMembers.tripId, tripMembers.userId] })
      .returning({ tripId: tripMembers.tripId })) as Array<{ tripId: string }>;
    return { tripMemberInserted: insertedTripMembers.length > 0 };
  });
},
```
Confirm the exact unique-constraint name/target for `tripMembers` (grep
`packages/db/src/schema.ts` for `tripMembers`'s `unique(...)` — likely
`(tripId, userId)`, matching `joinTripMembership`'s `target`) before writing
the fix, since `onConflictDoNothing`'s `target` must match exactly.

### (d) `packages/api/src/router/expenses.ts` — `finalize` mixed-currency race

Lines 573-593 (inside `finalize`, after the status/authorization checks):
```ts
// Enforce currency match: all finalized expenses in a trip must share one currency.
const existingFinalized = (await ctx.db
  .select({ currency: expenses.currency })
  .from(expenses)
  .where(and(eq(expenses.tripId, ctx.tripId), eq(expenses.status, "finalized")))
  .limit(1)) as Array<{ currency: string }>;

if (existingFinalized.length > 0 && existingFinalized[0]?.currency !== existing.currency) {
  throw new TRPCError({ code: "BAD_REQUEST", message: `This trip already has finalized expenses in ${existingFinalized[0]?.currency}. Mixed-currency settlement is not supported.` });
}

const [updated] = (await ctx.db.update(expenses).set({ status: "finalized" })
  .where(eq(expenses.id, input.expenseId)).returning())...
```
Read (`existingFinalized`) and write (`update ... set status: "finalized"`)
are two separate, unguarded statements with no transaction and no unique
constraint backing the "one currency per trip's finalized expenses"
invariant — a pure application-level check-then-act race.

## Commands you will need

| Purpose   | Command                                                            | Expected on success |
|-----------|---------------------------------------------------------------------|---------------------|
| Typecheck | `pnpm -F @sortey/api typecheck`                                     | exit 0               |
| Lint      | `pnpm -F @sortey/api lint`                                          | exit 0               |
| Format    | `pnpm format:check` (fix with `pnpm format:fix`)                    | exit 0               |
| Tests     | `pnpm -F @sortey/api test`                                          | all pass             |
| Focused   | `pnpm --filter @sortey/api exec vitest run src/router/__tests__/lodging.test.ts src/router/__tests__/rooms.test.ts src/router/__tests__/trips.test.ts src/router/__tests__/expenses.test.ts` | all pass (create missing files) |

## Scope

**In scope** (the only files you should modify/create), by sub-item:
- (a) `packages/api/src/router/lodging.ts` — add `.nonnegative()` to the three fields; `packages/api/src/router/__tests__/lodging.test.ts` (extend or create)
- (b) `packages/api/src/router/rooms.ts` — add membership check to `assignOccupant`; `packages/api/src/router/__tests__/rooms.test.ts` (extend or create)
- (c) `packages/api/src/router/trips.ts` — `onConflictDoNothing` in `acceptInvite`; `packages/api/src/router/__tests__/trips.test.ts` (extend — coordinate with plan 004's note about this same file)
- (d) `packages/api/src/router/expenses.ts` — transaction-wrap or index-back the mixed-currency check in `finalize`; `packages/db/src/schema.ts` ONLY if you choose the partial-unique-index approach (see Step 5); `packages/api/src/router/__tests__/expenses.test.ts` (extend)
- If a DB migration is needed for (d)'s index option, the generated migration file under `packages/db/` (follow the repo's existing migration-generation command — check `packages/db/package.json` scripts, e.g. `drizzle-kit generate`, before hand-writing SQL)

**Out of scope** (do NOT touch, even though they look related):
- `rooms.ts`'s `removeOccupant` — no membership check is needed there (removing a non-member is a harmless no-op at worst); only `assignOccupant` writes a new association.
- Gating `rooms.assignOccupant` to organizer-only — `expenses.assignLineItem`'s organizer gate is about *reassigning others'* claims, a different concern; adding an organizer-only restriction to room assignment is a product/UX decision outside a hardening pass. Only add the membership-existence check.
- `trips.acceptInvite`'s email-match, expiry, or already-accepted checks (lines 1412-1440) — correct as-is; only the insert race is in scope.
- Any other money field elsewhere in the codebase beyond the three named in (a) — this plan is scoped to the three cited `lodging.ts` fields; a full repo-wide audit for missing `.nonnegative()` is a separate, larger effort (note as a Maintenance follow-up if you spot more while in the file).
- Redesigning `expenses.finalize`'s currency model (e.g. adding a `trips.settlementCurrency` column) — out of scope; the fix must work within the existing per-expense `currency` column.

## Git workflow

- Branch: `advisor/010-money-input-and-race-guards`
- Commits: conventional, one per sub-item recommended, e.g. `fix(api): reject negative lodging cost fields`, `fix(api): verify room occupant is a trip member`, `fix(api): make acceptInvite idempotent under concurrent accepts`, `fix(api): close expenses.finalize mixed-currency race`
- Do NOT push or open a PR unless the operator instructed it.
- **Dependency note**: plan 009 also edits `packages/api/src/router/expenses.ts` (the `finalize` procedure, possibly). If both plans are in flight simultaneously, do sub-item (d) of this plan and plan 009's `finalize` changes (if any) sequentially, not concurrently, to avoid merge conflicts in the same function.

## Steps

### Step 1 (sub-item a): Add `.nonnegative()` to lodging money fields

In `packages/api/src/router/lodging.ts`, change:
- Line 107: `nightlyRateCents: z.number().int().optional()` → `z.number().int().nonnegative().optional()`
- Line 108: `totalCostCents: z.number().int().optional()` → `z.number().int().nonnegative().optional()`
- Line 170: `nightlyRateCents: z.number().int().nullable().optional()` → `z.number().int().nonnegative().nullable().optional()`
- Line 171: `totalCostCents: z.number().int().nullable().optional()` → `z.number().int().nonnegative().nullable().optional()`
- Line 529: `costCents: z.number().int().optional()` → `z.number().int().nonnegative().optional()`

Re-run the grep from the "Current state" section to confirm no other money
field in this file lacks `.nonnegative()` before moving on (report any you
find as a Maintenance note rather than silently expanding scope).

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0

### Step 2 (sub-item b): Membership check in `assignOccupant`

In `packages/api/src/router/rooms.ts`, extend `assignOccupant`'s `RoomStore`
usage (or the store interface itself, whichever is cleaner given the
existing `RoomStore` shape — read the full interface near the top of the
file first) to verify `input.userId` is a trip member before inserting,
mirroring `expenses.assignLineItem`'s pattern:

```ts
export async function assignOccupant(
  store: RoomStore,
  input: { tripId: string; roomId: string; userId: string },
): Promise<{ ok: true }> {
  await assertRoomInTrip(store, input.roomId, input.tripId);
  const isMember = await store.isTripMember(input.tripId, input.userId);   // new store method
  if (!isMember) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `User ${input.userId} is not a member of this trip.` });
  }
  await store.insertOccupant(input.roomId, input.userId);
  return { ok: true };
}
```

Add `isTripMember` to the `RoomStore` interface and its Drizzle
implementation (a single `tripMembers` existence query, following the same
`eq(tripMembers.tripId, ...)`/`eq(tripMembers.userId, ...)` shape used in
`expenses.ts`).

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0

### Step 3 (sub-item c): `onConflictDoNothing` in `acceptInvite`

First confirm `tripMembers`'s unique constraint target in
`packages/db/src/schema.ts` (grep `unique(` near the `tripMembers` table
definition). Then rework the membership-write block in `acceptInvite`
(`trips.ts:1462-1485`) to use insert-with-conflict-handling instead of
check-then-branch, matching `joinTripMembership`'s shape:

```ts
await tx
  .insert(tripMembers)
  .values({ tripId: invite.tripId, userId: ctx.session.user.id, role: invite.role })
  .onConflictDoNothing({ target: [tripMembers.tripId, tripMembers.userId] });

// Existing member re-accepting a (possibly role-upgraded) invite: apply the
// invite's role explicitly, since onConflictDoNothing above is a no-op on
// conflict and won't update the role.
await tx
  .update(tripMembers)
  .set({ role: invite.role })
  .where(and(eq(tripMembers.tripId, invite.tripId), eq(tripMembers.userId, ctx.session.user.id)));
```

(Two statements — insert-or-skip, then unconditional update-to-invite-role —
achieve the same "insert if new, upgrade role if existing" semantics as the
original check-then-branch, but without the race: the `update` runs after
the `insert` regardless of which branch fired, so there's no window where a
second concurrent request's insert can throw.) Confirm this preserves the
existing behavior of always applying `invite.role` on accept (re-read
`existingTripMember`'s branch in the current code — the update happens even
when `existingTripMember` already exists, so this matches).

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0

### Step 4 (sub-item c, continued): Concurrency test

Add a test to `packages/api/src/router/__tests__/trips.test.ts` that calls
`acceptInvite`'s underlying logic twice in the same "already a member" state
(simulate the second call as if the first already committed — i.e., seed
the in-memory store with the trip-membership row already present, matching
what `onConflictDoNothing` would see) and assert it does not throw and the
role ends up correct. If the router logic isn't already extracted into a
store-driven pure function the way `joinTripMembership` is (check — this
may require pulling the membership-write block out of the inline `.mutation`
callback into a testable function first; if so, keep the extraction minimal
and mechanical, don't restructure unrelated parts of `acceptInvite`).

**Verify**: `pnpm --filter @sortey/api exec vitest run src/router/__tests__/trips.test.ts` → all pass

### Step 5 (sub-item d): Close the mixed-currency race

Two viable approaches — pick one; prefer the transaction approach unless
Step 5's investigation shows it doesn't actually close the race under this
repo's DB isolation level:

- **Transaction approach (default)**: wrap the read
  (`existingFinalized`) and write (`update ... set status: "finalized"`) in
  a single `ctx.db.transaction(...)`. Note plain `READ COMMITTED`
  transactions do NOT prevent this race by default (a concurrent
  transaction's commit isn't visible until commit, but two concurrent
  reads can both see zero conflicting rows before either writes) — you
  likely need `SELECT ... FOR UPDATE`-style row locking or `SERIALIZABLE`
  isolation on the read, or to re-check inside the same transaction
  immediately before the write with a `WHERE` clause that would fail to
  match if another finalize landed first. Investigate what transaction
  helpers/patterns already exist in this codebase (grep
  `ctx.db.transaction` usage elsewhere, e.g. `trips.ts`'s `acceptInvite`
  itself, `expenses.assignLineItem`) and match the existing style rather
  than introducing a new pattern.
- **Partial unique index approach (more robust, slightly more invasive)**:
  add a partial unique index on `expenses` enforcing "at most one distinct
  currency among finalized expenses per trip" is not directly expressible
  as a simple unique index (uniqueness constraints can't compare against
  other rows' values in general) — a more realistic index-backed guard is
  a **generated/materialized `trips.finalizedCurrency` column** set on
  first finalize and checked (not just read) on every subsequent finalize
  inside the same statement's `WHERE`, or a dedicated small table
  `trip_settlement_currency (trip_id PK, currency)` written with
  `onConflictDoNothing` on first finalize and read (not raced) thereafter.
  This is more schema surface than the transaction approach — only take
  this path if Step 5's investigation shows the transaction/row-lock
  approach can't reasonably close the race with this codebase's existing
  Drizzle/Postgres setup.

Whichever you choose, the fix must guarantee: two concurrent `finalize`
calls for drafts with different currencies in the same trip cannot both
succeed — one must throw `BAD_REQUEST` with the existing message.

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0

### Step 6: Tests for (a), (b), (d)

- `lodging.test.ts`: negative `nightlyRateCents`/`totalCostCents`/`costCents`
  are rejected by Zod (input validation, not a DB round-trip) for both the
  create and update procedures.
- `rooms.test.ts`: `assignOccupant` with a `userId` not in `tripMembers`
  throws `BAD_REQUEST`; with a valid member, succeeds as before.
- `expenses.test.ts`: sequential finalize of two different-currency drafts
  — first succeeds, second throws (this already passes today, confirm it
  still does after the refactor); add a race-shaped test if the codebase's
  test harness can simulate concurrent transactions against the real test
  DB (check `DATABASE_URL ??= "postgresql://...gmacko_test"` fixtures used
  elsewhere, e.g. `fuel-logs.test.ts`) — if true concurrency isn't
  practically testable in this harness, document why in the test file and
  rely on the transaction/index mechanism's inherent guarantee instead of a
  flaky timing test.

**Verify**: `pnpm -F @sortey/api test` → all pass

### Step 7: Full package check

**Verify**: `pnpm -F @sortey/api test` → all pass; `pnpm -F @sortey/api lint` → exit 0; `pnpm -F @sortey/api typecheck` → exit 0; `pnpm format:check` → exit 0 (run `pnpm format:fix` if not)

## Test plan

Covered per sub-item in Step 6. (c)'s test (Step 4) is the trickiest to
express deterministically without a live-concurrency harness — simulating
the post-race state (membership row already present when the "second" call
runs) is an acceptable proxy for the actual race, since the fix's
correctness lives entirely in `onConflictDoNothing` handling that state
correctly, not in timing.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm -F @sortey/api typecheck` exits 0
- [ ] `pnpm -F @sortey/api test` exits 0, including new tests for all four sub-items
- [ ] `grep -n "nightlyRateCents: z.number().int().optional()\|totalCostCents: z.number().int().optional()\|costCents: z.number().int().optional()" packages/api/src/router/lodging.ts` returns no matches (all three now carry `.nonnegative()`)
- [ ] `grep -n "isTripMember\|is not a member of this trip" packages/api/src/router/rooms.ts` shows the new check
- [ ] `grep -n "onConflictDoNothing" packages/api/src/router/trips.ts` shows a new hit inside `acceptInvite`'s membership block (in addition to the existing `joinTripMembership` ones)
- [ ] Two concurrent-shaped `finalize` calls in a test cannot both leave `status: "finalized"` rows with different currencies in the same trip
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/hardening/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `tripMembers`'s unique constraint target (Step 3) isn't `(tripId, userId)`
  — `onConflictDoNothing`'s `target` must match the real constraint exactly
  or Postgres will error; report the actual constraint before proceeding.
- Any existing test relies on `lodging.ts` accepting a negative cost value
  (unlikely, but check) — that test encodes the bug; fix its fixture rather
  than special-casing the source.
- `rooms.ts`'s `RoomStore` interface turns out to be shared with a code path
  where "is this a trip member" can't cheaply be answered (e.g. no `db`
  handle available) — report instead of forcing an awkward abstraction.
- Step 5's investigation concludes plain application-level transactions in
  this codebase's Postgres setup genuinely cannot close the race without a
  schema change — in that case implement the partial-unique-index /
  dedicated-table approach, but STOP and report before writing a migration
  if you're not confident which shape (generated column vs. side table) fits
  the existing `packages/db/src/schema.ts` conventions; a reviewer should
  weigh in on schema changes.
- Plan 009 has already modified `expenses.ts`'s `finalize` procedure when
  you reach Step 5 — re-read the live file (not this plan's excerpt) before
  editing, since line numbers and surrounding logic may have shifted.

## Maintenance notes

- This plan intentionally scopes (a) to the three named `lodging.ts`
  fields. A follow-up repo-wide grep for `z.number().int()` money fields
  missing `.nonnegative()` (or `.positive()` where zero shouldn't be valid)
  across all routers would be a good cheap follow-up hardening pass.
- (d)'s underlying design constraint — "settlement refuses mixed
  currencies," per CLAUDE.md's stated architecture decision — is enforced
  today only at `finalize`-time, per-trip, with no schema-level backing.
  If currency-mixing bugs recur, the side-table/generated-column approach
  from Step 5 is the more permanent fix; the transaction approach in this
  plan closes the immediate race but keeps the invariant purely
  application-enforced.
