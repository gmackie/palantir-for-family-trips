# Plan 012: Batch N+1 and unbounded-scan queries in trips, pins, and planning routers

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` (add a row for the `hardening/` series if one doesn't
> exist yet) — unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**: `git diff --stat 0c1ffab..HEAD -- packages/api/src/router/trips.ts packages/api/src/router/pins.ts packages/api/src/router/planning.ts packages/api/src/router/__tests__/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW-MED (query shape changes on read paths; response shapes must stay byte-identical — `listWorkspaceTrips`'s ordering and `getTrip`'s cross-workspace-null behavior are the trickiest to preserve)
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `0c1ffab`, 2026-07-19

## Why this matters

Three routers issue O(n) queries in a loop (or, worse, unbounded full-table
scans) where a single batched query would do:

1. `trips.ts`'s `getTrip` and `listWorkspaceTrips` store methods each load
   **every trip row in the workspace** (no `tripId` predicate on `getTrip`,
   and a separate `.limit(Number.MAX_SAFE_INTEGER)` membership scan on
   `listWorkspaceTrips`) and then filter in JavaScript. On a workspace with
   many trips this is a full-table read on every trip-detail page load and
   every trip-list load — the two most common reads in the app.
2. `pins.ts`'s `list` and `listForTimeline` issue one extra query **per pin**
   (an attendee `count(*)` in `list`, a full attendee-id fetch in
   `listForTimeline`) despite `list` carrying a comment claiming the counts
   are already "Batch-load"ed. A trip with 50 pins does 51 queries instead
   of 2.
3. `planning.ts`'s `listPolls`, `getPollResults`, and `listProposals` each
   issue one extra query per poll / option / proposal to fetch vote or
   reaction counts.

The codebase already has the correct pattern in two places:
`packages/api/src/router/settlements.ts`'s `buildSettlementSummary` (batch
loads with `inArray`, then groups into `Map`s before the per-row loop) and
`packages/api/src/router/photos.ts`'s `list` (batches `photoReactions` for
all photo ids in one query, then a `Record` lookup per photo). This plan
copies that pattern into the six sites above; no schema change and no
response-shape change.

## Current state

**`packages/api/src/router/trips.ts`** (1951 lines):

- `listWorkspaceTrips` store method, lines 705-723: fetches ALL of the
  user's trip-membership rows across every workspace
  (`eq(tripMembers.userId, userId)`, `.limit(Number.MAX_SAFE_INTEGER)`, no
  workspace scoping in that query), then separately fetches ALL trips in the
  workspace, then does `rows.filter((trip) => visibleTripIds.has(trip.id))`
  in JS.
- `getTrip` store method, lines 725-733:
  ```ts
  getTrip: async ({ workspaceId, tripId }) => {
    const tripsInWorkspace = (await db
      .select(tripSummaryShape)
      .from(trips)
      .where(eq(trips.workspaceId, workspaceId))
      .limit(Number.MAX_SAFE_INTEGER)) as TripSummary[];

    return tripsInWorkspace.find((trip) => trip.id === tripId) ?? null;
  },
  ```
  No `tripId` predicate at all — every call loads every trip in the
  workspace to find one row.
- Callers: the `trips.get` procedure (lines 945-946) calls
  `createTripStore(ctx.db).getTrip({ workspaceId: ctx.workspaceId, tripId: ctx.tripId })`
  on every trip-detail page load. `updateTripRecord` (lines 345-397) calls
  `store.getTrip(...)` at line 372 — but only when `input.status !== undefined`
  (a status-changing update), to validate the transition.
- `tripSummaryShape` (lines 105-123) is an explicit column-map object (not
  `select()` with no args), so an `innerJoin` against `tripMembers` will not
  produce ambiguous column names.
- `TripStore` interface: lines 178-278. `listWorkspaceTrips` signature at
  212-215, `getTrip` at 216-219.

**`packages/api/src/router/pins.ts`** (422 lines):

- `list`, lines 37-74. The "Batch-load attendee counts" comment (line 54)
  is followed by a per-pin loop (lines 58-68) that runs one
  `select count(*) from pin_attendees where pin_id = ...` query per pin.
- `listForTimeline`, lines 396-421. Loop at 407-418 runs one
  `select user_id from pin_attendees where pin_id = ...` query per pin.

**`packages/api/src/router/planning.ts`** (570 lines):

- `listPolls`, lines 218-258. Loop at 227-255 runs one poll-options query
  (with a per-option `count(pollVotes.id)` via `leftJoin` + `groupBy`, itself
  fine) once per poll — the outer loop is the N+1, not the inner query.
- `getPollResults`, lines 268-305. Loop at 292-302 runs one
  `select * from poll_votes where poll_option_id = ...` query per option.
- `listProposals`, lines 475-513. Loop at 491-510 runs one
  `select reaction, count(*) from proposal_reactions where proposal_id = ...`
  query per proposal.

**The exemplar patterns to copy** (already in the codebase, do not
reinvent):

- `packages/api/src/router/settlements.ts` lines 149-198 (`buildSettlementSummary`):
  batch-load with `inArray(...)`, then build `Map<parentId, childRow[]>` via
  a single forward pass, then do the per-parent loop purely in memory.
- `packages/api/src/router/photos.ts` lines 141-190 (`list`): batch-load
  `photoReactions` for all `photoIds` in one query with `groupBy`, reduce
  into a `Record<string, Record<string, number>>`, then map.

Conventions: Drizzle operators (`and`, `eq`, `inArray`, `sql`, `asc`, `desc`)
imported from `@sortey/db`; `count(*)::int` cast pattern already used in
`pins.ts:61` and `planning.ts:237` (keep the `::int` cast — Postgres
`count()` returns `bigint`, which Drizzle would otherwise type as `string`);
conventional commits with scope.

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|---------------------------------------|---------------------|
| Typecheck | `pnpm -F @sortey/api typecheck`      | exit 0               |
| Lint      | `pnpm -F @sortey/api lint`           | exit 0               |
| Test      | `pnpm -F @sortey/api test`           | all pass             |
| Format    | `pnpm format:check` (fix with `pnpm format:fix`) | exit 0 |

## Scope

**In scope** (the only files you should modify/create):
- `packages/api/src/router/trips.ts`
- `packages/api/src/router/pins.ts`
- `packages/api/src/router/planning.ts`
- `packages/api/src/router/__tests__/trips.test.ts` (exists — extend, do not duplicate existing cases)
- `packages/api/src/router/__tests__/pins.test.ts` (does not exist yet — create)
- `packages/api/src/router/__tests__/planning.test.ts` (exists — extend, do not duplicate existing cases)

**Out of scope** (do NOT touch, even though they look related):
- `packages/api/src/router/settlements.ts`, `photos.ts` — reference patterns only, already correct.
- `packages/db/src/schema.ts` — no index changes here (see plan 015's deferred-investigate section for that).
- Any response shape / field names — clients (`apps/nextjs`, `apps/expo`) depend on them being identical. `listWorkspaceTrips`'s row ordering (`desc(trips.createdAt), asc(trips.id)`) and `getTrip`'s `null`-on-miss behavior must be preserved exactly.
- `TripStore`/`SettlementStore`-style interface extraction for `pins.ts` / `planning.ts` — those two routers query `ctx.db` inline today (like `photos.ts`); keep that structure, don't introduce a new store abstraction as part of this plan (scope creep). Only `trips.ts` already has a store interface (`TripStore`) — work within it.

## Git workflow

- Branch: `advisor/012-batch-n-plus-1-queries`
- Commits, one per file (so any one can be reverted independently):
  - `perf(api): scope trips.getTrip and listWorkspaceTrips to avoid full-table scans`
  - `perf(api): batch pin attendee counts and lists`
  - `perf(api): batch poll/proposal vote and reaction counts`
  - `test(api): regression coverage for batched trip/pin/planning queries`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Fix `trips.ts` `getTrip`

Change the `getTrip` store method (lines 725-733) to filter by both
`workspaceId` and `tripId` in SQL, with `.limit(1)`:

```ts
getTrip: async ({ workspaceId, tripId }) => {
  const [row] = (await db
    .select(tripSummaryShape)
    .from(trips)
    .where(and(eq(trips.workspaceId, workspaceId), eq(trips.id, tripId)))
    .limit(1)) as TripSummary[];

  return row ?? null;
},
```

`and` is already imported in this file (used elsewhere, e.g. `setShareToken`
at line 770) — confirm the import line still lists it after your edit.
Behavior must stay identical: returns `null` both when the trip doesn't
exist and when it exists but belongs to a different workspace (matches
today's `.find()` semantics, which only matched within the already
workspace-filtered `tripsInWorkspace` array).

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0

### Step 2: Fix `trips.ts` `listWorkspaceTrips`

Rewrite the store method (lines 705-723) as a single joined query instead of
two separate full scans + JS intersection:

```ts
listWorkspaceTrips: async ({ userId, workspaceId }) => {
  const rows = (await db
    .select(tripSummaryShape)
    .from(trips)
    .innerJoin(
      tripMembers,
      and(eq(tripMembers.tripId, trips.id), eq(tripMembers.userId, userId)),
    )
    .where(eq(trips.workspaceId, workspaceId))
    .orderBy(desc(trips.createdAt), asc(trips.id))) as TripSummary[];

  return rows;
},
```

Since `tripSummaryShape` explicitly selects only `trips.*` columns, the
join does not introduce column-name ambiguity or leak `tripMembers` columns
into the result. Preserve the exact ordering (`desc(trips.createdAt), asc(trips.id)`)
— it's a documented tie-break, don't drop the second key.

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0

### Step 3: Batch `pins.ts` `list` and `listForTimeline`

In `list` (lines 37-74), replace the per-pin count loop (lines 58-68) with
one batched query, following the `photos.ts` `list` groupBy pattern:

```ts
const pinIds = rows.map((r) => r.id);
const attendeeCounts = new Map<string, number>();

if (pinIds.length > 0) {
  const counts = (await ctx.db
    .select({
      pinId: pinAttendees.pinId,
      count: sql<number>`count(*)::int`,
    })
    .from(pinAttendees)
    .where(inArray(pinAttendees.pinId, pinIds))
    .groupBy(pinAttendees.pinId)) as Array<{ pinId: string; count: number }>;

  for (const row of counts) {
    attendeeCounts.set(row.pinId, row.count);
  }
}
```

Add `inArray` to the `@sortey/db` import at the top of the file (currently
`import { and, asc, eq, sql } from "@sortey/db";`).

In `listForTimeline` (lines 396-421), replace the per-pin attendee-list loop
(lines 407-418) with one batched `inArray` query, then group into a
`Map<string, string[]>` and map over `rows` — same shape as before
(`{ ...pin, attendees: string[] }` per pin), just built from the map instead
of an inner query.

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0

### Step 4: Batch `planning.ts` `listPolls`, `getPollResults`, `listProposals`

`listPolls` (lines 218-258): after loading `pollRows`, batch-load options
(with their vote counts) for ALL poll ids in one query instead of looping.
Options are per-poll (via `pollOptions.pollId`), so the query becomes:

```ts
const pollIds = pollRows.map((p) => p.id);
const allOptions =
  pollIds.length > 0
    ? ((await ctx.db
        .select({
          id: pollOptions.id,
          pollId: pollOptions.pollId,
          label: pollOptions.label,
          description: pollOptions.description,
          url: pollOptions.url,
          sortOrder: pollOptions.sortOrder,
          createdAt: pollOptions.createdAt,
          voteCount: sql<number>`count(${pollVotes.id})::int`,
        })
        .from(pollOptions)
        .leftJoin(pollVotes, eq(pollVotes.pollOptionId, pollOptions.id))
        .where(inArray(pollOptions.pollId, pollIds))
        .groupBy(pollOptions.id)
        .orderBy(asc(pollOptions.sortOrder))) as Array<{
        id: string;
        pollId: string;
        label: string;
        description: string | null;
        url: string | null;
        sortOrder: number;
        createdAt: Date;
        voteCount: number;
      }>)
    : [];

const optionsByPoll = new Map<string, typeof allOptions>();
for (const option of allOptions) {
  const existing = optionsByPoll.get(option.pollId) ?? [];
  existing.push(option);
  optionsByPoll.set(option.pollId, existing);
}

return pollRows.map((poll) => ({
  ...poll,
  options: optionsByPoll.get(poll.id) ?? [],
}));
```

Note the per-poll `orderBy(asc(pollOptions.sortOrder))` inside the loop
becomes a single global `orderBy` on the batched query — this preserves
per-poll ordering because `optionsByPoll` groups in the same relative order
the rows came back in (Postgres returns rows for a single `ORDER BY` in one
global order, and grouping-by-key on a stable pass preserves each group's
relative order). If you're not confident this holds under all planner
choices, add `pollId` as a leading sort key: `.orderBy(asc(pollOptions.pollId), asc(pollOptions.sortOrder))`
— it doesn't change grouping correctness either way but removes any doubt.

`getPollResults` (lines 268-305): after loading `options`, batch-load all
votes with `inArray(pollVotes.pollOptionId, options.map(o => o.id))` in one
query, group into a `Map<string, Vote[]>`, then map `options` to attach
`votes` from the map (preserving the existing per-option
`orderBy(asc(pollVotes.createdAt))` the same way as above — add
`pollOptionId` as a leading sort key if you want the stronger guarantee).

`listProposals` (lines 465-513): after loading `proposalRows`, batch-load
`proposalReactions` grouped by `(proposalId, reaction)` with
`inArray(proposalReactions.proposalId, proposalRows.map(p => p.id))` +
`.groupBy(proposalReactions.proposalId, proposalReactions.reaction)`, then
build `reactionCounts` per proposal from a `Map<string, Record<string, number>>`
instead of the per-proposal query.

Add `inArray` to the `@sortey/db` import at the top of `planning.ts`
(currently `import { and, asc, desc, eq, sql } from "@sortey/db";`).

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0

### Step 5: Regression tests

`trips.test.ts` and `planning.test.ts` already exist under
`packages/api/src/router/__tests__/` (plan 003,
`plans/003-router-test-baseline-money-paths.md`, MERGED, added some
coverage there) — read them first and extend with new `describe` blocks
rather than duplicating existing cases. `pins.test.ts` does not exist yet;
create it.

These three routers query `ctx.db` inline (no store interface for pins/planning;
`trips.ts` has `TripStore` but it's constructed from a raw `db`), so test at
the query-shape level like `tenant-scoping.test.ts` does — a stub `db` object
whose `.select().from()...` chain records call arguments — or, preferably,
if the repo has a real-Postgres test harness by now (check
`packages/api/src/router/__tests__/fuel-logs.test.ts` and neighbors for a
`DATABASE_URL` pattern), write against that instead; it exercises the actual
SQL. Cases per site:

1. `trips.getTrip`: existing trip in the given workspace → returned; trip
   exists but in a different workspace → `null`; trip id doesn't exist →
   `null`. Assert (via a stub or query-count instrumentation) that only one
   query with a `tripId` predicate runs — not a full-workspace scan.
2. `trips.listWorkspaceTrips`: returns only trips the user is a member of
   within the given workspace, ordered `createdAt desc, id asc`; a second
   workspace's trips are excluded even if the user is a member there too.
3. `pins.list` / `pins.listForTimeline`: N pins with varying attendee
   counts → correct per-pin counts/lists; zero pins → no attendee query
   issued (empty-array short-circuit); assert one attendee query total, not
   N.
4. `planning.listPolls` / `getPollResults` / `listProposals`: multiple
   polls/options/proposals with varying vote/reaction counts → correct
   per-parent aggregation, in the same relative order as before; assert one
   batched query per parent-count field, not N.

**Verify**: `pnpm -F @sortey/api test` → all pass, including the new/extended files

### Step 6: Full package check

**Verify**: `pnpm -F @sortey/api test` → all pass; `pnpm -F @sortey/api lint` → exit 0; `pnpm -F @sortey/api typecheck` → exit 0; `pnpm format:check` → exit 0 (run `pnpm format:fix` if not)

## Test plan

See Step 5. Pattern files: `packages/api/src/router/__tests__/settlements.test.ts`
(batched-query assertions already exist there for `buildSettlementSummary`
— "multiple finalized expenses: store methods called once each" is the
model assertion style to replicate against `inArray`/`groupBy` call counts
in these three routers), `packages/api/src/router/__tests__/tenant-scoping.test.ts`
(`makeDbStub` style for stubbing `ctx.db`).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm -F @sortey/api typecheck` exits 0
- [ ] `pnpm -F @sortey/api lint` exits 0
- [ ] `pnpm -F @sortey/api test` exits 0, including new/extended regression tests for all six sites
- [ ] `grep -n "limit(Number.MAX_SAFE_INTEGER)" packages/api/src/router/trips.ts` returns no matches
- [ ] `grep -n "tripsInWorkspace.find" packages/api/src/router/trips.ts` returns no matches
- [ ] `grep -n "for (const pin of rows)" packages/api/src/router/pins.ts` returns no matches (the per-pin attendee loops are gone; the `for (const pin of rows)` mapping in the final `return` is fine if it doesn't issue a query — reword the grep target if the final map also uses that phrasing, and instead assert via `grep -c "await ctx.db" packages/api/src/router/pins.ts` being lower than the pre-change baseline)
- [ ] `grep -c "await ctx.db" packages/api/src/router/planning.ts` is lower than the pre-change baseline (record the baseline count in your PR/commit description before editing)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` (or a new `plans/hardening/README.md` if the operator wants the series tracked separately) status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any excerpt above doesn't match the live code (line numbers may have
  drifted since `0c1ffab`).
- Preserving `listPolls`/`getPollResults`'s per-parent `ORDER BY` under a
  single batched query turns out NOT to guarantee stable per-group order in
  practice (verify with a manual multi-row test before trusting the
  "Postgres preserves relative order within groups" reasoning) — if it
  doesn't hold, add the explicit two-column `orderBy` described in Step 4
  rather than shipping non-deterministic option/vote ordering.
- The `trips.ts` `innerJoin` in `listWorkspaceTrips` returns duplicate rows
  for a trip (would indicate `tripMembers` has more than one row per
  `(tripId, userId)`, which the schema's unique constraint should prevent —
  if you see duplicates, that's a schema-level surprise, not a query bug to
  patch around).
- Any client (`apps/nextjs`, `apps/expo`) is found to depend on the specific
  query-count behavior (e.g. some test mocks `ctx.db.select` call counts
  directly) — report rather than breaking that test to make it pass.

## Maintenance notes

- These are all read-path optimizations; no schema or index changes ship
  here. If `EXPLAIN ANALYZE` on the batched `inArray` queries shows seq
  scans under real data volume, that's tracked as deferred work in plan
  015's "Deferred / investigate" section (missing `tripId`/`pinId` indexes).
- Reviewer focus: response shapes (field names, per-parent ordering,
  `null`-vs-`[]` semantics) must be byte-identical to before for all six
  procedures — `trips.get`, `trips.list`, `pins.list`, `pins.listForTimeline`,
  `planning.listPolls`, `planning.getPollResults`, `planning.listProposals`.
