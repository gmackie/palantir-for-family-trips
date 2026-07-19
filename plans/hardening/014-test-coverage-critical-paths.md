# Plan 014: Test coverage for untested high-stakes paths (auth guards, settlements, assignLineItem)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` (add a row for the `hardening/` series if one doesn't
> exist yet) — unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**: `git diff --stat 0c1ffab..HEAD -- packages/api/src/auth/guards.ts packages/api/src/router/settlements.ts packages/api/src/router/expenses.ts packages/api/src/router/__tests__/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. In particular, if plan 013
> (`plans/hardening/013-consolidate-authorization-helpers.md`) has already
> landed, `assignLineItem`'s organizer check will call `assertOrganizer` from
> `auth/guards.ts` instead of the inline check described below — the
> behavior under test is unchanged either way, just re-read the current
> source before writing assertions against exact line numbers.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: LOW (adding tests; the "small production refactors" called for
  in part (b) and (c) are the only risk surface — scoped tightly below)
- **Depends on**: none functionally, but avoid running concurrently with
  plan 013 on `packages/api/src/auth/guards.ts` and `expenses.ts` (both
  plans touch those files) — check plan 013's status first, and prefer
  sequencing this plan after it if both are queued
- **Category**: tests
- **Planned at**: commit `0c1ffab`, 2026-07-19

## Why this matters

Three pieces of code sit at the highest-consequence points in the app and
have zero real regression coverage:

1. `resolveWorkspaceAccess` and `resolveTripAccess` in
   `packages/api/src/auth/guards.ts` are the enforcement point for the
   ENTIRE tRPC middleware chain (`protectedProcedure → workspaceProcedure →
   tripProcedure`) — every single mutation and query in every router
   ultimately depends on these two functions correctly denying
   non-members and correctly scoping workspace/trip access. There is no
   test file for `auth/guards.ts` at all today.
2. `settlements.record` and `settlements.undo` — the mutations that
   actually move money between trip members — have no test coverage.
   `settlements.test.ts` exists but only covers the `summary` query
   (`buildSettlementSummary`, added by plan 001); `record`/`undo` stay
   fully inline in the router (`ctx.db` calls directly in the `.mutation()`
   body) with nothing testing idempotency dedup, membership validation,
   self-settle rejection, or the 24-hour undo boundary.
3. `expenses.test.ts` line 230's test for `assignLineItem` is a decoy: it
   defines a local `requireOrganizer` function inline and asserts against
   THAT function, never importing or calling the real
   `expenses.assignLineItem` mutation. The comment even says "mirrors
   expenses.ts lines 762-767" — an acknowledgment that it's a stand-in, not
   the real thing. The actual mutation (currently at expenses.ts:940-990ish)
   has real query logic (membership validation loop, a delete+insert
   transaction) that is completely unexercised.

## Current state

### (a) `packages/api/src/auth/guards.ts` — `resolveWorkspaceAccess` (lines 136-153) and `resolveTripAccess` (lines 155-173)

```ts
export async function resolveWorkspaceAccess(
  store: TripAccessStore,
  input: { userId: string; workspaceId: string },
): Promise<WorkspaceAccess> {
  const access = await store.findWorkspaceAccess(input);
  if (!access) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You do not belong to this workspace." });
  }
  return access;
}

export async function resolveTripAccess(
  store: TripAccessStore,
  input: { userId: string; workspaceId: string; tripId: string },
): Promise<TripAccess> {
  const access = await store.findTripAccess(input);
  if (!access) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You do not belong to this trip." });
  }
  return access;
}
```

Both already take a `TripAccessStore` interface (lines 26-36:
`findWorkspaceAccess`, `findTripAccess`) — the store-seam already exists,
no production refactor needed for part (a). `createTripAccessStore(db)`
(lines 62-134) is the Drizzle implementation; `findTripAccess` (81-132) does
three sequential lookups (workspace membership → trip-in-workspace →
trip-member role) and returns `null` at the first miss.
`workspaceProcedure`/`tripProcedure` (lines 175-228) wire these into the
tRPC middleware chain — those are the untested consumers, but testing the
two `resolve*` functions directly against a stub store covers the
authorization logic; testing the tRPC middleware wiring itself would need
an integration harness this repo doesn't have (out of scope, see below).

No test file exists: `find packages/api/src -iname '*guards*test*'` was
empty at plan time.

### (b) `packages/api/src/router/settlements.ts` — `record` (lines 277-342) and `undo` (lines 347-399)

```ts
record: tripProcedure()
  .input(/* fromUserId, toUserId, amountCents, idempotencyKey, note */)
  .mutation(async ({ ctx, input }) => {
    // validate both users are trip members (query all tripMembers, Set.has)
    // reject fromUserId === toUserId
    // insert with onConflictDoNothing({ target: settlements.idempotencyKey })
    // if no row returned (conflict), re-select by idempotencyKey and return that
  }),

undo: tripProcedure()
  .input(/* settlementId */)
  .mutation(async ({ ctx, input }) => {
    // select settlement scoped to (id, tripId); NOT_FOUND if missing
    // BAD_REQUEST if already undoneAt
    // BAD_REQUEST if now - settledAt > 24h
    // update: set undoneAt = now()
  }),
```

Both procedures query `ctx.db` inline — there is no `SettlementStore`
method for `record`/`undo` today (only `buildSettlementSummary`'s five
read methods exist on `SettlementStore`, lines 19-56). This means, unlike
part (a), testing these WILL require a small production refactor: extract
a store seam so the logic can run against an in-memory double, per the
repo's established convention (`fuel-logs.ts` + `fuel-logs.test.ts`, and
`settlements.ts`'s own existing `SettlementStore` for `summary`).

`settlements.test.ts` (see its `describe("buildSettlementSummary", ...)`
block) only imports and tests `buildSettlementSummary` — confirmed no
`record`/`undo` tests exist anywhere in that file.

### (c) `packages/api/src/router/expenses.ts` — `assignLineItem` (lines 940-990ish) and its decoy test

Real mutation, `expenses.ts:940-1002`:

```ts
assignLineItem: tripProcedure()
  .input(z.object({ workspaceId, tripId, expenseId, lineItemId, userIds: z.array(...).min(0).max(32) }))
  .mutation(async ({ ctx, input }) => {
    if (ctx.tripRole !== "organizer") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only organizers can reassign line items for others." });
    }
    // load tripMembers, build memberIds Set
    // for each input.userIds: if not in memberIds, throw BAD_REQUEST
    // transaction: delete existing lineItemClaims for lineItemId, then insert new claims for userIds
    // triggerEvent(`private-expense-${input.expenseId}`, "line-item:assigned", { lineItemId, userIds })
    // return { assigned: input.userIds.length }
  }),
```

Confirmed: `input.expenseId` (line 993) is used ONLY to build the realtime
Pusher channel name (`private-expense-${input.expenseId}`) — it is never
validated against `input.lineItemId` or `ctx.tripId`. This mutation does
NOT verify `input.lineItemId` belongs to `input.expenseId`, nor that either
belongs to `ctx.tripId` (the membership check only validates the target
`userIds` are trip members, not that the line item itself is in-trip). This
is a real, confirmed finding — a missing scope check, same class as plan
002's tenant-scoping fixes (an organizer of trip A could reassign claims on
a `lineItemId` belonging to trip B if they can guess/obtain its UUID). Note
it in your report but do NOT fix it as part of this plan (out of scope;
flag it as a new backlog item in `plans/README.md` instead, since fixing it
changes production behavior beyond "add tests" — and ideally write a test
in Step 5 that documents the current (unsafe) behavior with a comment
pointing at the backlog item, so the gap is pinned rather than silently
inherited).

The decoy test, `packages/api/src/router/__tests__/expenses.test.ts` lines
230-243:

```ts
it("assignLineItem is organizer-only (stricter guard than requireOrganizerOrSelf)", () => {
  // assignLineItem uses requireOrganizer (not requireOrganizerOrSelf)
  // mirrors expenses.ts lines 762-767
  function requireOrganizer(tripRole: TripRole): void {
    if (tripRole !== "organizer") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only organizers can reassign line items for others." });
    }
  }
  expect(() => requireOrganizer("member")).toThrow(TRPCError);
  expect(() => requireOrganizer("organizer")).not.toThrow();
});
```

This tests a function it just defined inline, three lines above the
assertion. It provides zero coverage of `expenses.ts`'s real
`assignLineItem` — the membership-validation loop and the
delete+insert-claims transaction are completely unexercised. Like `record`/
`undo`, `assignLineItem` is inline in the router with no store seam, so a
small extraction is needed here too.

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|---------------------------------------|---------------------|
| Typecheck | `pnpm -F @sortey/api typecheck`      | exit 0               |
| Lint      | `pnpm -F @sortey/api lint`           | exit 0               |
| Test      | `pnpm -F @sortey/api test`           | all pass             |
| Auth typecheck | `pnpm -F @sortey/auth typecheck` | exit 0 (guards.ts imports nothing from `@sortey/auth`, but this is the mandated cross-check per the operator's verification list — run it to confirm no accidental coupling was introduced) |
| Format    | `pnpm format:check` (fix with `pnpm format:fix`) | exit 0 |

## Scope

**In scope** (the only files you should modify/create):
- `packages/api/src/router/__tests__/guards.test.ts` (create — or, if plan
  013 already created it for `assertOrganizer`/`assertOrganizerOrOwner`
  tests, extend it with the `resolveWorkspaceAccess`/`resolveTripAccess`
  cases instead of creating a second file)
- `packages/api/src/router/settlements.ts` (extract a store seam for
  `record`/`undo`, following the existing `SettlementStore` pattern in the
  same file)
- `packages/api/src/router/__tests__/settlements.test.ts` (extend with
  `record`/`undo` coverage)
- `packages/api/src/router/expenses.ts` (extract a store seam for
  `assignLineItem` only — do not touch any other procedure in this 1094-line
  file)
- `packages/api/src/router/__tests__/expenses.test.ts` (replace the decoy
  test at lines 230-243 with a real test against the extracted
  `assignLineItem` logic; keep the surrounding `describe` blocks and other
  tests untouched)

**Out of scope** (do NOT touch, even though they look related):
- `packages/api/src/auth/guards.ts`'s `workspaceProcedure`/`tripProcedure`
  middleware functions themselves (lines 175-228) — testing the tRPC
  middleware wiring end-to-end needs an integration harness (a real tRPC
  caller + test DB) this repo doesn't currently have; that's a larger,
  separate effort (see Maintenance notes). This plan tests the
  `resolve*` functions they call, which is where the actual authorization
  decision is made.
- Fixing the `assignLineItem` missing expense-scope check noted in part (c)
  — report it, do not fix it (a behavior change belongs in its own plan
  with its own review).
- Any other `expenses.ts` or `settlements.ts` procedure not named above.
- Response shapes / zod input schemas for `record`, `undo`, `assignLineItem`.
- `packages/api/src/expenses/settle.ts`, `shares.ts` — already tested (per
  plan 001), do not modify.

## Git workflow

- Branch: `advisor/014-test-coverage-critical-paths`
- Commits:
  - `test(api): coverage for resolveWorkspaceAccess/resolveTripAccess`
  - `refactor(api): extract SettlementStore methods for record/undo`
  - `test(api): idempotency/membership/undo-boundary coverage for settlements`
  - `refactor(api): extract store seam for assignLineItem`
  - `test(api): replace assignLineItem decoy test with real coverage`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: `auth/guards.ts` coverage (no production change needed)

Create (or extend, per Scope above) `guards.test.ts`. Build a stub
`TripAccessStore` (object literal implementing `findWorkspaceAccess` and
`findTripAccess`, following the `makeDbStub`-style already used in
`tenant-scoping.test.ts`, but here the interface is the store itself, so a
plain object with two `vi.fn()` or manually-tracked-call mocks is enough —
no need for a `.select().from().where()` chain stub since
`TripAccessStore` is already the seam). Cases:

1. `resolveWorkspaceAccess`: store returns access → resolves with it
   unchanged; store returns `null` → throws `TRPCError` with code
   `FORBIDDEN` and message `"You do not belong to this workspace."`.
2. `resolveTripAccess`: store returns access → resolves with it unchanged;
   store returns `null` (covers all three of `createTripAccessStore`'s
   internal miss points — not-a-workspace-member, trip-not-in-workspace,
   not-a-trip-member — but from `resolveTripAccess`'s point of view they're
   indistinguishable, since the store already collapsed them to `null`; add
   a comment noting the store's own miss-point differentiation is tested
   separately if you also test `createTripAccessStore`, which is optional
   extra coverage, not required) → throws `TRPCError` `FORBIDDEN`
   `"You do not belong to this trip."`.
3. Scoping: call `resolveTripAccess` with a stub whose `findTripAccess`
   records its call args, assert it was called with exactly
   `{ userId, workspaceId, tripId }` as passed in — this pins the
   contract that trip access always checks workspace membership first, not
   just trip membership in isolation (guards against a future regression
   where trip-only checks bypass the workspace layer).

**Verify**: `pnpm -F @sortey/api test` → new tests pass (run just this file: `pnpm -F @sortey/api exec vitest run src/router/__tests__/guards.test.ts`)

### Step 2: Extract a store seam for `settlements.record`/`undo`

In `packages/api/src/router/settlements.ts`, extend the existing
`SettlementStore` interface (lines 19-56) with methods for `record` and
`undo`, following the same style as the five `summary` methods already
there:

```ts
export interface SettlementStore {
  // ...existing 5 methods...
  insertSettlement(input: {
    tripId: string;
    fromUserId: string;
    toUserId: string;
    amountCents: number;
    idempotencyKey: string;
    note: string | null;
  }): Promise<{ id: string; /* ...full settlement row fields the procedure returns... */ } | null>; // null = onConflictDoNothing hit
  findSettlementByIdempotencyKey(idempotencyKey: string): Promise<SettlementRow | null>;
  findSettlement(input: { settlementId: string; tripId: string }): Promise<SettlementRow | null>;
  undoSettlement(settlementId: string): Promise<SettlementRow | null>;
}
```

(Match field names/types to whatever `typeof settlements.$inferSelect`
actually is — read the schema before finalizing the interface; don't guess
column names.) Add the corresponding methods to
`createSettlementStore(db)` (lines 60-145), implemented with the exact same
Drizzle calls currently inline in the router (move the code, don't rewrite
its logic). Add two domain functions, `recordSettlement(store, input)` and
`undoSettlement(store, input)`, containing the membership-validation /
self-settle-rejection / idempotency-dedup logic (for `record`) and the
not-found / already-undone / 24h-boundary logic (for `undo`) — same
extraction shape as `buildSettlementSummary`. Change the `record` and
`undo` procedures (lines 277-342, 347-399) to call
`recordSettlement(createSettlementStore(ctx.db), {...})` /
`undoSettlement(createSettlementStore(ctx.db), {...})`, mirroring how
`summary` already calls `buildSettlementSummary`.

The membership-validation query (`listTripMembers`-shaped) inside `record`
already exists on `SettlementStore` as `listTripMembers` — reuse it instead
of adding a duplicate method.

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0

### Step 3: `settlements.test.ts` — `record`/`undo` coverage

Extend `settlements.test.ts` (same file, new `describe` blocks) with an
in-memory `SettlementStore` double (plain arrays + the new methods
implemented over them, `randomUUID()` ids — same convention as the
existing `buildSettlementSummary` tests in this file). Cases:

`recordSettlement`:
1. Both users are trip members, different users → settlement recorded,
   returned row matches input.
2. `fromUserId` not a trip member → `BAD_REQUEST` "From-user is not a
   member of this trip."
3. `toUserId` not a trip member → `BAD_REQUEST` "To-user is not a member of
   this trip."
4. `fromUserId === toUserId` → `BAD_REQUEST` "Cannot settle with yourself."
5. Idempotency: same `idempotencyKey` submitted twice → second call returns
   the FIRST call's row (not a new one), and the store's insert path
   reflects `onConflictDoNothing` semantics — assert the double is called
   in a way that proves dedup (e.g. count of records with that key stays 1).

`undoSettlement`:
6. Existing, not-undone, settled < 24h ago → `undoneAt` set, returns updated
   row.
7. Settlement id not found (or found but wrong trip) → `NOT_FOUND`
   "Settlement not found."
8. Already undone (`undoneAt` already set) → `BAD_REQUEST` "Settlement is
   already undone."
9. Settled > 24h ago → `BAD_REQUEST` "Cannot undo a settlement older than 24
   hours." (use a fixed/mocked clock or a settledAt far enough in the past
   that the boundary isn't flaky — do NOT write a test that's timing-
   sensitive to actual wall-clock execution speed).
10. Double-undo: call `undoSettlement` twice on the same settlement → second
    call hits case 8, not a silent no-op.

**Verify**: `pnpm -F @sortey/api exec vitest run src/router/__tests__/settlements.test.ts` → all pass (≥10 new/total record+undo cases)

### Step 4: Extract a store seam for `assignLineItem`

In `packages/api/src/router/expenses.ts`, this router does not currently
have a store-interface pattern at all (unlike `settlements.ts`,
`fuel-logs.ts`, `rooms.ts`). Rather than introducing a full router-wide
store (large, out of scope), extract JUST `assignLineItem`'s logic into a
small local interface + domain function, scoped narrowly:

```ts
export interface LineItemAssignmentStore {
  listTripMemberIds(tripId: string): Promise<string[]>;
  replaceLineItemClaims(input: { lineItemId: string; userIds: string[] }): Promise<void>;
}

export function createLineItemAssignmentStore(db: any): LineItemAssignmentStore {
  return {
    async listTripMemberIds(tripId) {
      const rows = (await db.select({ userId: tripMembers.userId }).from(tripMembers).where(eq(tripMembers.tripId, tripId))) as Array<{ userId: string }>;
      return rows.map((r) => r.userId);
    },
    async replaceLineItemClaims({ lineItemId, userIds }) {
      // biome-ignore lint/suspicious/noExplicitAny: Drizzle tx type is complex
      await db.transaction(async (tx: any) => {
        await tx.delete(lineItemClaims).where(eq(lineItemClaims.lineItemId, lineItemId));
        if (userIds.length > 0) {
          await tx.insert(lineItemClaims).values(userIds.map((userId) => ({ lineItemId, userId })));
        }
      });
    },
  };
}

export async function assignLineItemToUsers(
  store: LineItemAssignmentStore,
  input: { tripRole: "organizer" | "member"; tripId: string; lineItemId: string; userIds: string[] },
): Promise<{ assigned: number }> {
  if (input.tripRole !== "organizer") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only organizers can reassign line items for others." });
  }
  const memberIds = new Set(await store.listTripMemberIds(input.tripId));
  for (const userId of input.userIds) {
    if (!memberIds.has(userId)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `User ${userId} is not a member of this trip.` });
    }
  }
  await store.replaceLineItemClaims({ lineItemId: input.lineItemId, userIds: input.userIds });
  return { assigned: input.userIds.length };
}
```

The real procedure's return value is confirmed as `{ assigned: input.userIds.length }`
(line 1001) — match that exactly, not the placeholder shape above. The
procedure also fires `triggerEvent(...)` (lines 992-999, realtime Pusher
notification) AFTER the store mutation and BEFORE the return — keep that
call in the router procedure itself (it's an I/O side effect tied to
`ctx.db`'s realtime wiring, not part of the testable domain logic; don't
pull it into `assignLineItemToUsers`, follow the same "router does I/O
side-effects, domain function does the decision logic" split
`createPoll`/`createProposal` already use for `sendPushToTripMembers` in
`planning.ts`). Change the `assignLineItem` procedure to call
`assignLineItemToUsers(createLineItemAssignmentStore(ctx.db), { tripRole: ctx.tripRole, tripId: ctx.tripId, lineItemId: input.lineItemId, userIds: input.userIds })`,
then fire `triggerEvent` with its result, then return the result.
If plan 013 has already landed and replaced the inline organizer check with
`assertOrganizer(ctx.tripRole, ...)`, call that from inside
`assignLineItemToUsers` instead of reimplementing the `if` — import it from
`../auth/guards`.

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0

### Step 5: Replace the decoy `assignLineItem` test

In `expenses.test.ts`, delete the decoy test (lines 230-243) and its
inline `requireOrganizer` redefinition. Add real tests against
`assignLineItemToUsers` with an in-memory `LineItemAssignmentStore` double
(plain array for claims, plain array for member ids):

1. Organizer, all `userIds` are trip members → claims replaced (old claims
   for that `lineItemId` gone, new ones present), returns expected shape.
2. Non-organizer → `FORBIDDEN` "Only organizers can reassign line items for
   others." (same message, now against the real code path).
3. One `userId` not a trip member → `BAD_REQUEST` with the specific
   "User {id} is not a member of this trip." message; assert
   `replaceLineItemClaims` was NOT called (validation happens before the
   mutation, so a bad request must not have side effects — this pins that
   ordering).
4. Empty `userIds` array (valid per the `.min(0)` schema) → claims cleared,
   nothing inserted.
5. Idempotent-ish behavior: calling twice with the same `userIds` produces
   the same end state (delete-then-insert is naturally idempotent; assert
   the store ends up with exactly one claim per user, not duplicates).

Keep the `describe("expenses router — role guards (requireOrganizerOrSelf)", ...)`
block (lines 208-229, the `requireOrganizerOrSelf` decoy noted in plan 013)
untouched — that's plan 013's concern if it exists, not this plan's; only
the `assignLineItem`-specific test (230-243) is this plan's target.

**Verify**: `pnpm -F @sortey/api exec vitest run src/router/__tests__/expenses.test.ts` → all pass

### Step 6: Full package check

**Verify**: `pnpm -F @sortey/api test` → all pass; `pnpm -F @sortey/api lint` → exit 0; `pnpm -F @sortey/api typecheck` → exit 0; `pnpm -F @sortey/auth typecheck` → exit 0; `pnpm format:check` → exit 0 (run `pnpm format:fix` if not)

## Test plan

See Steps 1, 3, 5. Pattern files: `packages/api/src/router/__tests__/fuel-logs.test.ts`
(store-seam extraction + in-memory double convention),
`packages/api/src/router/__tests__/tenant-scoping.test.ts` (`makeDbStub`
style for the parts that stay `db`-shaped), `packages/api/src/router/__tests__/settlements.test.ts`
(existing `buildSettlementSummary` tests, extend in place).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm -F @sortey/api typecheck` exits 0
- [ ] `pnpm -F @sortey/api lint` exits 0
- [ ] `pnpm -F @sortey/api test` exits 0
- [ ] `pnpm -F @sortey/auth typecheck` exits 0
- [ ] `guards.test.ts` exists with passing tests for both
      `resolveWorkspaceAccess` and `resolveTripAccess` (allow + deny +
      scoping cases, ≥5 tests total)
- [ ] `settlements.test.ts` has passing tests for `record`/`undo` covering
      idempotency dedup, both membership-validation branches, self-settle
      rejection, the 24h undo boundary, and double-undo (≥10 new tests)
- [ ] `grep -n "function requireOrganizer" packages/api/src/router/__tests__/expenses.test.ts` returns no matches (the decoy's inline redefinition is gone)
- [ ] `expenses.test.ts` has a test that imports and calls the real
      `assignLineItemToUsers` (or equivalent exported symbol) — not a
      locally-redefined stand-in
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated, including a note (in the row or
      a new backlog line) about the `assignLineItem` missing
      expense-scope-check finding from part (c), flagged but not fixed

## STOP conditions

Stop and report back (do not improvise) if:

- Any excerpt above doesn't match the live code (this plan explicitly
  flags `assignLineItem`'s exact end-line and return shape as
  unconfirmed at plan time — re-read before implementing Step 4/5, don't
  guess).
- The `SettlementStore` extension for `record`/`undo` would require
  changing `record`'s or `undo`'s response shape (e.g. if the real
  `onConflictDoNothing` re-select path returns different fields than a
  plain insert) — report the discrepancy instead of quietly normalizing it.
- `assignLineItem`'s `input.expenseId` turns out to already be used
  somewhere in a scope check you missed on first read — re-verify before
  reporting the missing-scope-check finding, and drop that finding from
  your report if it's wrong.
- Any test that passed at baseline fails after the extraction and the
  cause isn't an obvious pre-existing flake — the store-seam extractions in
  Steps 2 and 4 must be behavior-preserving refactors, not rewrites.

## Maintenance notes

- The `assignLineItem` missing expense-scope check (part (c)) should become
  its own follow-up plan if confirmed — same class of bug as plan 002's
  IDOR fixes (a mutation trusts a bare id without verifying it belongs to
  the authorized trip/expense), but that plan is closed and its scope
  (itinerary/lodging/photos) didn't cover `expenses.ts`.
- A real integration test harness (tRPC caller + test Postgres) would let
  `workspaceProcedure`/`tripProcedure` themselves be tested end-to-end
  instead of just the `resolve*` functions they call — noted as out of
  scope here because it's a test-infrastructure investment, not a
  same-shape addition to an existing pattern. `plans/README.md`'s backlog
  already flags "No DB-backed integration tests" as a known gap; this plan
  doesn't close that gap, it works within the existing in-memory-double
  convention.
- Reviewer focus: the two store-seam extractions (Steps 2 and 4) must not
  change `record`, `undo`, or `assignLineItem`'s response shapes — the
  Next.js settle page, Expo settle screen, and expense-detail claim UI are
  the consumers.
