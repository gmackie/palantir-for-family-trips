# Plan 015: Clear the @better-auth/cli catalog skew; deferred perf/debt notes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` (add a row for the `hardening/` series if one doesn't
> exist yet) — unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**: `git diff --stat 0c1ffab..HEAD -- pnpm-workspace.yaml pnpm-lock.yaml packages/db/src/auth-schema.ts`
> If the catalog or lockfile changed since this plan was written, re-run
> `pnpm audit --audit-level high` first — the advisory may already be
> resolved, or a newer skew may have appeared.

## Status

- **Priority**: P3 (part (a) is low-risk hygiene; part (b) is notes only, no
  code change)
- **Effort**: S (part (a)); part (b) is not implementation, just scoped
  findings for future plans
- **Risk**: LOW (part (a) touches only a devDependency-only package used
  solely for offline schema codegen, not the running server; see "Why this
  matters")
- **Depends on**: none
- **Category**: dependencies / perf (notes)
- **Planned at**: commit `0c1ffab`, 2026-07-19

## Why this matters

### (a) `@better-auth/cli` catalog skew

`pnpm-workspace.yaml`'s catalog pins `@better-auth/cli: 1.4.22` (line 7)
while the runtime packages `better-auth` (line 24) and `@better-auth/expo`
(line 8) are both at `1.6.17` — a two-minor-version skew. This is a
known-shape gap: plan 005 (`plans/005-remediate-dependency-advisories.md`,
MERGED 2026-06-17) bumped `better-auth` and `@better-auth/expo` together
from 1.6.11 to clear a set of transitive advisories (seroval/solid-js), but
`@better-auth/cli` — a separate package, only used by
`packages/auth/package.json`'s `generate` script
(`pnpx @better-auth/cli generate --config script/auth-cli.ts --output ../db/src/auth-schema.ts`,
line 16) to regenerate `packages/db/src/auth-schema.ts` — was not part of
that bump and was left behind. `@better-auth/cli` is listed only under
`packages/auth/package.json`'s `devDependencies` (line 27,
`"@better-auth/cli": "catalog:"`) — it never ships in a production bundle
or runs in the request path; its only job is local/CI schema codegen. This
is why the advisories it (and any transitively-stale peer, including
`drizzle-orm` if the audit flags it in the same run) contributes reach only
dev tooling, not runtime — say so explicitly in the audit follow-up rather
than treating it with the same urgency as plan 005's original findings.

### (b) Deferred / investigate notes

Four items surfaced during this audit that are real but too large or too
uncertain to plan in full here — precise scope + file:line so a future plan
can pick each one up without re-discovering it.

## Current state

### (a)

- `pnpm-workspace.yaml` line 7: `'@better-auth/cli': 1.4.22`
- `pnpm-workspace.yaml` line 8: `'@better-auth/expo': 1.6.17`
- `pnpm-workspace.yaml` line 24: `better-auth: 1.6.17`
- `packages/auth/package.json` line 16: `"generate": "dotenv -e ../../.env -- pnpx @better-auth/cli generate --config script/auth-cli.ts --output ../db/src/auth-schema.ts"`
- `packages/auth/package.json` line 27: `"@better-auth/cli": "catalog:"` (under `devDependencies`, confirmed — not `dependencies`)
- `packages/db/package.json` line 55: `"drizzle-orm": "^0.45.2"` — NOT
  catalog-managed (a direct semver range in `packages/db`'s own
  `package.json`), so "drizzle-orm entries" in an audit are a separate axis
  from the catalog skew above; re-derive live whether `pnpm audit` flags
  anything on this package before assuming it's related to the
  `@better-auth/cli` bump.
- Advisory IDs to re-derive live (do not trust a stale list — advisories
  rot fast, same caveat plan 005 documented): run
  `pnpm audit --audit-level high` fresh and read whatever GHSA ids it
  actually reports at execution time.

### (b) Deferred / investigate

1. **Missing `tripId`/hot-column indexes.** `packages/db/src/schema.ts` has
   exactly 2 explicit `index()` calls in the entire 1676-line file:
   `journey_stop_trip_arrived_idx` on `(tripId, arrivedAt)` (line 381) and
   `trip_message_trip_created_idx` on `(tripId, createdAt)` (line 456).
   Every other trip-scoped table (`pins`, `polls`, `proposals`,
   `expenses`, `lineItems`, `lineItemClaims`, `lodgings`,
   `tripSegments`, `tripMembers`, `tripPhotos`, etc. — 30 total column
   references to `tripId` in the file per a raw grep) relies on whatever
   implicit index a foreign-key or primary-key constraint gives it, if any.
   Plan 012 in this same series adds several `inArray(...)`/`groupBy(...)`
   batched queries against these tables (`pins.attendee` counts,
   `pollOptions`/`pollVotes`, `proposalReactions`) — those queries will
   benefit most from confirming their filter/group columns are indexed.
   **Before writing a migration**: run `EXPLAIN ANALYZE` on the batched
   queries plan 012 introduces (and on the existing hot list/get endpoints)
   against a representative-sized test dataset; only add indexes where the
   plan shows a seq scan, per this repo's existing caution
   (`plans/001-fix-settlement-summary-claims-query.md`'s Maintenance notes
   made the same call for `lineItemClaims.lineItemId` and deferred it for
   the same reason — the unique constraint already covered that case).
   Don't guess at index need without an EXPLAIN in hand.

2. **`assessSideTrip` re-decodes the whole route polyline every poll.**
   `packages/api/src/router/route-planner.ts` lines 739-772 (`assessSideTrip`
   query): on every call it re-fetches all of the trip's segments, then
   for each segment with a `routePolyline`, runs `decode(seg.routePolyline, 5)`
   (line 761) over the FULL polyline — decoding is O(polyline length), and
   nothing caches the decoded points across calls. The doc comment above
   the procedure (line 725-727) says "clients poll from Driving Mode" —
   i.e., this runs on a recurring ~30s timer per the finding's framing (the
   30s figure itself wasn't independently confirmed in the client polling
   code during this audit — check `apps/expo/src/app/trip/[tripId]/drive.tsx`'s
   poll interval before quoting "30s" as fact in any follow-up plan).
   Fix direction: cache the decoded `points` array keyed by a
   route-version signal (e.g. a hash of the segment's `routePolyline`
   string, or a `routeVersion`/`updatedAt` column if one exists on
   `tripSegments` — check the schema) so repeat polls against an unchanged
   route skip the `decode()` call entirely. The existing density cap at
   lines 774-780 (sampling down to ≤400 points) is orthogonal and should
   stay — it bounds the `assessSideTrip` geometry cost, not the decode
   cost.

3. **`moveStop` does 2N single-row updates.** `packages/api/src/router/journey.ts`
   lines 209-251 (`moveStop` mutation): after computing the new stop order
   (`planMove`, line 226), it runs two separate loops over ALL `N` stops in
   the trip — first setting every stop's `sortOrder` to a negative
   placeholder (lines 230-235, avoids unique-constraint collisions during
   reorder), then setting every stop's `sortOrder` to its real final value
   (lines 236-241) — each iteration is its own `await tx.update(...)`. That's
   `2N` round-trips inside one transaction for a reorder of `N` stops.
   Fix direction: a single `CASE WHEN id = ... THEN ... END` bulk update (or
   Drizzle's `sql` template for a `VALUES`-joined bulk update) could
   collapse each pass to one statement — but confirm Drizzle's version in
   this repo (`packages/db/package.json` pins `drizzle-orm: ^0.45.2`, see
   part (a) above) supports the bulk-update helper cleanly before assuming
   the rewrite is a drop-in; if not, a raw `sql` tagged template following
   this repo's existing PostGIS raw-SQL precedent
   (`docs/adr/0001-postgis-for-spatial-queries.md`) is the fallback. Trip
   stop counts are typically small (single/low-double digits), so this is a
   correctness-adjacent latency concern (transaction hold time), not a
   scale emergency — size the priority of any follow-up plan accordingly.

4. **1,400+-line god-components in the Expo app.**
   `apps/expo/src/app/trip/[tripId]/new-expense.tsx` is 1450 lines — the
   largest single screen file in the app. Siblings are close behind:
   `apps/expo/src/app/settings.tsx` (1328), `apps/expo/src/app/trip/[tripId]/day-plan.tsx`
   (1299), `apps/expo/src/app/trip/[tripId]/polls.tsx` (1235),
   `apps/expo/src/app/trip/[tripId]/today.tsx` (1067),
   `apps/expo/src/app/index.tsx` (1003). These weren't read in depth during
   this audit — only sized. A split is a larger effort and should be
   characterization-test-first (snapshot/behavior tests around the current
   component before any extraction, so a refactor can't silently change
   behavior) rather than an ad hoc breakup; do not scope a full plan for
   this without first confirming (in whatever plan picks it up) that no
   Maestro flow (see `.claude/skills/test-mobile-with-maestro`) already
   covers `new-expense.tsx`'s happy path as a safety net.

## Commands you will need

| Purpose   | Command                                                            | Expected on success |
|-----------|---------------------------------------------------------------------|---------------------|
| Audit     | `pnpm audit --audit-level high`                                    | target: 0 high/critical reachable via `@better-auth/cli`'s tree (and confirm any `drizzle-orm` entries separately — see Step 2) |
| Install   | `pnpm install`                                                     | exit 0, postinstall workspace check passes |
| Why-chain | `pnpm why @better-auth/cli`                                        | shows resolved version and dependents |
| Auth typecheck | `pnpm -F @sortey/auth typecheck`                               | exit 0 |
| Api typecheck  | `pnpm -F @sortey/api typecheck`                                 | exit 0 |
| Auth schema drift | `pnpm --filter @sortey/auth generate && git diff --stat packages/db/src/auth-schema.ts` | empty diff (requires a configured `.env` — see Step 3) |

## Scope

**In scope** (the only files you should modify, part (a) only — part (b) is
notes, no file changes):
- `pnpm-workspace.yaml` (bump the `@better-auth/cli` catalog entry)
- `pnpm-lock.yaml` (regenerated by `pnpm install` only — never hand-edited)

**Out of scope** (do NOT touch):
- `better-auth` / `@better-auth/expo` catalog entries — already at 1.6.17
  from plan 005, do not re-bump those as part of this plan.
- `packages/db/src/auth-schema.ts` — must not drift from the bump (see gate
  in Step 3); if it does, that's a STOP condition, not something to
  reconcile by hand.
- `drizzle-orm`'s version in `packages/db/package.json` — if the audit
  flags it, record the finding in your report as a SEPARATE backlog item
  (it is not catalog-managed and not part of the `@better-auth/cli` skew);
  do not bump it as part of this plan.
- Any of the four items in part (b) — those are notes for future plans,
  not implementation here. Do not write code, migrations, or refactors for
  them.
- Any source file outside `pnpm-workspace.yaml`/`pnpm-lock.yaml`.

## Git workflow

- Branch: `advisor/015-deps-and-perf-notes`
- Commits: `chore(deps): bump @better-auth/cli to close the better-auth catalog skew`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Baseline

Run `pnpm audit --audit-level high` and save the output. Run
`pnpm why @better-auth/cli` and note the resolved version and what pulls it
in (should be exactly `packages/auth` via its `devDependencies`, per the
Current State section — confirm no other package also depends on it with a
conflicting range).

**Verify**: baseline recorded in your report.

### Step 2: Bump `@better-auth/cli`

Bump the `pnpm-workspace.yaml` line 7 catalog entry for `@better-auth/cli`
to match the `better-auth`/`@better-auth/expo` line (currently `1.6.17`) —
these three packages are published together by the same project and are
expected to move in lockstep; use `1.6.17` unless `pnpm why` / the
package's own changelog shows a newer compatible patch is available, in
which case prefer the newest patch that still matches `better-auth`'s major.minor.

**Verify**: `pnpm install` → exit 0

### Step 3: Confirm no schema drift

Run `pnpm --filter @sortey/auth generate` (the script at
`packages/auth/package.json:16`) and diff the output:
`git diff --stat packages/db/src/auth-schema.ts` → expect an EMPTY diff
(the CLI bump is a tooling-version bump, not a schema-shape change; if the
generated schema changes, that's unexpected and worth stopping over). This
requires a configured `.env` at the repo root (`dotenv -e ../../.env` in
the script) — if this environment can't run it (no DB/env available),
explicitly flag this gate as unverified in your report rather than skipping
it silently, matching plan 005's precedent for the same gate.

**Verify**: `git diff --stat packages/db/src/auth-schema.ts` → empty (or explicitly flagged unverifiable, with the reason stated)

### Step 4: Typecheck + audit sweep

**Verify**: `pnpm -F @sortey/auth typecheck` → exit 0; `pnpm -F @sortey/api typecheck` → exit 0; `pnpm audit --audit-level high` → the `@better-auth/cli`-attributed entries are gone (or confirmed already dev-only and now current); record whether any `drizzle-orm` entries are present and, if so, whether they are runtime- or dev-tool-reachable (`pnpm why drizzle-orm` from the repo root and from `packages/db`) — write the verdict in your report per the "say so" instruction in Why This Matters, do not silently drop it.

### Step 5: Write up part (b)

No code changes for part (b). Copy the four "Deferred / investigate" items
from this plan's Current State section into `plans/README.md`'s "Audited
findings not planned" backlog table (the table already exists — see the
existing rows for the shape to match: Finding / Category / Impact / Effort /
Notes columns), so they're discoverable from the series index without
re-reading this file. Do not expand them into full plans as part of this
step — that's explicitly future work.

**Verify**: `plans/README.md` backlog table has 4 new rows referencing this plan's file:line citations.

## Test plan

No new automated tests — this plan is a dependency bump plus documentation.
The gates are: `pnpm install`, the schema-drift diff, `pnpm audit`, and the
two typecheck commands. If the operator's environment can run the full
suite, `pnpm -F @sortey/api test` and `pnpm -F @sortey/auth test` (if that
package has tests — check first, `packages/auth/package.json`'s scripts
list did not show a `test` script at plan time, only `typecheck`/`lint`/
`format`/`generate`/`clean`; if there's genuinely no test script, this gate
is N/A, not a failure) are bonus gates, not required.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm-workspace.yaml`'s `@better-auth/cli` entry matches `better-auth`'s major.minor (or newer patch, justified)
- [ ] `pnpm install` exits 0
- [ ] `packages/db/src/auth-schema.ts` diff is empty (or explicitly flagged unverifiable with a stated reason)
- [ ] `pnpm -F @sortey/auth typecheck` exits 0
- [ ] `pnpm -F @sortey/api typecheck` exits 0
- [ ] `pnpm audit --audit-level high` output recorded pre- and post-bump in the report, with an explicit verdict on `drizzle-orm` entries (present/absent, runtime/dev-only)
- [ ] `plans/README.md`'s backlog table has 4 new rows for the part (b) items, each citing this plan's file:line evidence
- [ ] Only `pnpm-workspace.yaml` and `pnpm-lock.yaml` are modified for part (a) (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Bumping `@better-auth/cli` changes `packages/db/src/auth-schema.ts`'s
  generated output — report the diff instead of accepting it; a
  CLI-version-only bump changing schema output means something about the
  CLI's generation logic itself changed, which needs review, not a rubber
  stamp.
- `pnpm install`'s postinstall workspace-consistency check fails on version
  mismatch — report rather than suppressing.
- No compatible `1.6.x` release of `@better-auth/cli` exists (e.g. the
  package versions independently of `better-auth` core and skipped that
  line) — report the actual available versions and let the operator decide
  whether a version-string mismatch (CLI on a different but current minor)
  is acceptable, rather than picking one yourself.
- The audit shows `drizzle-orm` advisories that ARE runtime-reachable (not
  dev-only) — that contradicts this plan's framing and needs its own
  assessment before any bump; do not fold a runtime-reachable fix into this
  otherwise-low-risk plan.

## Maintenance notes

- `better-auth`, `@better-auth/expo`, and `@better-auth/cli` should be
  treated as a version-paired trio going forward — plan 005 paired the
  first two and missed the third; a comment in `pnpm-workspace.yaml` next
  to the catalog entries (`# keep in lockstep with better-auth`) would
  prevent this specific skew from recurring, and is a cheap addition if the
  executor wants to include it (not required by Done Criteria, but
  recommended).
- Advisories rot fast: re-run `pnpm audit --audit-level high` at review
  time regardless of what this plan recorded at commit `0c1ffab`.
- The four part (b) items are intentionally NOT full plans — each needs
  either a live `EXPLAIN` (item 1), confirmation of the actual client
  polling interval (item 2), a Drizzle-bulk-update feasibility check (item
  3), or a characterization-test-first scoping pass (item 4) before an
  implementation plan can be written responsibly. Pulling any one of them
  into a real plan is good follow-up work; this plan's job was to locate
  and scope them precisely, not to solve them.
