# Plan 001: Fix the broken line-item-claims query in settlement summary (and remove its N+1)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2408b3e..HEAD -- packages/api/src/router/settlements.ts packages/api/src/expenses/ packages/api/src/router/__tests__/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `2408b3e`, 2026-06-12

## Why this matters

`settlements.summary` is the procedure that computes who owes whom for a trip — the core money feature. Its per-expense claims query selects from `lineItemClaims` but filters on a column of `lineItems`, a table that is not in the query's FROM clause. Drizzle will emit SQL referencing a missing table, so the query fails at runtime for **any trip where a finalized expense has line items** — exactly the itemized-receipt flow the product is built around. The variable holding the correct filter values (`itemIds`) is computed and then never used, which shows the intended query. The same loop also issues two queries per finalized expense (N+1). This plan fixes the query, batches the loads, and puts the logic behind the repo's store-interface test pattern so a regression test locks it in.

## Current state

- `packages/api/src/router/settlements.ts` — the settlements router (~295 lines). `summary` is the first procedure; the bug is at lines 63–80.
- `packages/api/src/expenses/settle.ts` — pure functions `computeNetBalances`, `minimizeTransactions` (already unit-tested in `packages/api/src/expenses/__tests__/`).
- `packages/api/src/expenses/shares.ts` — pure function `computeExpenseShares`.
- `packages/api/src/router/expenses.ts:212-221` — the **correct** claims-query pattern to copy (uses `inArray`).
- `packages/api/src/router/fuel-logs.ts` + `packages/api/src/router/__tests__/fuel-logs.test.ts` — the repo's testing convention: the router file exports a store interface + domain function; the test file builds an in-memory store. Match it.

The broken code, `packages/api/src/router/settlements.ts:63-80` (inside `summary`'s `.query`, looping over `finalizedExpenses`):

```ts
for (const expense of finalizedExpenses) {
  const items = (await ctx.db
    .select()
    .from(lineItems)
    .where(eq(lineItems.expenseId, expense.id))) as Array<
    typeof lineItems.$inferSelect
  >;

  const itemIds = items.map((i) => i.id);
  let claims: Array<typeof lineItemClaims.$inferSelect> = [];
  if (itemIds.length > 0) {
    claims = (await ctx.db
      .select()
      .from(lineItemClaims)
      .where(eq(lineItems.expenseId, expense.id))) as Array<   // BUG: filters on lineItems.expenseId
      typeof lineItemClaims.$inferSelect                        //      while selecting FROM lineItemClaims;
    >;                                                          //      itemIds is never used
  }
  ...
```

The correct pattern, from `packages/api/src/router/expenses.ts:212-221` (the `get` procedure):

```ts
const itemIds = items.map((i) => i.id);
const claims =
  itemIds.length > 0
    ? ((await ctx.db
        .select()
        .from(lineItemClaims)
        .where(inArray(lineItemClaims.lineItemId, itemIds))) as Array<
        typeof lineItemClaims.$inferSelect
      >)
    : [];
```

Conventions that apply:
- Drizzle operators (`and`, `eq`, `inArray`, `isNull`, `desc`) are imported from `@sortey/db` (see the import block at `settlements.ts:1`).
- Commit style is conventional commits with a scope, e.g. `fix(api): ...` (see `git log --oneline`).
- Tests use vitest, `describe`/`it`/`expect`, in-memory store objects, `process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/gmacko_test"` at the top (see `fuel-logs.test.ts:1-10`).
- All money values are integer cents (`subtotalCents`, `taxCents`, `tipCents`, `lineTotalCents`, `amountCents`). Never use floats.

## Commands you will need

| Purpose   | Command                                                            | Expected on success |
|-----------|--------------------------------------------------------------------|---------------------|
| Typecheck | `pnpm turbo run typecheck -F @sortey/api`                          | exit 0              |
| Lint      | `pnpm turbo run lint -F @sortey/api`                               | exit 0              |
| Format    | `pnpm format:check` (fix with `pnpm format:fix`)                   | exit 0              |
| Tests     | `pnpm --filter @sortey/api exec vitest run src/router/__tests__/settlements.test.ts` | all pass |
| All api tests | `pnpm --filter @sortey/api test`                               | all pass            |

## Scope

**In scope** (the only files you should modify/create):
- `packages/api/src/router/settlements.ts`
- `packages/api/src/router/__tests__/settlements.test.ts` (create)

**Out of scope** (do NOT touch, even though they look related):
- `packages/api/src/expenses/settle.ts`, `shares.ts` and their tests — the pure math is correct and already tested.
- `packages/api/src/router/expenses.ts` — its claims query is already correct.
- The response shape of `settlements.summary` — the Next.js settle page and Expo settle screen consume it.
- Database schema (`packages/db/src/schema.ts`) — no schema change is needed for this fix. (A separate index on `lineItemClaims.lineItemId` was considered and deferred; see Maintenance notes.)

## Git workflow

- Branch: `advisor/001-fix-settlement-summary` (branch from current branch; repo default is `master`)
- Commits: conventional, e.g. `fix(api): settlement summary loads claims by line-item ids` and `test(api): settlements summary router coverage`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Extract the summary's data access behind a `SettlementStore` interface

In `packages/api/src/router/settlements.ts`, following the structure of `fuel-logs.ts` (which exports `FuelLogStore`, `createFuelLogStore`-style factory, and an exported domain function used by the router):

1. Define and export a `SettlementStore` interface with methods:
   - `listFinalizedExpenses(tripId: string)` → finalized expense rows (id, payerUserId, subtotalCents, taxCents, tipCents)
   - `listLineItems(expenseIds: string[])` → line-item rows (id, expenseId, lineTotalCents)
   - `listClaims(lineItemIds: string[])` → claim rows (lineItemId, userId)
   - `listTripMembers(tripId: string)` → member rows (userId, displayName, venmoHandle)
   - `listActiveSettlements(tripId: string)` → non-undone settlement rows (fromUserId, toUserId, amountCents)
2. Export `createSettlementStore(db)` implementing it with Drizzle. `listClaims` MUST use `inArray(lineItemClaims.lineItemId, lineItemIds)` (the expenses.ts pattern above). `listLineItems` MUST use `inArray(lineItems.expenseId, expenseIds)`. Both return `[]` without querying when given an empty id array.
3. Export an async domain function `buildSettlementSummary(store: SettlementStore, input: { tripId: string })` containing the current `summary` logic, but batched:
   - load finalized expenses → collect all ids → ONE `listLineItems` call → collect all item ids → ONE `listClaims` call,
   - group items by `expenseId` and claims by `lineItemId` with `Map`s,
   - then run the existing per-expense `computeExpenseShares` loop over the in-memory maps,
   - finish with the existing `computeNetBalances` / `minimizeTransactions` / `allSettled` logic, returning exactly the same shape the procedure returns today (`balances`, `suggestedTransactions`, plus whatever fields follow line 138 — read the rest of the file and preserve them all, including member display info).
4. Change the `summary` procedure body to `buildSettlementSummary(createSettlementStore(ctx.db), { tripId: ctx.tripId })`.

Only the `summary` procedure moves; leave the other procedures in the file untouched.

**Verify**: `pnpm turbo run typecheck -F @sortey/api` → exit 0

### Step 2: Write the regression + behavior tests

Create `packages/api/src/router/__tests__/settlements.test.ts`, modeled structurally on `fuel-logs.test.ts` (in-memory store factory over plain arrays, `randomUUID()` ids). Cases, all through `buildSettlementSummary` with an in-memory `SettlementStore`:

1. **Regression — itemized expense produces shares** (this is the shipped bug): one finalized expense with 2 line items, claims on both by different members → balances are non-empty, payer is owed, claim-weighted shares match `computeExpenseShares` expectations. Assert the store's `listClaims` was called with the line-item ids (e.g. record call args in the mock).
2. Expense with line items but zero claims → unclaimed totals split across the member pool (current `computeExpenseShares` behavior).
3. Expense with no line items at all → `listClaims` not called / called with `[]`, summary still computes from subtotal+tax+tip.
4. Multiple finalized expenses → store methods called once each (batched), not once per expense.
5. Existing non-undone settlement reduces balances; fully settled trip returns `allSettled: true` with empty suggestions.

**Verify**: `pnpm --filter @sortey/api exec vitest run src/router/__tests__/settlements.test.ts` → all pass (≥5 tests)

### Step 3: Full package check

**Verify**: `pnpm --filter @sortey/api test` → all pass; `pnpm turbo run lint -F @sortey/api` → exit 0; `pnpm format:check` → exit 0 (run `pnpm format:fix` if not)

## Test plan

Covered by Step 2. Structural pattern: `packages/api/src/router/__tests__/fuel-logs.test.ts`. The regression case (itemized expense → correct claims loaded) is the one that fails against the pre-fix code shape; since the old code is being replaced rather than patched, encode it as the assertion that `listClaims` receives line-item ids and that claimed items produce claimant-weighted shares.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm turbo run typecheck -F @sortey/api` exits 0
- [ ] `pnpm --filter @sortey/api test` exits 0; `src/router/__tests__/settlements.test.ts` exists with ≥5 passing tests
- [ ] `grep -n "eq(lineItems.expenseId, expense.id)" packages/api/src/router/settlements.ts` returns no matches
- [ ] `grep -c "await ctx.db" packages/api/src/router/settlements.ts` is lower than before (no per-expense queries in `summary`)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `settlements.ts:63-80` no longer matches the excerpt above (someone may have already fixed the query).
- The summary procedure's return shape after line 138 includes fields that depend on per-expense queries not covered by the five store methods — report what they need instead of widening the interface ad hoc.
- Any existing test in `packages/api/src/expenses/__tests__/` fails after your change — the pure math must not change.
- You find callers importing internals of `settlements.ts` other than the router object.

## Maintenance notes

- A composite/single index on `lineItemClaims.lineItemId` was flagged during the audit (the unique constraint is `(lineItemId, userId)`, which does cover lineItemId-prefix lookups — that is why no schema change ships here). If query plans ever show seq scans, revisit.
- If pagination is ever added to finalized expenses, the single-batch `listLineItems` call must be revisited.
- Reviewer focus: the response shape of `summary` must be byte-identical to before; the Next.js settle page (`apps/nextjs/src/app/trips/[tripId]/settle/`) and Expo settle screen are the consumers.
