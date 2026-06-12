# Plan 002: Make attachReceiptImage verify the expense belongs to the current trip

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat ba3457d..HEAD -- packages/api/src/router/expenses.ts packages/api/src/router/__tests__/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (adds a guard; valid callers unaffected)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `ba3457d`, 2026-06-12

## Why this matters

`expenses.attachReceiptImage` inserts a `receiptImages` row for any
`expenseId` the caller supplies, without checking that the expense belongs to
the trip the caller is authorized for. The `tripProcedure()` middleware only
verifies the caller is a member of the trip named in the input — it cannot
know the expense is from a *different* trip. So an authenticated member of
trip A can attach receipt-image records to expenses in trip B. The same bug
class was already fixed once in this repo for chat message deletion (commit
`8fe5f96`, "scope chat soft-delete to tripId (cross-trip authz)"), and every
neighboring expense mutation does this check — this one was just missed.

## Current state

Relevant files:

- `packages/api/src/router/expenses.ts` — the expenses router;
  `attachReceiptImage` is the last procedure in the file (lines 819–843).
- `packages/api/src/router/chat.ts` — the repo's store-seam testability
  convention (`export interface ChatStore` at line 24,
  `createChatStore(db: any)` at line 69, pure functions taking the store,
  thin router procedures wiring them at lines 231/267/283).
- `packages/api/src/router/__tests__/chat.test.ts` — test pattern exemplar
  (in-memory store object literal, lines 11–63).

The vulnerable code as it exists today, `expenses.ts:819-843`:

```ts
  attachReceiptImage: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        expenseId: z.string().min(1),
        storageKey: z.string().min(1),
        mimeType: z.string().min(1),
        sizeBytes: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = (await ctx.db
        .insert(receiptImages)
        .values({
          expenseId: input.expenseId,        // ← never verified against ctx.tripId
          storageKey: input.storageKey,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          uploadedByUserId: ctx.session.user.id,
        })
        .returning()) as Array<typeof receiptImages.$inferSelect>;

      return created;
    }),
```

The in-file pattern for the missing check, from `claimLineItem`
(`expenses.ts:655-684`): select the row joined/filtered by
`eq(expenses.tripId, ctx.tripId)`, and throw
`new TRPCError({ code: "NOT_FOUND", message: "..." })` when no row matches:

```ts
      const [item] = (await ctx.db
        .select({ ... })
        .from(lineItems)
        .innerJoin(expenses, eq(expenses.id, lineItems.expenseId))
        .where(
          and(
            eq(lineItems.id, input.lineItemId),
            eq(lineItems.expenseId, input.expenseId),
            eq(expenses.tripId, ctx.tripId),
          ),
        )
        .limit(1)) as Array<{ ... }>;

      if (!item) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Line item not found on this expense.",
        });
      }
```

Note: `NOT_FOUND` (not `FORBIDDEN`) is the established convention here — it
avoids confirming the existence of resources in other trips.

## Commands you will need

| Purpose   | Command                                  | Expected on success |
|-----------|------------------------------------------|---------------------|
| Install   | `pnpm install`                           | exit 0              |
| Typecheck | `pnpm -F @sortey/api typecheck`          | exit 0, no errors   |
| Tests     | `pnpm -F @sortey/api test`               | all pass            |
| Lint      | `pnpm -F @sortey/api lint`               | exit 0              |

## Scope

**In scope** (the only files you should modify/create):
- `packages/api/src/router/expenses.ts` (the `attachReceiptImage` procedure only)
- `packages/api/src/router/__tests__/expenses-attach-receipt.test.ts` (create)

**Out of scope** (do NOT touch, even though they look related):
- Every other procedure in `expenses.ts` — `claimLineItem`'s missing
  transaction and other findings are tracked separately.
- The upload route in `apps/nextjs` — the bytes-upload path is separate; this
  plan only fixes the metadata-record mutation.
- `packages/db` schema — no schema change is needed.

## Git workflow

- Branch off the current branch; name like `advisor/002-attach-receipt-authz`.
- Commit style: conventional commits, e.g.
  `fix(api): scope attachReceiptImage to tripId (cross-trip authz)` —
  mirroring the precedent commit message of `8fe5f96`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Extract a seam for the mutation, following the chat.ts pattern

In `expenses.ts`, near the other exports, add:

```ts
export interface ReceiptImageStore {
  findTripExpense(input: { expenseId: string; tripId: string }): Promise<{ id: string } | null>;
  insertReceiptImage(values: {
    expenseId: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    uploadedByUserId: string;
  }): Promise<typeof receiptImages.$inferSelect>;
}

export function createReceiptImageStore(db: any): ReceiptImageStore
```

`findTripExpense` selects `{ id: expenses.id }` from `expenses` where
`and(eq(expenses.id, expenseId), eq(expenses.tripId, tripId))` with
`.limit(1)`, returning `null` when absent. `insertReceiptImage` contains the
existing insert.

Add an exported pure function:

```ts
export async function attachReceiptImageToTrip(
  store: ReceiptImageStore,
  input: { expenseId: string; tripId: string; storageKey: string; mimeType: string; sizeBytes: number; userId: string },
)
```

which calls `findTripExpense` first, throws
`new TRPCError({ code: "NOT_FOUND", message: "Expense not found on this trip." })`
when it returns `null`, then inserts and returns the created row.

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0.

### Step 2: Wire the router procedure through the seam

Reduce the `attachReceiptImage` mutation body to:

```ts
      return attachReceiptImageToTrip(createReceiptImageStore(ctx.db), {
        expenseId: input.expenseId,
        tripId: ctx.tripId,
        storageKey: input.storageKey,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        userId: ctx.session.user.id,
      });
```

(Use `ctx.tripId` — the guard-resolved trip — never `input.tripId`.)

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0.

### Step 3: Add the tests

Create `packages/api/src/router/__tests__/expenses-attach-receipt.test.ts`
modeled on `chat.test.ts` (in-memory store object literal; include the
`process.env.DATABASE_URL ??=` preamble). Cases in the Test plan.

**Verify**: `pnpm -F @sortey/api test` → all pass including the new file.

## Test plan

In-memory `ReceiptImageStore` over a `state = { expenses: [...], receiptImages: [...] }`:

1. **Happy path**: expense exists in the given trip → row inserted with
   `uploadedByUserId` set to the calling user; returned row matches.
2. **Regression (the bug)**: expense exists but belongs to a *different*
   trip → rejects with `{ code: "NOT_FOUND" }` and `state.receiptImages`
   stays empty.
3. **Missing expense**: no such expense at all → `NOT_FOUND`, no insert.

Verification: `pnpm -F @sortey/api test` → all pass, 3 new tests.

## Done criteria

- [ ] `pnpm -F @sortey/api typecheck` exits 0
- [ ] `pnpm -F @sortey/api test` exits 0; the 3 cases above exist and pass
- [ ] In `expenses.ts`, the `attachReceiptImage` procedure no longer calls `ctx.db.insert` directly: `grep -A6 "attachReceiptImage: tripProcedure" packages/api/src/router/expenses.ts` shows no `.insert(`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `expenses.ts:819-843` doesn't match the excerpt above (drift).
- `ctx.tripId` is not available on the `tripProcedure()` context (it is used
  throughout the file today, e.g. line 669 — if that changed, stop).
- The fix appears to require touching the nextjs upload route.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Reviewers of future expense mutations should check every input id is
  re-anchored to `ctx.tripId` — this is the second instance of this bug class
  (after chat delete). A shared `findTripExpense` helper now exists; new
  mutations should reuse it.
- Deferred: an audit of the other routers (`pins`, `lodging`, `photos`,
  `fuel-logs`) for the same pattern was clean at audit time except this one
  instance, but new procedures should be reviewed against it.
