# Plan 004: Enforce the trip status state machine server-side

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2408b3e..HEAD -- packages/api/src/router/trips.ts packages/api/src/trips/ packages/api/src/router/__tests__/trips.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED (a missing edge in the transition map would block a legitimate UI flow — mitigated by Step 1's call-site inventory)
- **Depends on**: none (coordinate with plan 003 if both touch `trips.test.ts` simultaneously)
- **Category**: bug
- **Planned at**: commit `2408b3e`, 2026-06-12

## Why this matters

The trip lifecycle is documented as `planning → confirmed → active → completed` (CLAUDE.md), and the enum has since grown two road-trip driving states, `en_route` and `paused`. But `trips.setStatus` accepts **any** enum value and writes it directly — nothing stops `completed → planning` or `planning → en_route`. Features branch on status (dashboard vs. planning view, Driving Mode, lock-in wizard), so a nonsense jump silently corrupts what users see. The fix is a small transition map checked in one function that all status writes already flow through.

## Current state

- `packages/db/src/schema.ts:12-20`:

```ts
export const tripStatusEnum = [
  "planning",
  "confirmed",
  "active",
  "en_route",
  "paused",
  "completed",
] as const;
```

- `packages/api/src/router/trips.ts:899-914` — `setStatus` procedure: organizer-gated via `updateTripRecord`, no transition check:

```ts
setStatus: tripProcedure()
  .input(
    z.object({
      workspaceId: z.string().min(1),
      tripId: z.string().min(1),
      status: z.enum(tripStatusEnum),
    }),
  )
  .mutation(({ ctx, input }) =>
    updateTripRecord(createTripStore(ctx.db), { ...ctx-fields, status: input.status }),
  ),
```

- `packages/api/src/router/trips.ts:276-310` — `updateTripRecord(store, input)`: calls `requireOrganizerTripRole(input.tripRole)` then `store.updateTrip(input)`. It is the single funnel for status writes from `setStatus` (and also handles non-status field updates — the check must only run when `input.status` is present). Note: `planning.ts` also has an `update(trips)` call near line 556 (the lock-in wizard) — Step 1 must check whether it writes `status` directly, bypassing this funnel.
- `updateTripRecord` does NOT currently read the trip's existing status — enforcing transitions requires the current status. `TripStore` (same file) is the store interface; `trips.test.ts` builds it in memory.
- Domain context (CONTEXT.md): `en_route`/`paused` belong to road-trip Driving Mode — "Side Trip: the user can pause the trip to explore freely … Resume picks up from the pause point". `completed` is terminal. The lock-in wizard moves `planning → confirmed`.

**Proposed transition map** (executor: validate against Step 1's findings before hardcoding):

| From | Allowed to |
|------|-----------|
| planning | confirmed |
| confirmed | planning, active |
| active | en_route, completed |
| en_route | paused, active, completed |
| paused | en_route, active, completed |
| completed | (none — terminal) |

Same-state writes (`status` equal to current) should be allowed as no-ops to keep idempotent clients working.

## Commands you will need

| Purpose   | Command                                                            | Expected on success |
|-----------|--------------------------------------------------------------------|---------------------|
| Typecheck | `pnpm turbo run typecheck -F @sortey/api`                          | exit 0              |
| Lint/Format | `pnpm turbo run lint -F @sortey/api` / `pnpm format:check`       | exit 0              |
| Tests     | `pnpm --filter @sortey/api exec vitest run src/trips/__tests__/status-transitions.test.ts src/router/__tests__/trips.test.ts` | all pass |

## Scope

**In scope** (the only files you should modify/create):
- `packages/api/src/trips/status-transitions.ts` (create — pure transition map + `assertValidTripStatusTransition(from, to)`)
- `packages/api/src/trips/__tests__/status-transitions.test.ts` (create)
- `packages/api/src/router/trips.ts` (wire the check into `updateTripRecord`; extend `TripStore` only if a `getTripStatus`-style read is genuinely missing)
- `packages/api/src/router/__tests__/trips.test.ts` (extend the in-memory store + add transition cases)
- `packages/api/src/router/planning.ts` — ONLY if Step 1 finds it writes `status` directly; route it through the same assertion.

**Out of scope** (do NOT touch):
- `packages/db/src/schema.ts` — the enum is correct; do not add a DB CHECK constraint here.
- Frontend status pickers (`apps/nextjs`, `apps/expo`) — clients keep sending what they send; the server now rejects invalid jumps with a clear error they can already render (TRPCError surfaces exist).
- `tripStatusEnum` values or their meanings.

## Git workflow

- Branch: `advisor/004-trip-status-transitions`
- Commits: `fix(api): enforce trip status transition map in updateTripRecord` + `test(api): trip status transition coverage`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Inventory every status write and every UI transition

- `grep -rn "setStatus\|status:" apps/nextjs/src/app/trips apps/expo/src/app/trip --include="*.tsx" --include="*.ts" | grep -iv "statusColor\|status ===" ` and read the hits that call the tRPC `setStatus` mutation. List each (from-state context → to-state).
- `grep -n "update(trips)" packages/api/src/router/*.ts` — for each hit (known: `planning.ts:~556`), check whether `status` is in the `.set()` payload and from which state to which.
- Compare the collected real transitions against the proposed map above. If a real flow needs an edge the map lacks, add that edge and note it in your report. If a real flow performs a jump that is clearly invalid (e.g. completed → active), STOP and report.

**Verify**: written inventory in your report; no code changed yet.

### Step 2: Create the pure transition module

`packages/api/src/trips/status-transitions.ts`:

- Export `TRIP_STATUS_TRANSITIONS: Record<TripStatus, readonly TripStatus[]>` (import `TripStatus` from `@sortey/db/schema`).
- Export `isValidTripStatusTransition(from: TripStatus, to: TripStatus): boolean` (true when `from === to`).
- Export `assertValidTripStatusTransition(from, to)` that throws `new TRPCError({ code: "BAD_REQUEST", message: \`Cannot move trip from ${from} to ${to}.\` })`.

**Verify**: `pnpm turbo run typecheck -F @sortey/api` → exit 0

### Step 3: Wire into `updateTripRecord`

In `updateTripRecord` (`trips.ts:276-310`), when `input.status` is defined:

1. Read the trip's current status. Check whether `TripStore` already exposes a read that returns status (look at the interface near the top of `trips.ts` and at `store.updateTrip`); if not, add a minimal `getTripStatus({ workspaceId, tripId }): Promise<TripStatus | null>` to the interface and to `createTripStore`.
2. If the trip is not found → existing `NOT_FOUND` path.
3. `assertValidTripStatusTransition(current, input.status)` before calling `store.updateTrip`.

If Step 1 found `planning.ts` writing status directly, apply the same assertion there using its current-state read.

**Verify**: `pnpm turbo run typecheck -F @sortey/api` → exit 0; `pnpm --filter @sortey/api exec vitest run src/router/__tests__/trips.test.ts` → existing tests pass (extend the in-memory `TripStore` in the test file with the new method if you added one — note `trips.test.ts:23` has a local 4-value `TripStatus` type that may need the two new states).

### Step 4: Tests

- `src/trips/__tests__/status-transitions.test.ts`: every allowed edge returns true; a representative set of disallowed edges throws (`completed → *`, `planning → active`, `planning → en_route`, `active → planning`); same-state is allowed.
- Extend `src/router/__tests__/trips.test.ts`: through `updateTripRecord` with the in-memory store — valid transition updates; invalid transition throws BAD_REQUEST and does NOT call `store.updateTrip`; status-less updates (name/dates) skip the check entirely.

**Verify**: `pnpm --filter @sortey/api test` → all pass

## Test plan

Covered in Step 4; pattern file `packages/api/src/router/__tests__/trips.test.ts` (in-memory `TripStore`).

## Done criteria

- [ ] `packages/api/src/trips/status-transitions.ts` exists; map matches the table above plus any Step 1 additions (documented in the file header)
- [ ] `updateTripRecord` rejects invalid jumps with `BAD_REQUEST`; status-less updates unaffected
- [ ] `pnpm --filter @sortey/api test` exits 0 with the new tests
- [ ] `pnpm turbo run typecheck -F @sortey/api` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1 finds a shipped UI flow performing a transition the proposed map forbids and it isn't obviously a bug — the map needs a product decision, not a guess.
- `updateTripRecord` turns out not to be the only status write path and the other path can't take the same assertion mechanically.
- Reading current status requires an extra query per *non-status* update (it must not — gate the read on `input.status !== undefined`).

## Maintenance notes

- When new statuses are added to `tripStatusEnum`, the `Record<TripStatus, ...>` type makes the build fail until the map is extended — intentional.
- The Driving Mode feature (CONTEXT.md "Side Trip", "Stopped Mode") will likely automate `active ↔ en_route ↔ paused` from GPS speed; those writers must go through the same assertion.
- Deferred: surfacing the allowed next-states to clients (e.g. a `trips.allowedTransitions` query) so UIs can disable invalid buttons instead of catching errors.
