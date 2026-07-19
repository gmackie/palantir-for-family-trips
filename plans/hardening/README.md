# Master Hardening Plans

Generated 2026-07-19 from a full six-dimension `/improve` audit of `origin/master`
at commit `0c1ffab`. Each plan is self-contained and executor-ready: read it
fully, run its **Drift check** first, honor its STOP conditions, and update its
row here when done. All plans were authored against directly-verified code
excerpts at `0c1ffab`.

> **Branch**: this set lives on `claude/master-hardening`, cut from
> `origin/master`. It is **unrelated** to the earlier `claude/shadcn-improve-*`
> fork (that fork has no common ancestor with master). Execute these against a
> checkout of master.

## Execution order & status

Ordered by the five themes below (deploy-critical first). Within a theme,
higher-priority first.

| Plan | Title | Priority | Effort | Risk | Depends on | Status |
|------|-------|----------|--------|------|------------|--------|
| **T0 — Deploy-critical** |
| 001 | Fix the drizzle migration journal (missing entries, dup `0011`, orphaned snapshots) | P1 | M | MED-HIGH | — | TODO |
| **T1 — Security / tenant-isolation** |
| 002 | Re-anchor trip-child writes to `ctx.tripId` (anchor IDOR, unclaimLineItem, settlement idempotency leak) | P1 | S | LOW | — | CODE DONE (steps 1–4 + tests; step 5 schema/migration deferred behind 001) |
| 003 | Extend RLS coverage to the uncovered trip-child tables + a real cross-tenant denial test | P1 | L | HIGH | — | TODO |
| 004 | Move receipt-upload authz before storage/OCR + durable rate limiter | P1 | S–M | LOW–MED | — | TODO |
| 005 | Wipe all local caches on sign-out (shared-device leak) + fix admin `platform_role` GUC | P1 | M | LOW–MED | — | TODO |
| **T2 — Offline data-integrity** |
| 006 | Add server-side idempotency to offline expense/pin/fuel writes | P1 | M | MED | — | TODO |
| 007 | Harden + unify the three outbox implementations (lost/dup writes, retry cap, corruption) | P2 | M | MED | 006 | TODO |
| **T3 — Correctness** |
| 008 | Replace UTC "today" with trip-tz across the planner (7 sites) | P1 | M | LOW | — | TODO |
| 009 | Guard ferry fare edit/delete against finalized expenses | P2 | S–M | LOW | — | TODO |
| 010 | Money-input validation + concurrency guards (negative cents, room membership, acceptInvite race, finalize race) | P2 | S | LOW–MED | — | TODO |
| 011 | Planner math fixes (expandStopDays index, candidate rank dup, leave-by UTC, fuel currency) | P2–P3 | S–M | LOW | — | TODO |
| **T4 — Perf / debt / tests** |
| 012 | Batch the N+1 queries (`trips.get`/list, pins, planning polls/proposals) | P2 | S–M | LOW | — | TODO |
| 013 | Consolidate the 5 duplicated organizer checks + dual `assertLodgingInTrip` | P3 | M | LOW–MED | 014 (soft) | TODO |
| 014 | Test the untested critical paths (guards, settlement record/undo, assignLineItem) — replaces decoy tests | P2 | M | LOW | — | TODO |
| 015 | Bump `@better-auth/cli` catalog skew; scoped notes for deferred perf/debt items | P3 | S | LOW | — | TODO |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (one-line reason) | REJECTED (rationale).

## Dependency & sequencing notes

- **001 is deploy-critical and should land first** — a fresh `migrate` currently
  omits `trip_day`/`trip_member_state`/`trip_invite.role`, breaking the planner,
  pause/resume, and invite roles in any new/DR environment.
- **007 depends on 006** — client outbox hardening assumes server-side idempotency
  exists (server dedupe is the primary duplicate-write guard).
- **013 should follow 014 (soft)** — land the guards/organizer tests first so the
  auth-helper consolidation has a regression net.
- **003 is HIGH risk / architecturally significant** — enabling `FORCE ROW LEVEL
  SECURITY` on newly-covered tables denies all rows if the per-request GUCs aren't
  set on that query path. Staged rollout + seed-script updates required; do not
  ship without the denial integration test it adds. Consider a human review gate.
- 002, 004, 005, 006, 008, 009, 010, 011, 012 are largely independent and can be
  parallelized (mind shared-file overlaps: 010 & 012 both touch `trips.ts`; 013 &
  014 both touch the auth/test areas).

## Corrections & discoveries made during authoring (beyond the audit leads)

- **RLS coverage (003)**: the audit's 13-table list was refined to a full **18-table**
  audit. `van_profile` is workspace-scoped (belongs in `workspaceRlsTargets`, not
  trip-child). Five more uncovered tables of the same shape were found:
  `photo_reaction`, `poll_vote`, `proposal_reaction`, `lodging_guest`,
  `room_occupant`, `ground_transport_member`.
- **Migration journal (001)**: beyond the 4 missing journal entries and duplicate
  `0011`, the `meta/` snapshot chain **stops at `0009_snapshot.json`** (idx 10–14
  have no snapshots) — a deeper reconstruction the plan handles with a
  light/heavy branch verified empirically.
- **Decoy tests (013/014)**: the `assignLineItem` decoy test is not isolated —
  `expenses.test.ts:66` and `planning.test.ts:63` **also** redefine the guard
  functions they purport to test. `assignLineItem`'s `expenseId` is never
  validated against `lineItemId`/`ctx.tripId` (another IDOR-class gap, noted for
  backlog).
- **Test harness gaps**: `apps/expo` has **no `test` script or vitest dependency**
  despite 5 existing `*-outbox.test.ts` files (plan 007 wires this up first);
  `apps/nextjs` has no Route-Handler test harness (plan 004 uses a source-grep
  pinning test instead of a fabricated one).
- **UTC "today" (008)**: an additional site beyond the audit list —
  `packages/api/src/router/share.ts:45` (public share-recap) — was folded in.

## Provenance

Audit dimensions: correctness/money, security/tenant-isolation, planner/road-trip,
performance, test-coverage, tech-debt/deps — plus deep planner + offline-sync
sub-audits. ~55 vetted findings consolidated into these 15 plans. Findings the
audit checked and cleared (settlement/share math, the guard chain itself, no
committed secrets, no destructive migrations, the applied RLS fails closed) are
intentionally not re-listed here.
