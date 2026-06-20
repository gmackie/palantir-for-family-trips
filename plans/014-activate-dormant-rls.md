# Plan 014: Activate the dormant RLS tenant-isolation layer (DESIGN / NEEDS DECISION)

> **Status: NOT READY FOR A BLIND EXECUTOR.** This is an architecturally
> significant, app-breaking-if-wrong change. It requires a human decision on
> scope and a design review before any executor runs it. The steps below are a
> proposed phased approach, not a hand-off-and-go plan.

## Status

- **Priority**: P2 (security defense-in-depth)
- **Effort**: L
- **Risk**: HIGH — enabling `FORCE ROW LEVEL SECURITY` on live tables can deny
  every row (app appears broken) if the per-request GUCs aren't set on every
  query path. Touches the core db-access seam used by every procedure.
- **Depends on**: plan 007 (guards tests — the app-layer enforcement that is
  doing the real work today; keep it green as the safety net)
- **Category**: security
- **Planned at**: commit `2799b55`, 2026-06-12
- **Supersedes**: the "RLS absent from migrations" finding that an earlier pass
  *rejected*. That rejection was half-right (the policy CODE exists, so "write
  RLS from scratch" is not the task) and half-WRONG (the policies are never
  applied AND the GUCs are never set, so DB-level tenancy is in fact inactive).

## Why this matters — verified evidence (commit `2799b55`)

RLS is **fully implemented but doubly dormant**:

1. **Policies are never applied.** `packages/db/src/rls.ts` builds and can apply
   a complete policy set (`buildWorkspaceRlsStatements` / `applyWorkspaceRls`,
   runnable via the `pnpm rls` script = `with-env tsx src/rls.ts`). But:
   - `grep -rin "rls\|applyWorkspaceRls" .github/workflows` → **no match**. No
     CI/migration/deploy workflow runs it.
   - The committed Drizzle migrations contain zero `CREATE POLICY`
     (`grep -rl "CREATE POLICY" packages/db/drizzle` → none).
   - So unless someone has *manually* run `pnpm rls` against a given database,
     the policies do not exist there.

2. **The per-request GUCs the policies depend on are never set.** Every policy
   predicate reads `current_setting('app.user_id', true)` /
   `current_setting('app.workspace_id', true)`. But:
   - `getDatabaseSessionSettings` (`packages/db/src/tenant.ts:23`, the helper
     that produces those values) is referenced only by its own test
     (`grep -rln getDatabaseSessionSettings ... --include=*.ts` → only
     `__tests__/tenant.test.ts`).
   - Nothing runs `set_config` / `SET LOCAL` at runtime
     (`grep -rln "set_config\|SET LOCAL" packages/api/src packages/db/src apps`
     excluding rls/tenant builders → **nothing**).
   - `ctx.db` in `packages/api/src/trpc.ts` is the plain shared pooled client
     (`import { db } from "@sortey/db/client"`), not a tenant-scoped connection.

**Consequence:** DB-level tenant isolation is **not active**. The only thing
enforcing tenancy today is the app-layer tRPC guard chain
(`protectedProcedure → workspaceProcedure → tripProcedure`, now tested by plan
007). RLS is intended as the defense-in-depth backstop and is currently doing
nothing. Worse, naively enabling it (running `pnpm rls`) with the GUCs unset
would make `FORCE ROW LEVEL SECURITY` deny **all** rows and break the app.

## Why this is NOT auto-executable

Activating RLS correctly requires, in order:

1. **A tenant-scoped db execution path.** Every request's queries must run on a
   connection/transaction that has first executed
   `set_config('app.user_id', <uid>, true)` and
   `set_config('app.workspace_id', <wsid>, true)` (i.e. `SET LOCAL` inside a
   transaction, using `getDatabaseSessionSettings`). With a pooled client this
   means wrapping each request's data access in such a transaction (or leasing a
   dedicated connection). This changes how `ctx.db` works for **every
   procedure** — the highest-blast-radius change in the codebase.
2. **Applying the policies in a real pipeline** (a committed custom Drizzle
   migration that runs `buildWorkspaceRlsStatements`, OR a post-migrate deploy
   step running `pnpm rls`). The policies are idempotent (`DROP POLICY IF
   EXISTS` then `CREATE`), which helps.
3. **Confirming the prod DB role's RLS behavior** (owner + `FORCE` vs. a
   non-owner app role) so policies neither break the app nor are silently
   bypassed.
4. **A staged rollout** (enable on one low-risk table, verify reads/writes,
   then expand) with the app-layer guards kept as the safety net throughout.

Each of these is a design decision with failure modes that a cheap executor
cannot safely navigate. Hence: human decision first.

## Proposed phased approach (for discussion, once scope is approved)

- **Phase 0 (safe, no behavior change):** wire `getDatabaseSessionSettings`
  into a tenant-scoped db helper and route `ctx.db` through it so the GUCs are
  set per request — but do NOT enable any policy yet. Add tests proving the
  GUCs are set. This is the prerequisite and is independently reviewable.
- **Phase 1:** apply policies to ONE table behind a flag/env, in staging,
  verify the happy paths and the cross-tenant denials with an integration test.
- **Phase 2:** expand to the full `workspaceRlsTargets` set; wire application
  into the deploy/migration pipeline; document the operational runbook.
- **Throughout:** keep plan 007's guard tests green; RLS is additive, not a
  replacement for the app-layer checks.

## Interim recommendation (cheap, do regardless)

Even if full activation is deferred, **document the current reality** so nobody
assumes RLS is protecting them: add a one-paragraph note to `docs/ai/STATUS.md`
(or a SECURITY note) stating that DB-level RLS is implemented but not yet
applied/wired, and that app-layer tRPC guards are the sole tenancy enforcement
today. (This interim doc note is small and low-risk; it can be done now without
the full project.)

## STOP / decision gate

Do not begin Phase 0+ until a human has:
- confirmed they want to invest in activating RLS (vs. accepting app-layer
  guards as sufficient for now), and
- reviewed the Phase 0 db-seam design (it changes `ctx.db` for every
  procedure).
