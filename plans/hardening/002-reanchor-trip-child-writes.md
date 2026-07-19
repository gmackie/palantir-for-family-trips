# Plan 002: Re-anchor trip-child writes that skip the tripId scope

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/hardening/README.md` (create it with a one-row table if it
> doesn't exist yet) — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 0c1ffab..HEAD -- packages/api/src/route-planner/anchor-ops.ts packages/api/src/router/anchors.ts packages/api/src/router/expenses.ts packages/api/src/router/settlements.ts packages/db/src/schema.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `0c1ffab`, 2026-07-19

## Why this matters

This is a multi-tenant app (Workspace ⊃ Trip ⊃ Segments). `tripProcedure()`
(`packages/api/src/auth/guards.ts:205-228`) verifies the caller is a member
of the trip named in the request and puts the verified id on `ctx.tripId` —
but that only proves membership in the trip named by the *input*. Several
mutations then act on a row identified **by a bare row id**, never checking
that row actually belongs to `ctx.tripId`. Any authenticated member of two
trips (in the same or different workspaces) can supply another trip's row id
and mutate or read it.

This app-layer check is not optional defense-in-depth here — it is the
**only** cross-trip guard that exists today. Postgres RLS
(`packages/db/src/rls.ts`, `packages/db/src/tenant.ts`) enforces
**workspace** membership only: `buildWorkspaceScopedReadPredicate` /
`buildTripChildReadPredicate` (`packages/db/src/tenant.ts:39-56`,
`packages/db/src/rls.ts:86-98`) join to `workspace_membership` and check
`membership.workspace_id = trip.workspace_id`; there is no `trip.id =
:tripId` predicate anywhere in the policy layer. So a member of two trips in
the *same* workspace sails through RLS regardless of tripId, and the app
code is what has to stop them. (Extending RLS to close the workspace-vs-trip
gap and adding coverage for tables RLS doesn't touch at all is tracked
separately in `plans/hardening/003-extend-rls-coverage.md` — do not fold
that work into this plan.)

Three concrete holes, verified against `0c1ffab`:

1. **Trip anchors** — `updateAnchor`/`deleteAnchor` mutate by bare
   `anchorId`; `deleteAnchor` doesn't even accept a `tripId` parameter.
2. **Expense line-item unclaim** — deletes a claim by `lineItemId` + the
   caller's own `userId`, without checking the line item's expense belongs
   to `ctx.tripId` (the sibling `claimLineItem` mutation right above it does
   check this).
3. **Settlement idempotency read-back** — on `onConflictDoNothing`, re-reads
   the settlement by `idempotencyKey` alone (a table-wide unique column). A
   cross-trip idempotency-key collision — client bug, replay, or a
   deliberately-reused key — returns **another trip's settlement** (amount,
   payer/payee user ids) to the caller. This is a data leak, not just a
   write-scoping gap.

## Current state

**1. `packages/api/src/route-planner/anchor-ops.ts`**

`listAnchors` (66-79) does it right:

```ts
export async function listAnchors(db: any, tripId: string) {
  return (await db
    .select(SELECT)
    .from(tripAnchors)
    .where(eq(tripAnchors.tripId, tripId))
    .orderBy(asc(tripAnchors.startDate))) as ...
}
```

`updateAnchor` (105-124) does not — the `where` at line 123 filters only by
`anchorId`:

```ts
export async function updateAnchor(
  db: any,
  p: { tripId: string; anchorId: string } & Partial<AnchorInput>,
): Promise<void> {
  const set: Record<string, unknown> = {};
  // ...
  if (Object.keys(set).length === 0) return;
  await db.update(tripAnchors).set(set).where(eq(tripAnchors.id, p.anchorId));
}
```

Note `p.tripId` is already accepted (it's in the type) — it's just never
used in the `where`.

`deleteAnchor` (126-132) is worse — it doesn't even take a `tripId`
parameter:

```ts
export async function deleteAnchor(db: any, anchorId: string): Promise<void> {
  await db.delete(tripAnchors).where(eq(tripAnchors.id, anchorId));
}
```

**`packages/api/src/router/anchors.ts`** — the `delete` mutation (117-128)
calls it as `await deleteAnchor(ctx.db, input.anchorId);` (line 126), so the
gap is reachable from any `tripProcedure()`-gated caller. `update` (81-115)
already passes `tripId: ctx.tripId` into the input object at line 101 — the
plumbing exists, `updateAnchor` just ignores it.

**2. `packages/api/src/router/expenses.ts`**

`claimLineItem` (834-902) is the correct pattern — it joins `lineItems` to
`expenses` and checks `eq(expenses.tripId, ctx.tripId)` (854-859) before
doing anything:

```ts
const [item] = (await ctx.db
  .select({ id: lineItems.id, expenseId: lineItems.expenseId, tripId: expenses.tripId, status: expenses.status })
  .from(lineItems)
  .innerJoin(expenses, eq(expenses.id, lineItems.expenseId))
  .where(and(
    eq(lineItems.id, input.lineItemId),
    eq(lineItems.expenseId, input.expenseId),
    eq(expenses.tripId, ctx.tripId),
  ))
  .limit(1)) as ...
if (!item) throw new TRPCError({ code: "NOT_FOUND", ... });
```

`unclaimLineItem` (907-935) has no such check — it deletes straight by
`lineItemId` + the caller's own `userId`:

```ts
unclaimLineItem: tripProcedure()
  .input(z.object({ workspaceId: ..., tripId: ..., expenseId: ..., lineItemId: z.string().min(1) }))
  .mutation(async ({ ctx, input }) => {
    await ctx.db
      .delete(lineItemClaims)
      .where(and(
        eq(lineItemClaims.lineItemId, input.lineItemId),
        eq(lineItemClaims.userId, ctx.session.user.id),
      ));
    await triggerEvent(`private-expense-${input.expenseId}`, "line-item:unclaimed", ...);
    return { unclaimed: true };
  }),
```

Because it's scoped to `ctx.session.user.id` this can only delete the
caller's *own* claim, so it can't be used to grief other members — but it
does let a member of trip A unclaim their own claim on a line item that
belongs to trip B (if they happen to know/guess the UUID), and it fires a
`private-expense-${input.expenseId}` realtime event using a
client-supplied, unverified `expenseId`.

**3. `packages/api/src/router/settlements.ts`**

`record` (277-342): the insert (318-329) correctly sets
`tripId: ctx.tripId`. The idempotency fallback (332-339) does not:

```ts
const [created] = (await ctx.db
  .insert(settlements)
  .values({ tripId: ctx.tripId, fromUserId: ..., toUserId: ..., amountCents: ..., idempotencyKey: input.idempotencyKey, note: ... })
  .onConflictDoNothing({ target: settlements.idempotencyKey })
  .returning()) as ...

if (!created) {
  const [existing] = (await ctx.db
    .select()
    .from(settlements)
    .where(eq(settlements.idempotencyKey, input.idempotencyKey))   // no tripId
    .limit(1)) as ...
  return existing!;
}
```

`packages/db/src/schema.ts:576-602` shows why the fallback is exploitable —
`idempotencyKey` is a **global** unique column, not scoped to trip:

```ts
export const settlements = pgTable("settlement", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  tripId: t.uuid().notNull().references(() => trips.id, { onDelete: "cascade" }),
  fromUserId: t.text().notNull().references(() => user.id, { onDelete: "cascade" }),
  toUserId: t.text().notNull().references(() => user.id, { onDelete: "cascade" }),
  amountCents: t.integer().notNull(),
  idempotencyKey: t.varchar({ length: 255 }).notNull().unique(),   // line 591 — global unique
  note: t.text(),
  ...
}));
```

`settlements.ts` already imports `and`, `eq`, `TRPCError` (lines 1, 10), so
the mutation-side fix needs no new imports.

## Commands you will need

| Purpose         | Command                              | Expected on success |
|------------------|--------------------------------------|----------------------|
| API typecheck    | `pnpm -F @sortey/api typecheck`      | exit 0               |
| API test         | `pnpm -F @sortey/api test`           | all pass             |
| API lint         | `pnpm -F @sortey/api lint`           | exit 0               |
| DB typecheck     | `pnpm -F @sortey/db typecheck`       | exit 0               |
| Generate migration | `pnpm -F @sortey/db generate`      | writes a new `drizzle/00xx_*.sql` + updates `drizzle/meta/_journal.json` |
| Format check     | `pnpm format:check` (fix with `pnpm format:fix`) | exit 0   |

## Scope

**In scope** (the only files you should modify/create):
- `packages/api/src/route-planner/anchor-ops.ts`
- `packages/api/src/router/anchors.ts`
- `packages/api/src/router/expenses.ts`
- `packages/api/src/router/settlements.ts`
- `packages/db/src/schema.ts` (settlements table only — composite unique constraint)
- `packages/db/drizzle/` (new generated migration file + `meta/_journal.json`, via `pnpm -F @sortey/db generate` — do not hand-write or hand-number it)
- `packages/api/src/router/__tests__/tenant-scoping.test.ts` (extend) or a new sibling test file if you prefer to keep this plan's tests separate

**Out of scope** (do NOT touch, even though related):
- `packages/db/src/rls.ts`, `packages/db/src/tenant.ts` — RLS coverage is `plans/hardening/003-extend-rls-coverage.md`.
- `apps/nextjs/src/app/api/receipts/upload/route.ts` — `plans/hardening/004-receipt-upload-authz-and-ratelimit.md`.
- `apps/expo/**` — `plans/hardening/005-cross-account-cache-and-admin-guc.md`.
- Any zod input schema field names — clients depend on them.
- `packages/api/src/router/__tests__/settlements.test.ts` — it tests `buildSettlementSummary` only, not the `record` mutation; you should not need to touch it (verify this is still true before assuming it).

## Git workflow

- Branch: `hardening/002-reanchor-trip-child-writes`
- Commits, roughly one per step: e.g. `fix(api): scope anchor update/delete to the caller's trip`, `fix(api): scope line-item unclaim to the caller's trip`, `fix(api): scope settlement idempotency read-back to the caller's trip`, `fix(db): make settlement idempotency key unique per trip`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Fix `anchor-ops.ts`

- Import `and` alongside `eq` from `@sortey/db`.
- `updateAnchor`: change the final line to
  `await db.update(tripAnchors).set(set).where(and(eq(tripAnchors.id, p.anchorId), eq(tripAnchors.tripId, p.tripId)));`
  `p.tripId` is already part of the parameter type — no signature change needed.
- `deleteAnchor`: change the signature to accept `tripId` and scope the delete:
  ```ts
  export async function deleteAnchor(db: any, tripId: string, anchorId: string): Promise<void> {
    await db.delete(tripAnchors).where(and(eq(tripAnchors.id, anchorId), eq(tripAnchors.tripId, tripId)));
  }
  ```

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0 (this will fail loudly at the call site until Step 2 lands — that's expected, do Step 2 immediately after).

### Step 2: Update the `anchors.ts` router call site

In `anchorsRouter.delete`'s mutation, change:
`await deleteAnchor(ctx.db, input.anchorId);`
to:
`await deleteAnchor(ctx.db, ctx.tripId, input.anchorId);`

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0

### Step 3: Fix `expenses.ts` `unclaimLineItem`

Mirror `claimLineItem`'s verification pattern rather than trying to express
the trip check inside a `delete().where()` join (Drizzle's `delete` doesn't
support joins). Before the existing delete:

```ts
const [claim] = (await ctx.db
  .select({ lineItemId: lineItemClaims.lineItemId })
  .from(lineItemClaims)
  .innerJoin(lineItems, eq(lineItems.id, lineItemClaims.lineItemId))
  .innerJoin(expenses, eq(expenses.id, lineItems.expenseId))
  .where(
    and(
      eq(lineItemClaims.lineItemId, input.lineItemId),
      eq(lineItemClaims.userId, ctx.session.user.id),
      eq(lineItems.expenseId, input.expenseId),
      eq(expenses.tripId, ctx.tripId),
    ),
  )
  .limit(1)) as Array<{ lineItemId: string }>;

if (!claim) {
  return { unclaimed: true }; // already-unclaimed / cross-trip id: no-op, matches existing idempotent delete semantics
}
```

Keep the existing `.delete(lineItemClaims).where(and(eq(lineItemClaims.lineItemId, input.lineItemId), eq(lineItemClaims.userId, ctx.session.user.id)))` immediately after — it's now safe because the pre-check proved the claim belongs to this trip. Keep the `triggerEvent` call exactly where it is (after the delete, same as today) — don't fire it when the pre-check found nothing (move it inside the `if (claim)` branch instead of after the early return).

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0

### Step 4: Fix `settlements.ts` `record` idempotency read-back

Change the fallback select's `where`:

```ts
const [existing] = (await ctx.db
  .select()
  .from(settlements)
  .where(and(eq(settlements.idempotencyKey, input.idempotencyKey), eq(settlements.tripId, ctx.tripId)))
  .limit(1)) as Array<typeof settlements.$inferSelect>;
if (!existing) {
  // Idempotency key collided with a row from a different trip. Don't leak
  // that row's data — treat it as a genuine conflict.
  throw new TRPCError({
    code: "CONFLICT",
    message: "This idempotency key was already used on a different trip.",
  });
}
return existing;
```

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0

### Step 5: Make the idempotency key unique per trip, not globally

In `packages/db/src/schema.ts`, convert `settlements` from the one-arg
`pgTable("settlement", (t) => ({ ... }))` form to the two-arg form (the
`photoReactions` table at line 641 is the pattern to copy exactly), drop the
column-level `.unique()` on `idempotencyKey`, and add a table-level
composite unique constraint instead:

```ts
export const settlements = pgTable(
  "settlement",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    tripId: t.uuid().notNull().references(() => trips.id, { onDelete: "cascade" }),
    fromUserId: t.text().notNull().references(() => user.id, { onDelete: "cascade" }),
    toUserId: t.text().notNull().references(() => user.id, { onDelete: "cascade" }),
    amountCents: t.integer().notNull(),
    idempotencyKey: t.varchar({ length: 255 }).notNull(), // no longer .unique()
    note: t.text(),
    settledAt: t.timestamp({ mode: "date", withTimezone: true }).defaultNow().notNull(),
    undoneAt: t.timestamp({ mode: "date", withTimezone: true }),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t.timestamp({ mode: "date", withTimezone: true }).$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    unique("settlement_trip_idempotency_key_unique").on(table.tripId, table.idempotencyKey),
  ],
);
```

`unique` is already imported at the top of `schema.ts` (line 2). Then run
`pnpm -F @sortey/db generate` to produce the migration (drop old unique
index, add the new composite one) — do not hand-write the SQL or renumber
existing migrations.

**Verify**: `pnpm -F @sortey/db typecheck` → exit 0; inspect the generated
migration file to confirm it drops the single-column unique constraint and
adds the composite one (nothing else).

### Step 6: Regression tests

Extend `packages/api/src/router/__tests__/tenant-scoping.test.ts` (or add a
sibling file, e.g. `tenant-scoping-002.test.ts`, if you'd rather keep this
plan's tests separate from plan 002's original ones — both are fine, pick
one and be consistent):

- `anchor-ops.ts`: the module has no injectable store — `updateAnchor`/
  `deleteAnchor` are already exported pure functions taking `db` directly,
  so use the repo's `makeDbStub`-style chainable stub (see the existing
  file for the pattern) to assert the `update`/`delete` calls build a
  `where` that includes `tripAnchors.tripId` — a source-grep guard test
  (reading `anchor-ops.ts` via `node:fs` and asserting
  `"eq(tripAnchors.tripId"` appears inside both the `updateAnchor` and
  `deleteAnchor` function bodies, sliced the same way the existing itinerary
  guard test slices on `"delete: tripProcedure()"`) is the pragmatic choice
  here since these are raw Drizzle calls, not injected stores.
- `expenses.ts` `unclaimLineItem`: same source-grep approach — assert the
  function body (sliced from `"unclaimLineItem: tripProcedure()"` to the
  next top-level key) contains `"expenses.tripId"`.
- `settlements.ts` `record`: same — assert the function body contains both
  `"settlements.tripId"` and `"CONFLICT"` inside the idempotency fallback
  block.
- `schema.ts`: a plain assertion test (no DB) that
  `getTableConfig(settlements).uniqueConstraints` contains a constraint over
  both `tripId` and `idempotencyKey`, and that no single-column unique
  constraint remains on `idempotencyKey` alone — see
  `packages/db/src/__tests__/schema.test.ts` for the `getTableConfig`
  pattern; put this test in `packages/db/src/__tests__/schema.test.ts` or a
  new sibling file, not in `packages/api`.

**Verify**: `pnpm -F @sortey/api exec vitest run src/router/__tests__/tenant-scoping.test.ts` → all pass; `pnpm -F @sortey/db test` → all pass (new schema assertion included)

### Step 7: Full package checks

**Verify**: `pnpm -F @sortey/api test` → all pass; `pnpm -F @sortey/api lint` → exit 0; `pnpm -F @sortey/db typecheck` → exit 0; `pnpm format:check` → exit 0

## Test plan

See Step 6. Cases: anchor update/delete where-clause includes `tripAnchors.tripId`; line-item unclaim requires the expense to belong to `ctx.tripId`; settlement idempotency collision across trips throws `CONFLICT` instead of returning the other trip's row; the settlement unique constraint is composite `(tripId, idempotencyKey)`, not a bare column unique.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm -F @sortey/api typecheck` exits 0
- [ ] `pnpm -F @sortey/api test` exits 0, including the extended/new tenant-scoping tests
- [ ] `pnpm -F @sortey/api lint` exits 0
- [ ] `pnpm -F @sortey/db typecheck` exits 0
- [ ] `pnpm -F @sortey/db test` exits 0, including the new schema constraint assertion
- [ ] `grep -n "eq(tripAnchors.tripId" packages/api/src/route-planner/anchor-ops.ts` shows matches inside both `updateAnchor` and `deleteAnchor`
- [ ] `grep -n "deleteAnchor(ctx.db, ctx.tripId" packages/api/src/router/anchors.ts` matches
- [ ] `grep -n "expenses.tripId" packages/api/src/router/expenses.ts` shows a match inside `unclaimLineItem` (not just `claimLineItem`)
- [ ] `grep -n "settlements.tripId" packages/api/src/router/settlements.ts` shows a match inside the `record` idempotency fallback
- [ ] A new migration exists under `packages/db/drizzle/` (generated, not hand-written) replacing the single-column `idempotencyKey` unique constraint with a composite `(tripId, idempotencyKey)` one
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/hardening/README.md` status row updated (create the file with a one-row table if it doesn't exist)

## STOP conditions

Stop and report back (do not improvise) if:

- Any excerpt above doesn't match the live code (the holes may have been fixed since `0c1ffab`).
- `pnpm -F @sortey/db generate` produces more schema diff than the settlements unique-constraint change (it should only touch that one table) — if it does, something else in `schema.ts` is out of sync with the DB; report instead of accepting an unrelated migration.
- Any existing test (in `packages/api` or `packages/db`) currently asserts the old single-column `idempotencyKey` unique behavior — report which test and do not simply delete/rewrite it without checking whether it's testing something else.
- Fixing a site appears to require changing a zod input schema or a client-visible response shape (the `CONFLICT` throw in Step 4 is an intentional exception — it's a new, narrower failure mode replacing a data leak, not a shape change).

## Maintenance notes

- The durable fix for the *workspace-vs-trip* half of this problem is
  narrowing Postgres RLS from workspace-scoped to trip-scoped predicates —
  out of scope here, tracked as a design question in
  `plans/hardening/003-extend-rls-coverage.md`'s Maintenance notes (RLS
  currently checks `trip.workspace_id`, never `trip.id`, everywhere in
  `packages/db/src/rls.ts`; that's a bigger, separate design decision than
  extending table *coverage*, which is what plan 003 does).
- Review checklist for future routers: any mutation whose where-clause is a
  bare row id (or a row id + the caller's own user id) must either include
  the trip/workspace column directly, or pre-fetch scoped by `ctx.tripId`
  before mutating. `claimLineItem` (this file) and `pins.ts:delete` are the
  exemplars.
- Any column with a bare `.unique()` that isn't obviously
  global-by-design (API keys, auth tokens) is worth a second look for the
  same "unique key collision leaks cross-tenant data via read-back" shape
  found in `settlements.record`.
