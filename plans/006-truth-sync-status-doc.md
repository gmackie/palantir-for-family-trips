# Plan 006: Bring docs/ai/STATUS.md (and the README title) back in sync with shipped reality

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2408b3e..HEAD -- docs/ai/STATUS.md README.md`
> If these files changed since this plan was written, read them fresh — the
> staleness described below may already be (partially) fixed.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `2408b3e`, 2026-06-12

## Why this matters

This repo is explicitly agent-driven: `AGENTS.md` instructs every agent to "keep implementation work anchored to the current docs instead of stale conversation context," and `docs/ai/STATUS.md` is the implementation-status source of truth. It is now badly wrong: it claims Phases 3 (expenses/receipts/OCR), 4 (settlement), 5 (map/itinerary), 6 (dashboard), and 8 (Expo mobile) are "unimplemented," while the git history at HEAD ships all of them (expenses, settlements, polls/proposals, chat over Durable Objects, realtime member locations, Driving Mode, fuel-log gas splits, an Expo app with map/trip screens). It even says "Current Branch: migrate/template — 11 commits ahead of master," while HEAD is on `master`. Every agent that reads it risks re-planning or re-building shipped work. Separately, `README.md:1` still titles the repo `create-gmacko-app` (the template), and root `package.json` `name` is still `create-gmacko-app`.

## Current state

- `docs/ai/STATUS.md` — stale claims include (verified at 2408b3e):
  - "Phase 3 — Expenses + Receipts + OCR (unimplemented) — All of it" → `packages/api/src/router/expenses.ts` (844 lines), `fuel-logs.ts`, line items/claims in `packages/db/src/schema.ts`, expense pages under `apps/nextjs/src/app/trips/[tripId]/expenses/`. (OCR is genuinely *not wired* — extractors exist in `packages/api/src/ocr/` but no router calls them; keep that nuance.)
  - "Phase 4 — Settlement (unimplemented)" → `packages/api/src/router/settlements.ts`, `packages/api/src/expenses/{settle,shares}.ts` + tests, settle pages in both apps. (Note: plan 001 in this directory fixes a real bug there — if it hasn't landed, say "implemented, known bug being fixed" rather than "done".)
  - "Phase 5 — Map + Itinerary (unimplemented)" → `router/{pins,itinerary,corridor,route-planner}.ts`, map screens in Expo.
  - "Phase 8 — Expo mobile (unimplemented)" → `apps/expo/src/app/trip/[tripId]/` (map, settle, new-expense, driving mode), Maestro smoke flows.
  - "Current Branch: migrate/template" → `git branch --show-current` says `master`.
- `README.md:1` — `# create-gmacko-app`, full template README beneath.
- Ground-truth sources for the rewrite: `git log --oneline -100`, `packages/api/src/root.ts` (which routers are actually wired), `packages/db/src/schema.ts` (which tables exist), `ls apps/nextjs/src/app/trips/[tripId]/` and `ls apps/expo/src/app/trip/[tripId]/`, plus `docs/ai/IMPLEMENTATION_PLAN.md` for the phase names. The audit that produced these plans also confirmed: push notifications ARE implemented (`packages/db` `push_token` table, `notifications.registerPushToken`, `packages/api/src/notifications/send.ts` posting to the Expo push API); corridor search has an API but no data importer and little UI; Side Trip / Fuel Zone / Route Gradient / Predicted Stop (CONTEXT.md terms) are designed but unbuilt.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Wired routers | `grep -n "Router" packages/api/src/root.ts` | list of mounted routers |
| Web routes | `ls apps/nextjs/src/app/trips/\[tripId\]/` | feature directories |
| Mobile routes | `ls apps/expo/src/app/trip/\[tripId\]/` | feature screens |
| Branch | `git branch --show-current` | `master` (or current) |
| Format | `pnpm format:check` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `docs/ai/STATUS.md`
- `README.md` (title + opening section only)

**Out of scope** (do NOT touch):
- Root `package.json` `name` field — renaming the package can ripple into tooling (turbo filters, lockfile); flag it in your report as a recommended follow-up, don't do it here.
- `docs/ai/IMPLEMENTATION_PLAN.md`, `INITIAL_PROPOSAL.md`, `CONTEXT.md`, `DESIGN.md` — planning artifacts; only STATUS.md claims to describe current state.
- Any source code.

## Git workflow

- Branch: `advisor/006-status-doc-truth-sync`
- Commit: `docs(status): sync STATUS.md with shipped phases; retitle README to Sortey`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Build the evidence table

Run the commands above. For each phase named in STATUS.md, record: implemented routers/tables/routes, with paths. Where something is partial, name exactly what's missing (e.g. "OCR: extractors + fixtures + tests exist in `packages/api/src/ocr/`, no router integration").

**Verify**: evidence table in your report.

### Step 2: Rewrite STATUS.md

Keep its existing structure (What's Built / What's NOT Built Yet / Build Status / Current Branch) but make every claim trace to Step 1 evidence. Requirements:

- Date-stamp the top ("Updated 2026-06-12, commit `<current short SHA>`").
- "What's NOT Built Yet" must list only verified gaps. Known-from-audit gaps to verify and include: OCR-to-expense wiring; corridor POI data import + UI surfacing; Side Trip / Fuel Zone / Route Gradient / Predicted Stop (cite CONTEXT.md); SMS invites (A2P registration docs exist, `docs/ai/A2P_10DLC_REGISTRATION.md`); trip-table RLS policies; whatever Phase 2 gaps from the old doc still genuinely hold (check each one — e.g. invite accept flow may exist now).
- Reference `plans/README.md` for known bugs/debt being worked.
- Update the Build Status command/output if it has changed; update Current Branch.

**Verify**: `grep -n "unimplemented" docs/ai/STATUS.md` → only lines describing *verified* gaps; `grep -n "migrate/template" docs/ai/STATUS.md` → no matches.

### Step 3: Retitle the README

Replace the H1 and opening paragraph of `README.md` with the product identity: "# Sortey — Group Trip Command Center" (one short paragraph on what it is: trip coordination with destination and road-trip modes; see `CONTEXT.md` for vocabulary). Keep all template/stack documentation below it under a "## Template & stack" style heading — the monorepo docs are still accurate and useful. Do not rewrite the whole README.

**Verify**: `head -5 README.md` shows the Sortey title; the template content still present below.

### Step 4: Format check

**Verify**: `pnpm format:check` → exit 0 (biome formats markdown if configured; if it doesn't cover these files, skip).

## Test plan

Not applicable (docs). The verification greps in Steps 2–3 are the gates.

## Done criteria

- [ ] STATUS.md contains no claim contradicted by `packages/api/src/root.ts`, the schema, or the app route trees (spot-checkable via the Step 1 evidence table in the executor's report)
- [ ] STATUS.md is date-stamped with the commit it was verified against
- [ ] `grep -n "migrate/template" docs/ai/STATUS.md` returns nothing
- [ ] `README.md` opens with the Sortey product identity
- [ ] Only the two in-scope files are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- You cannot determine whether a phase item is built after checking router/schema/routes — list it as "unverified" in the doc rather than guessing either way, and flag it.
- STATUS.md has been substantially rewritten since 2408b3e (drift check) — reconcile instead of overwriting.

## Maintenance notes

- The durable fix is process, not a one-time rewrite: the repo's `AGENTS.md` planning flow should require touching STATUS.md in the same change that completes a phase. Suggest that edit to `AGENTS.md` in your report (out of scope to make it here).
- The `package.json` name rename (`create-gmacko-app` → `sortey`) remains open; it needs a check of turbo filters, `pnpm -F` invocations in scripts/CI, and the lockfile.
