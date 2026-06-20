# Plan 010: Consolidate the three duplicated organizer-check helpers into one shared module

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat bbc54f6..HEAD -- packages/api/src/router/planning.ts packages/api/src/router/expenses.ts packages/api/src/router/trips.ts`
> Compare against "Current state" before proceeding; on a mismatch, treat it
> as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED (touches three high-traffic routers; must preserve exact error messages)
- **Depends on**: plans/007-guards-direct-tests.md (soft — land 007 first for a safety net)
- **Category**: tech-debt
- **Planned at**: commit `bbc54f6`, 2026-06-12

## Why this matters

Three near-identical organizer-authorization helpers are defined locally in
three routers, each re-implementing the same `FORBIDDEN` throw:

- `requireOrganizer` (`planning.ts:17`) — throw unless `tripRole ===
  "organizer"`. Message: "Only organizers can perform this action."
- `requireOrganizerTripRole` (`trips.ts:207`) — **identical logic**, message:
  "Only organizers can update trip settings."
- `requireOrganizerOrSelf` (`expenses.ts:30`) — organizer OR the resource
  owner, else `FORBIDDEN`. Message: "Only the payer or a trip organizer can
  modify this expense."

Three copies of an authorization primitive means a fix or hardening has to be
made in three places and can drift. Consolidating into one audited module makes
the authorization surface reviewable in one spot. **The user-visible error
messages must not change** — they are part of the API contract and may be
asserted by tests.

## Current state

### `planning.ts:17`
```ts
function requireOrganizer(tripRole: "organizer" | "member") {
  if (tripRole !== "organizer") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only organizers can perform this action.",
    });
  }
}
```
Used 3× elsewhere in `planning.ts` as `requireOrganizer(role)`.

### `trips.ts:207`
```ts
function requireOrganizerTripRole(tripRole: "organizer" | "member") {
  if (tripRole !== "organizer") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only organizers can update trip settings.",
    });
  }
}
```
Used multiple times in `trips.ts` as `requireOrganizerTripRole(role)`.

### `expenses.ts:30`
```ts
function requireOrganizerOrSelf(
  tripRole: "organizer" | "member",
  payerUserId: string,
  ctxUserId: string,
) {
  if (tripRole === "organizer") return;
  if (payerUserId === ctxUserId) return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "Only the payer or a trip organizer can modify this expense.",
  });
}
```
Used multiple times in `expenses.ts`.

Existing auth module location: `packages/api/src/auth/` (contains `guards.ts`).
Put the shared helpers there.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Install   | `pnpm install`                   | exit 0              |
| Typecheck | `pnpm -F @sortey/api typecheck`  | exit 0, no errors   |
| Tests     | `pnpm -F @sortey/api test`       | all pass            |
| Lint      | `pnpm -F @sortey/api lint`       | exit 0              |

## Scope

**In scope**:
- `packages/api/src/auth/organizer.ts` (create — the shared helpers)
- `packages/api/src/router/planning.ts` (remove local def, import)
- `packages/api/src/router/expenses.ts` (remove local def, import)
- `packages/api/src/router/trips.ts` (remove local def, import/alias)
- `packages/api/src/auth/__tests__/organizer.test.ts` (create — small unit test)

**Out of scope** (do NOT touch):
- `guards.ts` and the `tripProcedure`/`workspaceProcedure` middleware chain —
  that is a different layer; this plan only de-dups the organizer leaf checks.
- The call sites' surrounding logic — only the helper definitions and imports
  change; the call expressions stay behaviorally identical.

## Git workflow

- Work on the current branch.
- Commit style: `refactor(api): consolidate organizer-check helpers into auth/organizer.ts`.
- Do NOT push or open a PR.

## Steps

### Step 1: Create the shared module

Create `packages/api/src/auth/organizer.ts`:

```ts
import { TRPCError } from "@trpc/server";

export type TripRole = "organizer" | "member";

export function requireOrganizer(
  tripRole: TripRole,
  message = "Only organizers can perform this action.",
): void {
  if (tripRole !== "organizer") {
    throw new TRPCError({ code: "FORBIDDEN", message });
  }
}

export function requireOrganizerOrSelf(
  tripRole: TripRole,
  resourceOwnerUserId: string,
  ctxUserId: string,
  message = "Only the payer or a trip organizer can modify this expense.",
): void {
  if (tripRole === "organizer") return;
  if (resourceOwnerUserId === ctxUserId) return;
  throw new TRPCError({ code: "FORBIDDEN", message });
}
```

(Match the existing `TRPCError` import path used in the routers — confirm it is
`@trpc/server` by checking the top of `planning.ts`.)

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0.

### Step 2: Switch planning.ts

Delete the local `requireOrganizer` definition; add
`import { requireOrganizer } from "../auth/organizer";` (match the repo's
relative-import style). Call sites are unchanged — they already call
`requireOrganizer(role)`, and the default message matches the old one exactly.

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0.

### Step 3: Switch expenses.ts

Delete the local `requireOrganizerOrSelf` definition; import it from
`../auth/organizer`. Call sites unchanged; default message matches.

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0.

### Step 4: Switch trips.ts

Delete the local `requireOrganizerTripRole` definition. To preserve its
custom message AND every existing call site verbatim, add a thin local alias:

```ts
import { requireOrganizer } from "../auth/organizer";

const requireOrganizerTripRole = (tripRole: "organizer" | "member") =>
  requireOrganizer(tripRole, "Only organizers can update trip settings.");
```

This removes the duplicated throw logic while keeping `trips.ts`'s call sites
and error message identical.

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0.

### Step 5: Unit-test the shared module + full gate

Create `packages/api/src/auth/__tests__/organizer.test.ts` (include the
`process.env.DATABASE_URL ??=` preamble only if importing pulls in the db
client — `organizer.ts` itself doesn't, so it may be unnecessary; add it if the
import chain complains). Cases:
- `requireOrganizer("organizer")` → no throw.
- `requireOrganizer("member")` → throws `{ code: "FORBIDDEN" }` with the
  default message.
- `requireOrganizer("member", "custom")` → message is `"custom"`.
- `requireOrganizerOrSelf("member", "u1", "u1")` → no throw (self).
- `requireOrganizerOrSelf("member", "u1", "u2")` → throws `FORBIDDEN`.
- `requireOrganizerOrSelf("organizer", "u1", "u2")` → no throw.

**Verify**: `pnpm -F @sortey/api test` → all pass;
`pnpm -F @sortey/api lint` → exit 0.

## Test plan

- New `organizer.test.ts` with the six cases above.
- The existing router test suites (`planning`/`expenses`/`trips` tests, if any)
  must still pass unchanged — they are the regression proof that messages and
  behavior didn't shift.
- Verification: `pnpm -F @sortey/api test` → all pass.

## Done criteria

- [ ] `packages/api/src/auth/organizer.ts` exists and is imported by all three routers
- [ ] `grep -rn "function requireOrganizer\|function requireOrganizerTripRole\|function requireOrganizerOrSelf" packages/api/src/router/` returns NO matches (all local defs removed)
- [ ] The three messages are unchanged: `grep -rn "Only organizers can perform this action\|Only organizers can update trip settings\|Only the payer or a trip organizer" packages/api/src` still finds all three strings
- [ ] `pnpm -F @sortey/api typecheck` exits 0; `pnpm -F @sortey/api test` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any of the three local helpers differs from the "Current state" excerpts (drift).
- A call site passes arguments that don't fit the consolidated signatures
  (e.g. a fourth variant exists that this plan didn't account for).
- Removing a local def breaks an existing test's asserted message — that means
  the consolidation changed behavior; stop and reconcile.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- New routers needing an organizer gate should import from `auth/organizer.ts`,
  not re-define a local helper. A reviewer should reject new local copies.
- If a future requirement needs role hierarchy beyond organizer/member, this is
  the one place to extend.
