# Plan 015: Extract a store seam for settlements.record and unit-test the real money path

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2799b55..HEAD -- packages/api/src/router/settlements.ts`
> Compare against "Current state" before proceeding; on a mismatch, treat it
> as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (behavior-preserving refactor + new tests)
- **Depends on**: none (closes the test gap deferred by plan 008)
- **Category**: tests
- **Planned at**: commit `2799b55`, 2026-06-12

## Why this matters

`settlements.record` is the money-write path: it validates trip membership,
inserts a settlement with idempotency-key dedup, and (added in plan 008) throws
`CONFLICT` when a key is reused with a different payload. Plan 008 could not
test this path because `record` talks to `ctx.db` directly with no testable
seam, so the guard shipped untested. This plan extracts a store seam — exactly
the pattern already used by `summary` in the same file
(`createSettlementSummaryStore`) and by `chat.ts`/`expenses.ts` — and tests the
real validation + dedup + mismatch logic. No behavior change.

## Current state

`packages/api/src/router/settlements.ts`:

- The file already exports a seam for the *summary* path:
  `export function createSettlementSummaryStore(db: any): SettlementSummaryStore`
  (around line 67) and a pure `buildSettlementSummary(store, tripId)` (around
  line 140), wired by the `summary` procedure at lines 246–258. **Mirror this
  exact pattern.**
- The `record` procedure (lines 264–~340) currently inlines all DB access:

```ts
    .mutation(async ({ ctx, input }) => {
      // Validate both users are trip members
      const members = (await ctx.db
        .select({ userId: tripMembers.userId })
        .from(tripMembers)
        .where(eq(tripMembers.tripId, ctx.tripId))) as Array<{ userId: string }>;
      const memberIds = new Set(members.map((m) => m.userId));

      if (!memberIds.has(input.fromUserId)) { throw ... "From-user is not a member of this trip." }
      if (!memberIds.has(input.toUserId)) { throw ... "To-user is not a member of this trip." }
      if (input.fromUserId === input.toUserId) { throw ... "Cannot settle with yourself." }

      const [created] = (await ctx.db
        .insert(settlements)
        .values({ tripId: ctx.tripId, fromUserId, toUserId, amountCents, idempotencyKey, note })
        .onConflictDoNothing({ target: settlements.idempotencyKey })
        .returning()) as ...;

      if (!created) {
        const [existing] = (await ctx.db.select().from(settlements)
          .where(eq(settlements.idempotencyKey, input.idempotencyKey)).limit(1)) as ...;
        // Guard: same key but different payload
        if (existing!.amountCents !== input.amountCents ||
            existing!.fromUserId !== input.fromUserId ||
            existing!.toUserId !== input.toUserId) {
          throw new TRPCError({ code: "CONFLICT", message: "Idempotency key reused with a different settlement payload." });
        }
        return existing!;
      }
      return created;
    }),
```

(Read the live lines before editing — message strings must be preserved verbatim.)

The test exemplars: `packages/api/src/router/__tests__/settlements.test.ts`
(already exists, tests `buildSettlementSummary` via an in-memory store — follow
its structure and its `process.env.DATABASE_URL ??=` preamble).

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Install   | `pnpm install`                   | exit 0              |
| Typecheck | `pnpm -F @sortey/api typecheck`  | exit 0, no errors   |
| Tests     | `pnpm -F @sortey/api test`       | all pass            |
| Lint      | `pnpm -F @sortey/api lint`       | exit 0              |

## Scope

**In scope**:
- `packages/api/src/router/settlements.ts` (the `record` procedure + the new
  seam/pure-function exports)
- `packages/api/src/router/__tests__/settlements.test.ts` (add the new cases)

**Out of scope** (do NOT touch):
- `summary` / `buildSettlementSummary` / `createSettlementSummaryStore` — leave
  as-is; only mirror their pattern.
- The `undo` procedure and any other procedure in the file.
- The `settlements` DB schema or the idempotency unique constraint.
- The error message strings — they are the API contract; keep them verbatim.

## Git workflow

- Work on the current branch.
- Commit style: `test(api): seam + tests for settlements.record idempotency path`.
- Do NOT push or open a PR.

## Steps

### Step 1: Add the store seam + pure function

In `settlements.ts`, add (near `createSettlementSummaryStore`):

```ts
export interface SettlementRecordStore {
  findTripMemberIds(tripId: string): Promise<string[]>;
  insertIfAbsent(values: {
    tripId: string; fromUserId: string; toUserId: string;
    amountCents: number; idempotencyKey: string; note: string | null;
  }): Promise<typeof settlements.$inferSelect | null>; // null on idempotency conflict
  findByIdempotencyKey(key: string): Promise<typeof settlements.$inferSelect | null>;
}

export function createSettlementRecordStore(db: any): SettlementRecordStore
```

backed by the existing queries (member select; insert `.onConflictDoNothing`
`.returning()` → first row or null; select by idempotencyKey → first row or
null).

Add a pure function carrying ALL the current logic verbatim (same throws, same
messages, same order):

```ts
export async function recordSettlement(
  store: SettlementRecordStore,
  input: { tripId: string; fromUserId: string; toUserId: string;
    amountCents: number; idempotencyKey: string; note: string | null; },
): Promise<typeof settlements.$inferSelect>
```

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0.

### Step 2: Wire the procedure through the seam

Reduce the `record` mutation body to validate-via-seam then:
`return recordSettlement(createSettlementRecordStore(ctx.db), { tripId: ctx.tripId, ...input, note: input.note ?? null });`

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0;
`pnpm -F @sortey/api test` → still all pass (no behavior change).

### Step 3: Add tests

In `settlements.test.ts`, add a `describe("recordSettlement")` block using an
in-memory `SettlementRecordStore`. Cases:
1. Happy path: both members, distinct → inserts and returns the row.
2. `fromUserId` not a member → `BAD_REQUEST` "From-user is not a member of this trip."
3. `toUserId` not a member → `BAD_REQUEST` "To-user is not a member of this trip."
4. `fromUserId === toUserId` → `BAD_REQUEST` "Cannot settle with yourself."
5. Idempotent retry, identical payload (insert returns null, existing matches)
   → returns the existing row, no throw.
6. Idempotency key reused with different `amountCents` → `CONFLICT`.
7. Same, different `fromUserId`/`toUserId` → `CONFLICT`.

**Verify**: `pnpm -F @sortey/api test` → all pass including the new cases.

### Step 4: Full gate

**Verify**: `pnpm -F @sortey/api lint` → exit 0.

## Test plan

New `describe("recordSettlement")` in the existing `settlements.test.ts`, 7
cases above, in-memory store. The `summary` tests in the same file must still
pass unchanged. Verification: `pnpm -F @sortey/api test`.

## Done criteria

- [ ] `pnpm -F @sortey/api typecheck` exits 0
- [ ] `pnpm -F @sortey/api test` exits 0; the 7 `recordSettlement` cases exist and pass
- [ ] `grep -n "recordSettlement\|createSettlementRecordStore" packages/api/src/router/settlements.ts` shows the seam wired into the procedure
- [ ] The three `BAD_REQUEST` messages and the `CONFLICT` message are unchanged (`grep` finds each string)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `record` body differs from "Current state" (drift — esp. if plan 008's
  CONFLICT guard is absent, which would mean a bad merge).
- Wiring the seam forces a behavior or message change.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- This makes `record` testable the same way `summary` already is; future
  settlement-write changes should extend `recordSettlement` + its tests.
- Reviewer should confirm the pure function's throw order and messages match
  the pre-refactor procedure exactly.
