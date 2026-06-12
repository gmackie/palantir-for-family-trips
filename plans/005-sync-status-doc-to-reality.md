# Plan 005: Rewrite docs/ai/STATUS.md to match what has actually shipped

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat ba3457d..HEAD -- docs/ai/STATUS.md`
> If the file changed since this plan was written, re-verify each claim below
> against the live repo before proceeding.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (docs only)
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `ba3457d`, 2026-06-12

## Why this matters

`docs/ai/STATUS.md` is the implementation-status document that agents and
humans read first (it is referenced by the repo's planning workflow). It
currently claims Phases 3–5 (expenses/OCR, settlement, map/pins) are
"unimplemented" and that the current branch is `migrate/template` — both
wrong. The expenses, settlements, pins, chat, lodging, planning,
route-planner, corridor, fuel-logs, and van-profiles routers all exist and
shipped; storage/realtime/OCR integrations are enabled. A status doc that is
actively wrong is worse than none: it sends every future session off to
re-plan work that's done.

## Current state

Relevant files:

- `docs/ai/STATUS.md` — the stale doc. Its tail sections claim:
  - "Phase 3 — Expenses + Receipts + OCR (unimplemented) / All of it"
  - "Phase 4 — Settlement (unimplemented)"
  - "Phase 5 — Map + Itinerary + Transit (unimplemented)"
  - "Current Branch: `migrate/template` — 11 commits ahead of `master`"
- `docs/ai/IMPLEMENTATION_PLAN.md` — the phase definitions (source of truth
  for phase numbering; do not edit).
- `docs/ai/LAUNCH_PLAN.md` — the June-10 launch plan whose Phase A items
  (R2 storage, Gemini OCR, SSE realtime) have landed.

Ground truth verified at planning time (re-verify each with the command shown):

| Claim | Verification command | Verified result at `ba3457d` |
|---|---|---|
| Expense/settlement/pin/chat routers exist | `ls packages/api/src/router/` | `expenses.ts` (844 lines), `settlements.ts`, `pins.ts`, `chat.ts`, `itinerary.ts`, `lodging.ts`, `planning.ts`, `photos.ts`, plus road-trip routers `route-planner.ts`, `corridor.ts`, `fuel-logs.ts`, `van-profiles.ts`, `location.ts` |
| OCR pipeline incl. Gemini provider exists | `ls packages/api/src/ocr/` | `gemini-extractor.ts`, `claude-extractor.ts`, `mock-provider.ts`, `reconcile.ts`, `schema.ts` |
| Integrations enabled | `grep -n "provider" packages/config/src/integrations.ts \| head` | realtime `"sse"`, storage `"r2"`, email `"resend"`, all `enabled: true` |
| R2 binding present | `grep -n "r2_buckets" apps/nextjs/wrangler.jsonc` | binding `R2` exists |
| Trip/expense migrations exist | `ls packages/db/drizzle/*.sql` | `0000`…`0006` migration files |
| Chat shipped (Durable Objects + WS) | `git log --oneline \| grep -i chat \| head` | multiple `feat(...)`/`fix(...)` chat commits (e.g. `f4b43b2`, `53f962c`) |
| Maestro mobile smoke exists | `ls .maestro/` | `01-app-launches.yaml` |

Still-true gaps to KEEP in the doc (verified still missing at `ba3457d`):

- RLS policies: `grep -rn "CREATE POLICY\|ROW LEVEL SECURITY" packages/db/drizzle/*.sql`
  → zero matches. The "Trip RLS policies" gap is real — keep it listed.
- Rate limiting: `grep -rn "TODO(ratelimit)" packages/api/src` → two hits
  (`chat.ts:229`, `trips.ts:1087`). Worth listing as a known gap.
- Road-trip prediction features: no code matches `predictedStop`/`drivingMode`
  (`grep -rin "predictedstop\|drivingmode" apps packages --include="*.ts*"` →
  nothing outside docs), and `gpsTrackPoints` exists in
  `packages/db/src/schema.ts:1288` with no router using it. Predicted stops,
  Driving Mode, and GPS breadcrumbs are designed (see `CONTEXT.md`,
  `docs/ai/ROAD_TRIP_PROPOSAL.md`) but unbuilt.

Vocabulary: use the terms from `CONTEXT.md` (Trip Mode, Group Mode, Segment,
Corridor, Predicted Stop, Driving Mode) when describing road-trip status.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Verify claims | (table above, per claim) | matches stated results |
| Lint (formatting) | `pnpm format:check` | exit 0 (or no new issues in docs/) |

## Scope

**In scope** (the only file you should modify):
- `docs/ai/STATUS.md`

**Out of scope** (do NOT touch):
- `docs/ai/IMPLEMENTATION_PLAN.md`, `LAUNCH_PLAN.md`, `ROAD_TRIP_PROPOSAL.md`,
  and all other docs — they are historical planning artifacts, not status.
- `CLAUDE.md` / `AGENTS.md`.
- Any source code.

## Git workflow

- Branch off the current branch; name like `advisor/005-status-doc-sync`.
- Commit style: conventional commits, e.g.
  `docs: sync STATUS.md with shipped phases (expenses/settlement/map/chat live)`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Run every verification command in the Current state table

Record actual outputs. If any claim does NOT verify (e.g. a router was
deleted), adjust the rewrite accordingly — the doc must reflect what you
verified, not what this plan asserts.

**Verify**: each command produces the stated result (or you've noted the
delta).

### Step 2: Rewrite the stale sections

Update `docs/ai/STATUS.md`:

1. Update the header line ("Updated after …") to reflect this sync and date.
2. Move Phases 3, 4, 5, and the Phase-2 chat work from "What's NOT Built Yet"
   into "What's Built", with one-line summaries naming the actual files
   (router names, OCR providers, integrations) you verified in Step 1.
3. Add a short "Road Trip Mode" subsection: shipped (route-planner, corridor,
   fuel logs, van profiles, location) vs. designed-but-unbuilt (Predicted
   Stops, Driving Mode, GPS breadcrumbs / `gpsTrackPoints`).
4. Keep the still-true gaps: trip RLS policies (no `CREATE POLICY` in any
   migration), rate limiting TODOs, plus whichever Phase 2P planning items
   you cannot verify as built (check `packages/api/src/router/planning.ts`
   and `lodging.ts` contents before declaring 2P done or not — describe what
   the routers actually expose).
5. Replace the "Current Branch" section: delete the stale `migrate/template`
   claim; either state the doc is branch-agnostic or name the default branch
   (`master`).
6. Refresh "Build Status" only if you can cheaply re-run the quoted build
   command; otherwise mark it "as of <old date>" so it can't be read as
   current.

**Verify**:
`grep -c "unimplemented" docs/ai/STATUS.md` → only matches (if any) describe
features that are genuinely unbuilt per your Step-1 verification;
`grep -c "migrate/template" docs/ai/STATUS.md` → `0`.

### Step 3: Format gate

**Verify**: `pnpm format:check` → no failures introduced in `docs/`.

## Test plan

Docs change — the "tests" are the verification greps in Steps 1–2. No code
tests.

## Done criteria

- [ ] `grep -c "migrate/template" docs/ai/STATUS.md` prints `0`
- [ ] STATUS.md no longer lists expenses, settlement, pins/map, or chat as unimplemented
- [ ] The RLS gap and rate-limit TODOs remain listed as known gaps
- [ ] Every claim in the rewritten doc traces to a Step-1 verification you ran
- [ ] No files outside `docs/ai/STATUS.md` are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- A majority of the Step-1 verifications fail (the repo has drifted past this
  plan's ground truth — the rewrite needs re-research, not improvisation).
- You find yourself wanting to edit `IMPLEMENTATION_PLAN.md` to make the
  story consistent — that file is out of scope by design.

## Maintenance notes

- STATUS.md goes stale because nothing forces updates. Suggestion for the
  maintainer (not part of this plan): add a line to `AGENTS.md`'s planning
  flow requiring a STATUS.md touch in any PR that completes a phase.
- The road-trip "designed-but-unbuilt" list doubles as the seed for a future
  direction plan (Predicted Stops / Driving Mode spike).
