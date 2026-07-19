# Plan 003: Extend RLS policy coverage to the remaining trip-scoped tables

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. This plan has HIGH risk (FORCE RLS denies all
> rows on a table if the session GUCs aren't set) — read the whole plan,
> including Maintenance notes, before writing code. When done, update the
> status row for this plan in `plans/hardening/README.md` (create it with a
> one-row table if it doesn't exist yet) — unless a reviewer dispatched you
> and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 0c1ffab..HEAD -- packages/db/src/rls.ts packages/db/src/tenant.ts packages/db/src/schema.ts packages/db/src/__tests__/rls.test.ts packages/db/drizzle/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: none (independent of `plans/hardening/002-reanchor-trip-child-writes.md`, which is app-layer; can run in parallel, but do not merge both at the same instant without re-running each other's test suites — see STOP conditions)
- **Category**: security
- **Planned at**: commit `0c1ffab`, 2026-07-19

## Why this matters

`packages/db/src/rls.ts` defines three target lists —
`workspaceRlsTargets`, `tripChildRlsTargets`, `expenseChildRlsTargets` — and
`buildWorkspaceRlsStatements()` turns them into `ENABLE ROW LEVEL SECURITY`
+ `FORCE ROW LEVEL SECURITY` + per-table policies, shipped as
`packages/db/drizzle/0012_trip_workspace_rls.sql` (a checked-in migration,
in the `drizzle-kit migrate` journal at
`packages/db/drizzle/meta/_journal.json`, idx 12). Every table *not* in one
of those three arrays has **no RLS at all** — it's readable/writable by any
authenticated DB role with no policy check whatsoever, relying entirely on
the app layer (`tripProcedure`/`workspaceProcedure` in
`packages/api/src/auth/guards.ts`) for tenant isolation.

Cross-checking every `pgTable(...)` definition in `packages/db/src/schema.ts`
against the three RLS target arrays (verified against `0c1ffab`) turns up
**18 tables** that carry a `tripId`/`segmentId`/parent-row FK chain back to
a trip or workspace but have zero RLS coverage. This is a materially larger
list than "settlement, pin, pin_attendee, lodging, room_assignment, poll,
poll_option, proposal, trip_photo, member_transit, ground_transport_group,
itinerary_event, van_profile" (the 13-table starting list) for two reasons:

1. **`van_profile` is not trip-scoped** — it carries `workspaceId` directly
   (`packages/db/src/schema.ts:1371-1399`), not `tripId`/`segmentId`. It
   belongs in `workspaceRlsTargets` (like `trip` itself), not
   `tripChildRlsTargets`. Treating it as a 2-hop trip-child table (as the
   original framing suggested) would be wrong — a workspace-direct table
   needs the workspace predicate, not a trip-join predicate.
2. **Five more child-of-child tables share the identical gap** and were not
   in the original list: `photo_reaction` (child of `trip_photo`),
   `poll_vote` (child of `poll_option`, i.e. grandchild of `poll`),
   `proposal_reaction` (child of `proposal`), `lodging_guest` and
   `room_occupant`/`ground_transport_member` (children of `lodging` /
   `room_assignment` / `ground_transport_group`). Leaving these out would
   defeat the purpose of an RLS-coverage pass — they're the exact same bug
   class, one hop further from the trip.

The existing regression suite (`packages/db/src/__tests__/rls.test.ts`)
only asserts that `buildWorkspaceRlsStatements()` returns strings
*containing* certain substrings (e.g. `create policy
"segment_member_workspace_select"`). It never applies the policies to a
real Postgres and checks that a cross-tenant `SELECT` actually returns zero
rows. That means a logic bug in the SQL string templates (a missing `and`,
a wrong join column) would pass every existing test while leaving the table
wide open. This plan also adds one real, Postgres-backed integration test
that would have caught that class of bug.

## Current state

**`packages/db/src/rls.ts:17-64`** — the three target arrays as they exist
today:

```ts
export const workspaceRlsTargets = [
  { tableName: "workspace", workspaceColumn: "id" },
  { tableName: "workspace_membership", workspaceColumn: "workspace_id" },
  { tableName: "workspace_invite_allowlist", workspaceColumn: "workspace_id" },
  { tableName: "workspace_subscription", workspaceColumn: "workspace_id" },
  { tableName: "workspace_usage_rollup", workspaceColumn: "workspace_id" },
  { tableName: "trip", workspaceColumn: "workspace_id" },
] as const;

export const tripChildRlsTargets = [
  { tableName: "trip_segment", tripColumn: "trip_id" },
  { tableName: "trip_member", tripColumn: "trip_id" },
  { tableName: "trip_member_state", tripColumn: "trip_id" },
  { tableName: "trip_invite", tripColumn: "trip_id" },
  { tableName: "segment_member", parentTable: "trip_segment" },
  { tableName: "expense", tripColumn: "trip_id" },
  { tableName: "journey_stop", tripColumn: "trip_id" },
  { tableName: "trip_message", tripColumn: "trip_id" },
  { tableName: "ferry_crossing", tripColumn: "trip_id" },
  { tableName: "fuel_log", tripColumn: "trip_id" },
  { tableName: "gps_track_point", tripColumn: "trip_id" },
  { tableName: "trip_share", tripColumn: "trip_id" },
  { tableName: "trip_anchor", tripColumn: "trip_id" },
  { tableName: "trip_day", tripColumn: "trip_id" },
  { tableName: "van_state_reading", tripColumn: "trip_id" },
  { tableName: "member_location", tripColumn: "trip_id" },
] as const;

export const expenseChildRlsTargets = [
  { tableName: "receipt_image", expenseColumn: "expense_id" },
  { tableName: "line_item", expenseColumn: "expense_id" },
  { tableName: "line_item_claim", parentTable: "line_item" },
] as const;
```

`buildTripChildReadPredicate`/`buildTripChildMutationPredicate` (66-128)
hardcode exactly one `parentTable` special case, `"trip_segment"` — the
predicate joins `"<tableName>"."segment_id"` → `trip_segment` → `trip` →
`workspace_membership`. `buildExpenseChildReadPredicate`/
`buildExpenseChildMutationPredicate` (170-236) hardcode exactly one
different special case, `"line_item"` — `"<tableName>"."line_item_id"` →
`line_item` → `expense` → `trip` → `workspace_membership`. Neither is a
general N-hop join builder; they're single-purpose `if` branches.

**Full audit of `packages/db/src/schema.ts` `pgTable(...)` calls against the
three arrays above** (every table with a tenant-relevant FK; tables like
`Post`, `userPreferences`, `apiKeys`, `waitlistEntry`, `billingPlan`,
`importedPois`, `poiCache` are user-scoped/global-cache/global-catalog and
correctly have no RLS — not part of this plan):

| Table (schema.ts line) | FK shape | Covered today? | Hop pattern needed |
|---|---|---|---|
| `settlement` (576) | `tripId` direct | **No** | 1-hop, same shape as `expense` |
| `trip_photo` (608) | `tripId` direct (+ nullable `segmentId`) | **No** | 1-hop |
| `photo_reaction` (641) | `photoId` → `trip_photo` | **No** | 2-hop, new parent type |
| `itinerary_event` (680) | `tripId` direct (+ nullable `segmentId`) | **No** | 1-hop |
| `poll` (752) | `tripId` direct | **No** | 1-hop |
| `poll_option` (772) | `pollId` → `poll` | **No** | 2-hop, new parent type |
| `poll_vote` (785) | `pollOptionId` → `poll_option` → `poll` | **No** | 3-hop |
| `proposal` (813) | `tripId` direct (+ nullable `segmentId`) | **No** | 1-hop |
| `proposal_reaction` (842) | `proposalId` → `proposal` | **No** | 2-hop, new parent type |
| `pin` (894) | `tripId` direct | **No** | 1-hop |
| `pin_attendee` (925) | `pinId` → `pin` | **No** | 2-hop, new parent type |
| `lodging` (964) | `segmentId` only, no `tripId` | **No** | 2-hop, reuses existing `trip_segment` parent type as-is |
| `lodging_guest` (995) | `lodgingId` → `lodging` (→ segment) | **No** | 3-hop |
| `room_assignment` (1017) | `lodgingId` → `lodging` (→ segment) | **No** | 3-hop |
| `room_occupant` (1028) | `roomAssignmentId` → `room_assignment` (→ lodging → segment) | **No** | 4-hop |
| `member_transit` (1071) | `segmentId` only | **No** | 2-hop, reuses existing `trip_segment` parent type as-is |
| `ground_transport_group` (1155) | `segmentId` only | **No** | 2-hop, reuses existing `trip_segment` parent type as-is |
| `ground_transport_member` (1176) | `groundTransportGroupId` → `ground_transport_group` (→ segment) | **No** | 3-hop |
| `van_profile` (1371) | `workspaceId` direct — **not trip-scoped** | **No** | belongs in `workspaceRlsTargets`, not a trip-child pattern |

`ferry_crossing` (1105) is already covered (`tripColumn: "trip_id"` in
`tripChildRlsTargets`) — it was in the schema next to the uncovered ones
but is fine as-is; do not re-add it.

**`packages/db/src/__tests__/rls.test.ts`** (189 lines) exercises
`buildWorkspaceRlsStatements()` purely as a string generator — every
assertion is `.toEqual()` on the target arrays or `.toContain()`/`.toMatch()`
on generated SQL text. There is no test anywhere in the repo that applies
these policies to a live Postgres and checks actual row visibility.
`packages/db/vitest.config.ts` has no DB-gated project split, and
`packages/db/package.json` has a plain `DATABASE_URL`-driven `migrate`/`rls`
script pair (`pnpm -F @sortey/db migrate`, `pnpm -F @sortey/db rls`) but no
`TEST_DATABASE_URL` convention. `docker-compose.yml` at the repo root runs
`postgres:16-alpine` on `localhost:5432` with `postgres`/`postgres`/
`gmacko_dev` — that's the available local Postgres for an integration test;
there is no CI-wired ephemeral Postgres already set up for this repo as far
as this plan's audit found, so the new integration test must be written to
**skip cleanly** when no reachable `DATABASE_URL` is present, not fail the
build.

## Design

### 1. One-hop direct-`trip_id` tables → extend `tripChildRlsTargets` as-is

`settlement`, `trip_photo`, `itinerary_event`, `poll`, `proposal`, `pin` all
carry `tripId` directly. Add six entries of the existing shape
`{ tableName: "...", tripColumn: "trip_id" }` — zero predicate-builder code
changes needed.

### 2. Segment-linked tables with no direct `trip_id` → extend `tripChildRlsTargets` reusing the existing `"trip_segment"` parent branch

`lodging`, `member_transit`, `ground_transport_group` all carry `segmentId`
only (no `tripId`). `buildTripChildReadPredicate`'s existing
`parentTable === "trip_segment"` branch (`rls.ts:71-84`) already joins on
`"<tableName>"."segment_id"` generically — it doesn't hardcode which table
is asking. Add three entries of the existing shape `{ tableName: "...",
parentTable: "trip_segment" }` — this is the *exact* mechanism
`segment_member` already uses. Zero predicate-builder code changes needed
for this group either.

### 3. Generalize the single-parent-table branch so it isn't hardcoded to `"trip_segment"`/`"line_item"`

`pin_attendee` (→ `pin`), `poll_option` (→ `poll`), `proposal_reaction` (→
`proposal`), `photo_reaction` (→ `trip_photo`) are all 2-hop, but their
parent isn't `trip_segment` and their parent has a **direct** `trip_id`
column (unlike `trip_segment`, whose own scoping is itself indirect via
`trip.id`, and unlike `line_item`, whose own scoping is via `expense_id`).

Rather than bolting on a third and fourth hardcoded `if (parentTable ===
"...")` branch, generalize `buildTripChildReadPredicate`/
`buildTripChildMutationPredicate`'s `parentTable` handling to take an
explicit join description instead of inferring it from a hardcoded table
name:

```ts
export const tripChildRlsTargets = [
  // ...existing entries unchanged...
  { tableName: "segment_member", parentTable: "trip_segment", parentIdColumn: "segment_id", parentTripColumn: "trip_id" },
  { tableName: "lodging", parentTable: "trip_segment", parentIdColumn: "segment_id", parentTripColumn: "trip_id" },
  { tableName: "member_transit", parentTable: "trip_segment", parentIdColumn: "segment_id", parentTripColumn: "trip_id" },
  { tableName: "ground_transport_group", parentTable: "trip_segment", parentIdColumn: "segment_id", parentTripColumn: "trip_id" },
  { tableName: "pin_attendee", parentTable: "pin", parentIdColumn: "pin_id", parentTripColumn: "trip_id" },
  { tableName: "poll_option", parentTable: "poll", parentIdColumn: "poll_id", parentTripColumn: "trip_id" },
  { tableName: "proposal_reaction", parentTable: "proposal", parentIdColumn: "proposal_id", parentTripColumn: "trip_id" },
  { tableName: "photo_reaction", parentTable: "trip_photo", parentIdColumn: "photo_id", parentTripColumn: "trip_id" },
] as const;
```

with `parentIdColumn` defaulting to `` `${parentTable}_id` `` and
`parentTripColumn` defaulting to `"trip_id"` when omitted (so existing
`{ tableName: "segment_member", parentTable: "trip_segment" }` — which
needs `segment_id`, not the default `trip_segment_id` — keeps its explicit
override; this is why `segment_member`'s entry must add the explicit
`parentIdColumn: "segment_id"` when you touch it, or the default will be
wrong. Do not change `segment_member`'s *behavior*, only make its predicate
inputs explicit if the generalized function needs them spelled out).

Rewrite the `parentTable` branch of `buildTripChildReadPredicate`/
`buildTripChildMutationPredicate` to build the join generically from
`{ parentTable, parentIdColumn, parentTripColumn }` instead of the current
hardcoded `"trip_segment"`-only SQL block. **Verify the generated SQL for
`segment_member` is byte-for-byte identical before and after this
refactor** (diff `buildWorkspaceRlsStatements()` output on `main` vs your
branch, filtered to the `segment_member` policies) — this is the single
highest-risk step in this plan because it touches code path already backing
a production migration; a silent semantic change here could open or close
access to a table nobody flagged in this pass.

### 4. Multi-hop chains (3 and 4 hops) → new `chainedRlsTargets` array + new predicate builders

`poll_vote` (poll_option → poll), `room_assignment` (lodging → segment),
`lodging_guest` (lodging → segment), `ground_transport_member`
(ground_transport_group → segment), and `room_occupant` (room_assignment →
lodging → segment) need two or three joins before reaching `trip`. Rather
than stretching the 2-hop generalization from step 3 into an N-hop one (risk
to the already-shipped `segment_member`/`line_item_claim` code paths), add
a **separate, new** array and predicate builder so the existing 1-hop/2-hop
code paths are untouched:

```ts
export const chainedRlsTargets = [
  // room_assignment.lodging_id -> lodging.segment_id -> trip_segment.trip_id -> trip
  { tableName: "room_assignment", chain: [
      { table: "lodging", idColumn: "lodging_id" },
      { table: "trip_segment", idColumn: "segment_id" },
    ], tripColumn: "trip_id" },
  { tableName: "lodging_guest", chain: [
      { table: "lodging", idColumn: "lodging_id" },
      { table: "trip_segment", idColumn: "segment_id" },
    ], tripColumn: "trip_id" },
  { tableName: "ground_transport_member", chain: [
      { table: "ground_transport_group", idColumn: "ground_transport_group_id" },
      { table: "trip_segment", idColumn: "segment_id" },
    ], tripColumn: "trip_id" },
  { tableName: "room_occupant", chain: [
      { table: "room_assignment", idColumn: "room_assignment_id" },
      { table: "lodging", idColumn: "lodging_id" },
      { table: "trip_segment", idColumn: "segment_id" },
    ], tripColumn: "trip_id" },
  { tableName: "poll_vote", chain: [
      { table: "poll_option", idColumn: "poll_option_id" },
      { table: "poll", idColumn: "poll_id" },
    ], tripColumn: "trip_id" },
] as const;
```

Write `buildChainedReadPredicate`/`buildChainedMutationPredicate`/
`buildChainedPolicyStatements` that fold the `chain` array into nested
`exists (select 1 from "<hop1>" h1 join "<hop2>" h2 on h2.id = h1.<...> ...
join "trip" trip on trip.id = h_last.<tripColumn> join
"workspace_membership" membership on ... where h1.id =
"<tableName>"."<firstIdColumn>" and ...)` — same membership/workspace_id
predicate shape as the existing builders (copy the `current_setting(...)`
clauses verbatim from `buildExpenseChildReadPredicate`, only the join
skeleton is new). Wire the new array into `buildWorkspaceRlsStatements()`
alongside `tripChildStatements`/`expenseChildStatements`.

### 5. `van_profile` → `workspaceRlsTargets`, not a trip-child pattern

Add `{ tableName: "van_profile", workspaceColumn: "workspace_id" }` to
`workspaceRlsTargets` (not `tripChildRlsTargets` — it has no trip
relationship at all, per-van-per-workspace by design).

## Commands you will need

| Purpose            | Command                                  | Expected on success |
|---------------------|-------------------------------------------|----------------------|
| DB typecheck        | `pnpm -F @sortey/db typecheck`           | exit 0               |
| DB test             | `pnpm -F @sortey/db test`                | all pass             |
| DB lint             | `pnpm -F @sortey/db lint`                | exit 0               |
| Generate migration  | `pnpm -F @sortey/db generate --custom --name=extend_trip_workspace_rls` | writes an empty numbered migration file for you to fill in |
| Apply RLS locally (manual check only, not part of CI) | `docker compose up -d postgres && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/gmacko_dev pnpm -F @sortey/db migrate && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/gmacko_dev pnpm -F @sortey/db rls` | both exit 0 |
| Format check        | `pnpm format:check` (fix with `pnpm format:fix`) | exit 0     |

## Scope

**In scope** (the only files you should modify/create):
- `packages/db/src/rls.ts`
- `packages/db/src/__tests__/rls.test.ts`
- `packages/db/drizzle/` — one new generated migration (do not hand-number it)
- `packages/db/src/__tests__/rls-integration.test.ts` (new — the real-Postgres denial test)

**Out of scope** (do NOT touch, even though related):
- `packages/db/src/schema.ts` — no schema/column changes needed, this plan only adds policies over existing tables. (`settlement`'s constraint change belongs to `plans/hardening/002-reanchor-trip-child-writes.md`, not here — if you're running both plans, coordinate so `schema.ts`/migration-numbering conflicts don't collide; see STOP conditions.)
- `packages/db/src/tenant.ts` — the workspace-vs-trip predicate *design* (whether policies should check `trip.id`, not just `trip.workspace_id`) is a separate, bigger decision; this plan only extends table *coverage* using the existing workspace-level predicate shape. Do not attempt to redesign the predicates here.
- Application code (`packages/api/**`) — this is DB-layer defense-in-depth; app-layer scoping gaps are `plans/hardening/002-reanchor-trip-child-writes.md`.
- Seed scripts (`packages/db/scripts/*.ts`, `packages/db/src/seed.ts`) — FORCE RLS on newly-covered tables can break seed scripts that insert without setting session GUCs (they typically run as the DB owner, which is unaffected by RLS unless the owner lacks `BYPASSRLS` — confirm this holds for the seed scripts' connection role before merging; if it doesn't, that is a STOP condition, not something to silently patch here).

## Git workflow

- Branch: `hardening/003-extend-rls-coverage`
- Commits, roughly one per design section above: e.g. `feat(db): add RLS coverage for direct trip-scoped tables`, `feat(db): reuse trip_segment RLS pattern for lodging/transit/transport tables`, `refactor(db): generalize the 2-hop RLS parent-table predicate`, `feat(db): add chained RLS predicate builder for 3/4-hop child tables`, `fix(db): move van_profile to workspace-level RLS`, `test(db): real-Postgres cross-tenant RLS denial test`
- Do NOT push or open a PR unless the operator instructed it.
- This is a HIGH-risk migration. Land it on a branch and get explicit human sign-off before it's applied to any shared/staging database — do not run `pnpm -F @sortey/db migrate && pnpm -F @sortey/db rls` against anything but your own local `gmacko_dev`/`gmacko_test` while developing this plan.

## Steps

### Step 1: Direct trip_id tables (design section 1)

Add the six entries to `tripChildRlsTargets`. Update `rls.test.ts`'s
`.toEqual(...)` assertion for `tripChildRlsTargets` to match.

**Verify**: `pnpm -F @sortey/db typecheck` → exit 0; `pnpm -F @sortey/db test` → the updated `.toEqual` assertion passes, the "builds enable/force/policy statements" tests still pass for the pre-existing entries.

### Step 2: Segment-linked tables reusing the existing pattern (design section 2)

Add `lodging`, `member_transit`, `ground_transport_group` to
`tripChildRlsTargets` using the *current* (pre-generalization)
`parentTable: "trip_segment"` shape — do this **before** Step 3's
generalization so you have a passing baseline to diff against afterward.
Update `rls.test.ts`'s array assertion again.

**Verify**: same as Step 1.

### Step 3: Generalize the parent-table predicate (design section 3)

Before touching the predicate-builder code, capture the current SQL output
for `segment_member`'s policies:
`pnpm -F @sortey/db exec tsx -e 'import("./src/rls.ts").then(m => console.log(m.buildWorkspaceRlsStatements().filter(s => s.includes("segment_member"))))' > /tmp/segment_member_before.txt`
(or an equivalent one-off script — the point is capturing a byte-for-byte
baseline). Then:

1. Add `parentIdColumn`/`parentTripColumn` fields to the `tripChildRlsTargets`
   entry type.
2. Rewrite the `parentTable` branch in `buildTripChildReadPredicate`/
   `buildTripChildMutationPredicate` to use them (with the stated
   defaults).
3. Add the four new 2-hop entries (`pin_attendee`, `poll_option`,
   `proposal_reaction`, `photo_reaction`).
4. Re-run the capture command and diff against `/tmp/segment_member_before.txt`
   — must be identical.

Update `rls.test.ts` for the new entries and add a new assertion that a
`pin_attendee_workspace_select` (or similar) policy's SQL mentions `"pin"`
and `"trip"`, mirroring the existing `segment_member`/`line_item_claim`
join-shape assertions.

**Verify**: `pnpm -F @sortey/db typecheck` → exit 0; `pnpm -F @sortey/db test` → all pass; the `segment_member` SQL diff is empty.

### Step 4: Chained (multi-hop) predicate builder (design section 4)

Add `chainedRlsTargets` and the three new `buildChained*` functions,
wired into `buildWorkspaceRlsStatements()`. Add `rls.test.ts` coverage:
array-shape assertion for `chainedRlsTargets`, and a join-shape assertion
for at least `room_occupant` (the 4-hop case — the deepest one) confirming
its generated SQL mentions `room_assignment`, `lodging`, `trip_segment`,
and `trip` all in one policy.

**Verify**: `pnpm -F @sortey/db typecheck` → exit 0; `pnpm -F @sortey/db test` → all pass.

### Step 5: `van_profile` correction (design section 5)

Add the `van_profile` entry to `workspaceRlsTargets`. Update `rls.test.ts`'s
`workspaceRlsTargets` array assertion.

**Verify**: same pattern as Step 1.

### Step 6: Generate the migration

`pnpm -F @sortey/db generate --custom --name=extend_trip_workspace_rls`
creates an empty, correctly-numbered migration file (should land as
`0015_extend_trip_workspace_rls.sql` given `0014_trip_member_state.sql` is
the current tip — confirm the actual number it picks, don't assume).
Populate it by running `buildWorkspaceRlsStatements()` (the whole function,
same convention as `0012_trip_workspace_rls.sql`'s header comment,
`-- Generated from packages/db/src/rls.ts buildWorkspaceRlsStatements()`)
and pasting the full statement list as the migration body — every statement
is `drop policy if exists` / `create policy` / `alter table ... enable|force
row level security`, so re-emitting the full set (including tables already
covered by `0012`) is idempotent and safe, matching the existing file's own
approach.

**Verify**: `pnpm -F @sortey/db typecheck` → exit 0. Manually apply against a scratch local Postgres (`docker compose up -d postgres`, fresh `gmacko_dev` or a throwaway DB) with `pnpm -F @sortey/db migrate` and confirm no errors.

### Step 7: Real-Postgres cross-tenant denial integration test

Add `packages/db/src/__tests__/rls-integration.test.ts`. This test must
**skip, not fail**, when there's no reachable Postgres (matching the
"opt-in DB test" gap noted in Current State — there is no existing
CI-wired ephemeral DB in this repo as of `0c1ffab`):

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL
  ?? "postgresql://postgres:postgres@localhost:5432/gmacko_test";

let reachable = false;
// try a trivial connect in beforeAll; set `reachable` accordingly.

describe.skipIf(!reachable)("RLS cross-tenant denial (real Postgres)", () => {
  // 1. Connect as the DB owner (bypasses RLS) to seed: two workspaces
  //    (A, B), one trip per workspace, one user per workspace who is a
  //    member of only their own workspace/trip, and one row in a
  //    newly-covered table (e.g. `settlement`) per trip.
  // 2. Run `pnpm -F @sortey/db migrate` + apply RLS (`applyWorkspaceRls`,
  //    imported directly from `../rls`) against this scratch DB before the
  //    seed, or as part of `beforeAll`.
  // 3. Open a second connection as the *app* role (or the same role with
  //    the GUCs set — check how `packages/db/src/client.ts` connects; RLS
  //    only restricts non-superuser/non-BYPASSRLS roles, so if the pooled
  //    dev connection is a superuser this test needs its own
  //    lower-privilege role — verify and adjust rather than assuming).
  // 4. `select set_config('app.user_id', '<user A id>', true)` +
  //    `select set_config('app.workspace_id', '<workspace A id>', true)`
  //    (mirrors `getDatabaseSessionSettings` in `tenant.ts`), then
  //    `SELECT * FROM settlement WHERE trip_id = '<trip B id>'` — assert
  //    zero rows.
  // 5. Also assert the KNOWN, accepted gap from this plan's design (not a
  //    bug): a user who is a member of workspace A but of a *different
  //    trip* within workspace A CAN see trip A's other-trip rows today,
  //    because RLS is workspace-scoped, not trip-scoped (see Why This
  //    Matters and plan 002's Maintenance notes). Assert this explicitly
  //    so a future narrowing of the RLS predicate is a deliberate,
  //    reviewed change, not a silent regression either way.
});
```

Fill in the seeding/connection details against the real `packages/db/src`
client and schema exports — the pseudocode above specifies the required
assertions, not the literal implementation.

**Verify**: with `docker compose up -d postgres` running locally, `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/gmacko_test pnpm -F @sortey/db exec vitest run src/__tests__/rls-integration.test.ts` → passes with real denial assertions executed (not skipped). Without a reachable DB, the same command should skip cleanly (exit 0, tests reported as skipped, not failed).

### Step 8: Full package checks

**Verify**: `pnpm -F @sortey/db test` → all pass (integration test skips cleanly in the default no-DB environment); `pnpm -F @sortey/db lint` → exit 0; `pnpm -F @sortey/db typecheck` → exit 0; `pnpm format:check` → exit 0

## Test plan

See Steps 1-7. `rls.test.ts` gets updated array-shape assertions for all
three existing arrays plus the new `chainedRlsTargets`, plus join-shape
assertions for one representative table per new pattern (2-hop generalized,
3-hop chain, 4-hop chain). `rls-integration.test.ts` is the only test in
this plan that touches a real database and is the only one that would have
caught a logic bug in the SQL templates themselves.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm -F @sortey/db typecheck` exits 0
- [ ] `pnpm -F @sortey/db test` exits 0 (integration test skips cleanly with no `DATABASE_URL`)
- [ ] `pnpm -F @sortey/db lint` exits 0
- [ ] `grep -c "tableName:" packages/db/src/rls.ts` increases by at least 18 relative to `0c1ffab` (6 direct + 3 reused-segment + 4 generalized-2-hop + 5 chained, matching this plan's table, minus any table the drift check finds already covered)
- [ ] `grep -n "van_profile" packages/db/src/rls.ts` shows it under `workspaceRlsTargets`, not `tripChildRlsTargets`
- [ ] A new migration exists under `packages/db/drizzle/` (generated via `--custom`, not hand-numbered) containing `enable row level security` / `force row level security` / `create policy` statements for every table listed in this plan's audit table
- [ ] Manually applying the new migration against a scratch local Postgres succeeds with no errors
- [ ] `packages/db/src/__tests__/rls-integration.test.ts` exists and, when run against a real Postgres with the new migration applied, asserts zero rows for a cross-workspace `SELECT` on at least one newly-covered table
- [ ] The `segment_member` policy SQL is byte-for-byte identical before and after the Step 3 generalization (paste the diff, or lack thereof, into the commit message or PR description)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/hardening/README.md` status row updated (create the file with a one-row table if it doesn't exist)

## STOP conditions

Stop and report back (do not improvise) if:

- Any excerpt above doesn't match the live code (tables may already have been added to RLS coverage since `0c1ffab`, or the schema may have changed shape).
- The Step 3 `segment_member` SQL diff is **not** empty — this means the generalization changed behavior on an already-shipped policy; do not proceed, revert the generalization and report.
- Any seed script (`packages/db/scripts/*.ts`, `packages/db/src/seed.ts`) fails after the new migration is applied locally — this means FORCE RLS is denying rows the seed script needs, and the fix (giving the seed role `BYPASSRLS`, or having it set session GUCs) is a decision for a human, not something to patch silently.
- You're running this plan concurrently with `plans/hardening/002-reanchor-trip-child-writes.md` and both plans touch `packages/db/schema.ts`/`packages/db/drizzle/` — coordinate migration ordering (whichever lands second must regenerate against the first's migration, not hand-edit around it) rather than resolving it unilaterally.
- The connection role used by `packages/db/src/client.ts` in this environment turns out to have `BYPASSRLS` (e.g., it's the Postgres superuser) — if so, the integration test in Step 7 cannot observe real denial through that role and needs a second, lower-privileged role created for the test; report and get direction rather than writing a test that silently always passes.

## Maintenance notes

- This plan intentionally does NOT change the workspace-vs-trip predicate
  design (RLS still allows a user to see *any* trip they're not a member of
  as long as they're a member of *some* trip in the same workspace,
  identically to the pre-existing `expense`/`trip_segment`/etc. policies).
  That's a bigger, more disruptive change (every policy predicate in
  `tenant.ts` would need a `trip.id = current_setting('app.trip_id')`
  clause, and every call site would need to start setting `app.trip_id`,
  which nothing in `packages/api` does today). If/when that's tackled, it's
  a new plan, not a follow-up patch to this one — flag it rather than
  scope-creeping this migration.
- Any table added to `schema.ts` in the future with a `tripId`/`segmentId`/
  parent-chain-to-trip FK should be added to one of `rls.ts`'s target
  arrays in the same PR. Consider a lint/CI check that diffs `pgTable(...)`
  names in `schema.ts` against the union of all `rls.ts` target arrays
  (plus an explicit exclusion list for genuinely global/user-scoped
  tables) and fails if a new tenant-shaped table is missing — this plan
  does not build that check, but the audit table above is a ready-made seed
  list for one.
- The `rls-integration.test.ts` gate (skip without `DATABASE_URL`) means
  this test will not run in an environment without Postgres. If this repo
  gains a CI-wired ephemeral Postgres later, remove the skip gate and make
  it a hard requirement — tracked here as a known gap, not fixed by this
  plan.
