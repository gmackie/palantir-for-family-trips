# Plan 001: Fix the settlement claims query so claimed line items actually affect settlement math, and add router-level tests

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat ba3457d..HEAD -- packages/api/src/router/settlements.ts packages/api/src/router/__tests__/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (money-math path; mitigated by the new tests this plan adds)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `ba3457d`, 2026-06-12

## Why this matters

`settlements.summary` is the endpoint that tells trip members who owes whom.
Its query that loads line-item claims filters on a column from a table that is
not in the query (`lineItems.expenseId` while selecting `FROM lineItemClaims`),
so Drizzle emits SQL referencing a missing FROM-clause entry. Postgres either
rejects the query at runtime or, at best, no claims are ever loaded — meaning
every line item is treated as unclaimed and split across all trip members,
silently producing wrong settlement amounts. Nothing caught this because the
only settlement tests cover the pure math functions (`computeNetBalances`,
`minimizeTransactions`), never the router's data loading. This plan fixes the
query, removes the per-expense N+1 loop in the same lines, and adds the
router-level test layer that would have caught the bug.

## Current state

Relevant files:

- `packages/api/src/router/settlements.ts` — the settlements router; contains
  the bug in the `summary` query (lines 63–80) and the per-expense N+1 loop.
- `packages/api/src/router/expenses.ts` — `expenses.get` (lines 212–221) shows
  the **correct** claims-query pattern to replicate.
- `packages/api/src/router/chat.ts` — the repo's testability convention
  (store interface + pure functions + thin router); the structural exemplar.
- `packages/api/src/expenses/settle.ts` — `computeNetBalances` (line 92),
  `minimizeTransactions` (line 31); pure, already tested, do not modify.
- `packages/api/src/expenses/shares.ts` — `computeExpenseShares` (line 58);
  pure, already tested, do not modify.
- `packages/api/src/router/__tests__/chat.test.ts` — the test pattern to model
  the new test file on (in-memory store mock, no real DB).

The buggy code as it exists today, `packages/api/src/router/settlements.ts:63-80`:

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
            .where(eq(lineItems.expenseId, expense.id))) as Array<   // ← THE BUG:
            typeof lineItemClaims.$inferSelect                       //   filters on lineItems.expenseId
          >;                                                         //   but selects FROM lineItemClaims
        }
```

The **correct** pattern, from `packages/api/src/router/expenses.ts:212-221`:

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

After the loop, `settlements.ts:82-106` builds `claimantsByLineItem` and calls
`computeExpenseShares(...)` per expense, then `computeNetBalances` and
`minimizeTransactions` (lines 116–125), returning
`{ balances, suggestedTransactions, allSettled, members }` (lines 138–143).
**This response shape must not change** — the Next.js settle page consumes it.

Imports at the top of `settlements.ts:1-15` currently include
`and, desc, eq, isNull` from `"@sortey/db"` — note there is **no `inArray`
import yet**; you will add it.

Repo testability convention (from `chat.ts`): define an exported store
interface, an exported `create<X>Store(db: any)` factory wrapping Drizzle, and
exported pure functions that take the store; the router procedures stay thin.
See `chat.ts:24` (`export interface ChatStore`), `chat.ts:69`
(`export function createChatStore(db: any): ChatStore`), `chat.ts:138`
(`export async function sendMessage(store: ChatStore, ...)`), and the thin
wiring at `chat.ts:231` (`sendMessage(createChatStore(ctx.db), {...})`).
Tests (`__tests__/chat.test.ts:11-63`) build an in-memory store from an object
literal over a state array. Match this exactly.

Vocabulary (from `CONTEXT.md` / `CLAUDE.md`): the lifecycle term is
"finalized" for expenses; settlement intentionally refuses mixed currencies
(do not "fix" that); per-expense currency is by design.

## Commands you will need

| Purpose   | Command                                  | Expected on success |
|-----------|------------------------------------------|---------------------|
| Install   | `pnpm install`                           | exit 0              |
| Typecheck (api only) | `pnpm -F @sortey/api typecheck` | exit 0, no errors   |
| Tests (api only)     | `pnpm -F @sortey/api test`      | all pass            |
| Lint      | `pnpm -F @sortey/api lint`               | exit 0              |
| Full gate | `pnpm check:fast`                        | exit 0              |

## Scope

**In scope** (the only files you should modify/create):
- `packages/api/src/router/settlements.ts`
- `packages/api/src/router/__tests__/settlements.test.ts` (create)

**Out of scope** (do NOT touch, even though they look related):
- `packages/api/src/expenses/settle.ts` and `shares.ts` — pure math, already
  correct and tested.
- `packages/api/src/router/expenses.ts` — its claims query is correct; a
  separate plan (002) covers its `attachReceiptImage` issue.
- The `record` / `undo` mutations in `settlements.ts` (lines ~150 onward) —
  their idempotency weakness is a separately tracked finding; do not refactor
  them in this plan.
- The response shape of `summary` — the dashboard depends on it.

## Git workflow

- Branch off the current branch; name like `advisor/001-settlement-claims-fix`
  unless the operator says otherwise.
- Commit style: conventional commits, matching history, e.g.
  `fix(api): load settlement claims by lineItemId (claims were never applied)`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the failing tests first

Create `packages/api/src/router/__tests__/settlements.test.ts`, modeled
structurally on `__tests__/chat.test.ts` (including the
`process.env.DATABASE_URL ??=` preamble at its top, lines 4–5).

Because the summary logic currently lives inline in the router, write the
tests against the seam you will introduce in Step 2: import
`buildSettlementSummary` and the `SettlementSummaryStore` type from
`"../settlements"`, and build an in-memory store. Cases to cover are listed in
the Test plan below. The file will not compile yet — that's expected at this
step; just confirm the test cases express the intended behavior.

**Verify**: `pnpm -F @sortey/api test` → fails to compile / fails (expected —
the seam doesn't exist yet). Do not count this as a STOP condition.

### Step 2: Extract the store seam in settlements.ts

In `packages/api/src/router/settlements.ts`, following the `chat.ts` pattern:

1. Define narrow row types containing only the fields the summary uses
   (e.g. `ExpenseRow { id, payerUserId, subtotalCents, taxCents, tipCents }`,
   `LineItemRow { id, expenseId, lineTotalCents }`,
   `ClaimRow { lineItemId, userId }`,
   `MemberRow { userId, displayName, venmoHandle }`,
   `SettlementRow { fromUserId, toUserId, amountCents }`).
2. Define and export:

```ts
export interface SettlementSummaryStore {
  listFinalizedExpenses(tripId: string): Promise<ExpenseRow[]>;
  listLineItems(expenseIds: string[]): Promise<LineItemRow[]>;
  listClaims(lineItemIds: string[]): Promise<ClaimRow[]>;
  listMembers(tripId: string): Promise<MemberRow[]>;
  listActiveSettlements(tripId: string): Promise<SettlementRow[]>;
}

export function createSettlementSummaryStore(db: any): SettlementSummaryStore
```

   The Drizzle-backed implementations move the existing queries out of the
   loop: `listLineItems` uses `inArray(lineItems.expenseId, expenseIds)`;
   `listClaims` uses `inArray(lineItemClaims.lineItemId, lineItemIds)` — this
   line is the bug fix. Both return `[]` immediately when given an empty array
   (avoid `inArray` with an empty list). Add `inArray` to the existing
   `"@sortey/db"` import on line 1.
3. Export `buildSettlementSummary(store: SettlementSummaryStore, tripId: string)`
   containing the current orchestration: load expenses, load ALL line items in
   one call, load ALL claims in one call, group in-memory by
   `expenseId`/`lineItemId` using `Map`s, call `computeExpenseShares` per
   expense, then `computeNetBalances` + `minimizeTransactions`, and return
   exactly the current shape `{ balances, suggestedTransactions, allSettled, members }`.
4. Reduce the `summary` procedure body to
   `buildSettlementSummary(createSettlementSummaryStore(ctx.db), ctx.tripId)`.

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0.

### Step 3: Make the tests pass

Run the suite; fix discrepancies between the seam and the tests (in whichever
direction is faithful to the behavior described in the Test plan).

**Verify**: `pnpm -F @sortey/api test` → all pass, including the new
`settlements.test.ts` cases.

### Step 4: Full gate

**Verify**: `pnpm check:fast` → exit 0. Then
`grep -n "inArray(lineItemClaims.lineItemId" packages/api/src/router/settlements.ts`
→ at least one match, and
`grep -n "from(lineItemClaims)" packages/api/src/router/settlements.ts | wc -l`
→ `1`.

## Test plan

New file `packages/api/src/router/__tests__/settlements.test.ts`, modeled on
`chat.test.ts` (in-memory store, deterministic data, no real DB). Cases:

1. **Regression (the bug)**: one finalized expense, payer A, two line items of
   1000¢ each, subtotal 2000¢, zero tax/tip; item 1 claimed by member B; trip
   members A and B. Expect B's balance to owe item 1 fully plus half of the
   unclaimed item 2 — i.e. suggested transaction B→A of 1500¢. Before the fix,
   claims never loaded, so this asserts the difference.
2. **No expenses**: empty store → `allSettled: true`, `balances: []`,
   `suggestedTransactions: []`, `members` passed through.
3. **Expense with zero line items**: subtotal splits across all members per
   `computeExpenseShares`' participant-pool behavior; payer ends up net
   positive.
4. **Existing settlement offsets balances**: same data as case 1 plus an
   active settlement B→A of 1500¢ → `allSettled: true`.
5. **Batching guard**: with 3 finalized expenses, wrap the in-memory store's
   methods with call counters; assert `listLineItems` and `listClaims` are
   each called exactly once (prevents the N+1 from coming back).

Verification: `pnpm -F @sortey/api test` → all pass, 5+ new tests.

## Done criteria

- [ ] `pnpm -F @sortey/api typecheck` exits 0
- [ ] `pnpm -F @sortey/api test` exits 0; `settlements.test.ts` exists with the 5 cases above
- [ ] `grep -n "from(lineItemClaims)" packages/api/src/router/settlements.ts | wc -l` prints `1`
- [ ] `grep -c "await ctx.db" packages/api/src/router/settlements.ts` shows no DB call inside the per-expense loop (the loop in `buildSettlementSummary` operates on in-memory Maps only)
- [ ] `pnpm check:fast` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at `settlements.ts:63-80` doesn't match the excerpt above (drift).
- The `summary` return shape can't be preserved exactly while extracting the
  seam (something consumes an internal field you'd have to change).
- `computeExpenseShares` / `computeNetBalances` signatures differ from how
  `settlements.ts:89-125` calls them today.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Any new settlement-affecting data source (e.g. per-item adjustments) must be
  added to `SettlementSummaryStore` and covered by a call-count test, or the
  N+1 returns.
- Reviewer should scrutinize case 1's expected amounts by hand — the test
  encodes the money contract.
- Deferred (tracked separately, do not do here): `record`'s idempotency-key
  lookup does not compare the retry payload; pins router N+1 (plan 003).
