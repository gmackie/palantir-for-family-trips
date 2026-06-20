# Plan 013: Add an end-to-end Playwright test for the trip → expense → claim → settle flow

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat bbc54f6..HEAD -- apps/nextjs/playwright.config.ts apps/nextjs/e2e`
> Compare against "Current state" before proceeding; on a mismatch, treat it
> as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (e2e tests are environment-sensitive; may need seed/auth helpers)
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `bbc54f6`, 2026-06-12

## Why this matters

The money path — create a trip, add a finalized expense with line items, a
member claims a line item, then settlement is recorded — is the product's core
value and its highest-stakes correctness surface (currency handling,
settlement math). Today the only e2e specs are `home.spec.ts` and
`sign-in.spec.ts`; there is zero automated coverage of the expense/settlement
flow end to end. One characterization e2e test catches regressions that unit
tests on isolated routers miss (routing, auth wiring, serialization).

## Current state

- Playwright is configured at `apps/nextjs/playwright.config.ts`.
- Existing specs live in `apps/nextjs/e2e/` (`home.spec.ts`,
  `sign-in.spec.ts`). **Read both before writing** — they show: how the
  `baseURL`/webServer is configured, how the app is launched for tests, and
  most importantly **how authentication is handled in the e2e environment**
  (look for a dev-login route, a storage-state/session fixture, or a
  test-only auth bypass). Reuse that exact mechanism — do not invent a new one.
- Determine the e2e run command from `apps/nextjs/package.json` scripts
  (likely `pnpm -F @sortey/nextjs test:e2e` or `pnpm -F @sortey/nextjs exec
  playwright test`). Record the exact command you find.
- The data layer needs seeding for a deterministic flow. Check how
  `sign-in.spec.ts` obtains a usable account and whether a seed/dev route
  exists (the repo has `/api/dev/*` routes per its dev tooling). If a
  programmatic seed/login path exists, use it; if the only path is driving the
  full UI, drive the UI.

## Commands you will need

| Purpose   | Command                                  | Expected on success |
|-----------|------------------------------------------|---------------------|
| Install   | `pnpm install`                           | exit 0              |
| List e2e tests | `pnpm -F @sortey/nextjs exec playwright test --list` | the new spec is listed |
| Run e2e (the repo's script) | `<command from package.json>` | new test passes (or see STOP) |
| Typecheck | `pnpm -F @sortey/nextjs typecheck`       | exit 0              |

## Scope

**In scope**:
- `apps/nextjs/e2e/expense-settlement.spec.ts` (create)
- A small e2e helper file under `apps/nextjs/e2e/` ONLY if the existing specs
  established a helper pattern you are extending (e.g. a shared login fixture).

**Out of scope** (do NOT touch):
- Application source under `apps/nextjs/src` and `packages/` — this plan adds a
  test, not a feature. If the flow can't be tested without a product change,
  STOP and report (don't add a test-only backdoor route unless one already
  exists and is the established e2e auth mechanism).
- `playwright.config.ts` — reuse the existing config; change it only if the new
  spec genuinely cannot run without a config addition, and if so, keep the
  change minimal and call it out.

## Git workflow

- Work on the current branch.
- Commit style: `test(e2e): cover trip → expense → claim → settle flow`.
- Do NOT push or open a PR.

## Steps

### Step 1: Learn the e2e auth + seeding mechanism

Read `apps/nextjs/e2e/sign-in.spec.ts` and `home.spec.ts` and
`playwright.config.ts`. Identify: the run command, the auth mechanism, and how
a test reaches an authenticated app state.

**Verify**: you can state the exact e2e run command and the auth approach in a
comment at the top of the new spec.

### Step 2: Write the flow spec

Create `apps/nextjs/e2e/expense-settlement.spec.ts` that, reusing the
established auth/seed mechanism:
1. Authenticates as a trip organizer.
2. Creates (or seeds) a trip with at least two members.
3. Adds an expense, finalizes it, and adds at least one line item.
4. As a member, claims the line item.
5. Records a settlement between two members.
6. Asserts the settlement appears with the correct amount and currency, and
   that claimed/settled state is reflected in the UI.

Prefer selated, resilient selectors (roles/labels/test-ids) over brittle text.
If the app exposes `data-testid` attributes, use them; otherwise use
accessible roles/names as the existing specs do.

**Verify**: `pnpm -F @sortey/nextjs exec playwright test --list` includes the
new spec; `pnpm -F @sortey/nextjs typecheck` → exit 0.

### Step 3: Run the test

Run the repo's e2e command for just this spec.

**Verify**: the new spec passes.

## Test plan

- One new spec, `apps/nextjs/e2e/expense-settlement.spec.ts`, structured like
  `sign-in.spec.ts`.
- Verification: the repo's e2e run command → the new spec passes; the existing
  specs still pass.

## Done criteria

- [ ] `apps/nextjs/e2e/expense-settlement.spec.ts` exists
- [ ] `pnpm -F @sortey/nextjs exec playwright test --list` lists it
- [ ] `pnpm -F @sortey/nextjs typecheck` exits 0
- [ ] The new spec passes when run with the repo's e2e command
- [ ] No application source files modified (`git status` shows only the new spec, and any reused e2e helper)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The e2e environment cannot be brought up in your sandbox (no DB, no browser
  binary, webServer won't start). In that case: still create the spec, ensure
  it compiles and is listed by `--list`, document in the plan's status row that
  full execution requires CI, and report — do NOT fake a pass.
- Testing the flow would require adding a test-only backdoor that does not
  already exist.
- The existing specs reveal no usable auth mechanism for an authenticated flow.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Currency handling is a known sharp edge (settlement refuses mixed
  currencies). A reviewer should confirm the spec uses a single-currency trip
  so it tests the happy path, and consider a follow-up spec for the
  mixed-currency rejection.
- If the UI's selectors are brittle, a follow-up should add stable
  `data-testid`s rather than loosening the assertions.
