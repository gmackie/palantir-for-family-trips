# Plan 013: Consolidate duplicated organizer/owner authorization checks

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` (add a row for the `hardening/` series if one doesn't
> exist yet) — unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**: `git diff --stat 0c1ffab..HEAD -- packages/api/src/router/expenses.ts packages/api/src/router/planning.ts packages/api/src/router/trips.ts packages/api/src/router/lodging.ts packages/api/src/router/pins.ts packages/api/src/router/rooms.ts packages/api/src/auth/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (this touches an authorization check in 5+ mutation paths across money, planning, trip-settings, lodging, and pins — a mistake here is a security regression, not just a bug; the done-criteria grep checks and the message-preservation requirement are the mitigation)
- **Depends on**: none (independent of plan 012 and plan 014; touches different code regions in the shared files, but do not run concurrently with plan 014 if that plan is also touching `expenses.ts` — check its status first)
- **Category**: tech-debt / security-hygiene
- **Planned at**: commit `0c1ffab`, 2026-07-19

## Why this matters

The "is this user an organizer, or the resource's owner/payer/creator"
check — the single most common authorization pattern in this codebase — is
implemented independently in five places, with five different error
messages and, in the lodging-vs-rooms case, two different `TRPCError` codes
for what is conceptually the same "this lodging isn't in this trip" check.
Drift like this is how authorization bugs get introduced: a future change
to the rule (e.g. "co-organizers should also pass") has to be found and
applied five times by hand, and nothing enforces that it was. This plan
extracts two small, pure helper functions plus a single `assertLodgingInTrip`
implementation, and repoints all five/two call sites at them — no behavior
change, message text preserved via parameters.

## Current state

**The "organizer or self/owner" check, reimplemented 3 ways + 2 inline:**

1. `packages/api/src/router/expenses.ts` lines 51-62 — `requireOrganizerOrSelf`:
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
   (Note: `expenses.ts`'s `assignLineItem` mutation, line 940+, uses a
   *different*, stricter organizer-only inline check at lines 951-956 — that
   one is plain `assertOrganizer`, not `assertOrganizerOrOwner`; do not
   merge it into `requireOrganizerOrSelf`'s call sites, only extract it as
   the separate `assertOrganizer` helper below.)

2. `packages/api/src/router/planning.ts` lines 17-24 — `requireOrganizer`
   (organizer-only, no owner exception):
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
   Called at `closePoll` (line 193), `updateProposalStatus` (line 436, only
   for `selected`/`rejected`), `confirmTrip` (line 525).

3. `packages/api/src/router/trips.ts` lines 280-287 — `requireOrganizerTripRole`
   (organizer-only, no owner exception, different message):
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
   Called from `updateTripRecord` (line 367).

4. `packages/api/src/router/lodging.ts` lines 324-327 (inline, inside
   `deleteLodging`) — organizer-or-creator:
   ```ts
   if (
     ctx.tripRole !== "organizer" &&
     existing.createdByUserId !== ctx.session.user.id
   ) {
     throw new TRPCError({
       code: "FORBIDDEN",
       message: "Only the creator or an organizer can delete this lodging.",
     });
   }
   ```
   and lines 363-366 (inline, inside `createTransit`) — organizer-or-self,
   but the "self" side compares against `input.userId` (the transit's
   subject), not the resource's creator:
   ```ts
   if (
     ctx.tripRole !== "organizer" &&
     input.userId !== ctx.session.user.id
   ) {
     throw new TRPCError({
       code: "FORBIDDEN",
       message: "Only organizers can add transits for other members.",
     });
   }
   ```

5. `packages/api/src/router/pins.ts` lines 221-228 (inline, inside
   `delete`) — organizer-or-creator:
   ```ts
   if (
     ctx.tripRole !== "organizer" &&
     existing.createdByUserId !== ctx.session.user.id
   ) {
     throw new TRPCError({
       code: "FORBIDDEN",
       message: "Only the creator or a trip organizer can delete this pin.",
     });
   }
   ```

**The duplicate `assertLodgingInTrip`, two implementations, two error codes:**

- `packages/api/src/router/lodging.ts` lines 66-88 — module-level, takes a
  raw `db` and a `{ segmentId: string }` shape, throws `NOT_FOUND` when the
  lodging's segment doesn't belong to the trip:
  ```ts
  export async function assertLodgingInTrip(
    db: any,
    lodging: { segmentId: string },
    tripId: string,
  ) {
    const [segment] = (await db
      .select({ id: tripSegments.id })
      .from(tripSegments)
      .where(
        and(
          eq(tripSegments.id, lodging.segmentId),
          eq(tripSegments.tripId, tripId),
        ),
      )
      .limit(1)) as { id: string }[];

    if (!segment) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Lodging not found." });
    }
  }
  ```
  Called at `updateLodging` (line 201) and `deleteLodging` (line 322).

- `packages/api/src/router/rooms.ts` lines 47-67 — takes a `RoomStore`
  (the store-interface pattern) and a `lodgingId: string`, throws
  `NOT_FOUND` if the lodging doesn't exist at all, then `BAD_REQUEST` if it
  exists but its segment isn't in the trip:
  ```ts
  export async function assertLodgingInTrip(
    store: RoomStore,
    lodgingId: string,
    tripId: string,
  ): Promise<void> {
    const lodging = await store.getLodgingSegment(lodgingId);
    if (!lodging) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Lodging not found." });
    }

    const belongs = await store.segmentBelongsToTrip({
      segmentId: lodging.segmentId,
      tripId,
    });
    if (!belongs) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Lodging does not belong to this trip.",
      });
    }
  }
  ```
  Used by `rooms.ts`'s own procedures via `assertRoomInTrip` (lines 70-82).

Two different signatures (raw `db` + already-fetched row vs. `RoomStore` +
bare id), two different behaviors for the "wrong trip" case (`NOT_FOUND` in
`lodging.ts`, `BAD_REQUEST` in `rooms.ts`). `lodging.ts`'s version is
explicitly documented as intentional ("Reports NOT_FOUND (not FORBIDDEN) so
cross-trip ids don't leak existence" — comment at lines 62-65) — that
existence-hiding intent should survive consolidation; `rooms.ts`'s
`BAD_REQUEST` for the same case does NOT hide existence (a `BAD_REQUEST`
with "does not belong to this trip" confirms the id is valid, just
cross-trip) — this is the actual behavioral drift, not just a naming
mismatch.

**Existing extraction precedent to follow:** `packages/api/src/trips/segment-guard.ts`
holds `validateSegmentBelongsToTrip`, extracted from `lodging.ts` by plan
002 (`plans/002-scope-trip-mutations-to-tenant.md`, MERGED) and now imported
by `lodging.ts` — same shape of refactor as this plan, same directory
convention (`packages/api/src/trips/` for cross-router trip-scoping
helpers) or `packages/api/src/auth/guards.ts` for role-based helpers. Put
the two new organizer helpers in `packages/api/src/auth/guards.ts`
(alongside `resolveTripAccess` etc. — same "authorization" concern) and the
merged `assertLodgingInTrip` in `packages/api/src/trips/segment-guard.ts`
(same file as its sibling `validateSegmentBelongsToTrip`, same "trip-scoping"
concern).

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|---------------------------------------|---------------------|
| Typecheck | `pnpm -F @sortey/api typecheck`      | exit 0               |
| Lint      | `pnpm -F @sortey/api lint`           | exit 0               |
| Test      | `pnpm -F @sortey/api test`           | all pass             |
| Format    | `pnpm format:check` (fix with `pnpm format:fix`) | exit 0 |

## Scope

**In scope** (the only files you should modify/create):
- `packages/api/src/auth/guards.ts` (add `assertOrganizer`, `assertOrganizerOrOwner`)
- `packages/api/src/trips/segment-guard.ts` (merge `assertLodgingInTrip` into one implementation)
- `packages/api/src/router/expenses.ts`
- `packages/api/src/router/planning.ts`
- `packages/api/src/router/trips.ts`
- `packages/api/src/router/lodging.ts`
- `packages/api/src/router/pins.ts`
- `packages/api/src/router/rooms.ts`
- `packages/api/src/router/__tests__/guards.test.ts` (create — no existing test file for `auth/guards.ts` per plan 014's finding; if plan 014 is running concurrently, coordinate to avoid a merge conflict on this file, or add just the two new function tests here and let plan 014 add the `resolveWorkspaceAccess`/`resolveTripAccess` tests separately)
- `packages/api/src/router/__tests__/tenant-scoping.test.ts` (extend — already has `assertLodgingInTrip` tests per plan 002; update for the merged signature)

**Out of scope** (do NOT touch, even though they look related):
- `packages/api/src/router/expenses.ts`'s `assignLineItem` inline organizer
  check (line 951-956) — replace it with the new `assertOrganizer` helper
  as part of Step 2, but do NOT change its message ("Only organizers can
  reassign line items for others.") or otherwise touch `assignLineItem`'s
  logic; that mutation's test coverage is plan 014's job, not this plan's.
- `rooms.ts`'s `RoomStore` interface and its other methods
  (`getRoomLodging`, `listRoomsForLodging`, etc.) — only `assertLodgingInTrip`
  and `assertRoomInTrip`'s internal call to it change.
- Any zod input schema or response shape.
- `packages/api/src/router/settlements.ts`'s `record`/`undo` — those don't
  have an organizer/owner check to consolidate (settlement recording is
  member-level, not organizer-gated); leave alone.

## Git workflow

- Branch: `advisor/013-consolidate-authorization-helpers`
- Commits:
  - `refactor(api): extract assertOrganizer/assertOrganizerOrOwner into auth/guards`
  - `refactor(api): merge duplicate assertLodgingInTrip into segment-guard`
  - `test(api): coverage for consolidated authorization helpers`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the two helpers to `auth/guards.ts`

Append to `packages/api/src/auth/guards.ts` (after the existing
`resolveTripAccess`, before the `workspaceProcedure`/`tripProcedure`
exports — keep the file's existing top-to-bottom order of "access
resolution" then "procedure builders"):

```ts
const DEFAULT_ORGANIZER_MESSAGE = "Only organizers can perform this action.";
const DEFAULT_ORGANIZER_OR_OWNER_MESSAGE =
  "Only the owner or a trip organizer can perform this action.";

/** Throws FORBIDDEN unless `tripRole` is "organizer". */
export function assertOrganizer(
  tripRole: TripMemberRole,
  message: string = DEFAULT_ORGANIZER_MESSAGE,
): void {
  if (tripRole !== "organizer") {
    throw new TRPCError({ code: "FORBIDDEN", message });
  }
}

/**
 * Throws FORBIDDEN unless `tripRole` is "organizer" OR `userId === ownerId`.
 * `ownerId` may be null (e.g. a nullable createdByUserId column) — a null
 * owner never matches, so only an organizer can act.
 */
export function assertOrganizerOrOwner(
  tripRole: TripMemberRole,
  ownerId: string | null,
  userId: string,
  message: string = DEFAULT_ORGANIZER_OR_OWNER_MESSAGE,
): void {
  if (tripRole === "organizer") return;
  if (ownerId !== null && ownerId === userId) return;
  throw new TRPCError({ code: "FORBIDDEN", message });
}
```

`TripMemberRole` is already imported in this file (line 3-4,
`type TripMemberRole`) — reuse it instead of the ad hoc
`"organizer" | "member"` union literal each call site currently spells out.

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0

### Step 2: Repoint the 5 organizer/owner call sites

For each site, delete the local function/inline check and call the new
helper with that site's exact original message so behavior (including
message text — some existing tests assert on it, e.g.
`expenses.test.ts` lines 221-228) is unchanged:

- `expenses.ts`: delete `requireOrganizerOrSelf` (lines 51-62); import
  `assertOrganizerOrOwner` from `../auth/guards`; replace call sites with
  `assertOrganizerOrOwner(tripRole, payerUserId, ctxUserId, "Only the payer or a trip organizer can modify this expense.")`
  — check the exact call-site argument names/order used today (`tripRole,
  payerUserId, ctxUserId`) and preserve the caller's argument values, just
  swap which function they call. Also replace `assignLineItem`'s inline
  check (lines 951-956) with
  `assertOrganizer(ctx.tripRole, "Only organizers can reassign line items for others.")`.
- `planning.ts`: delete `requireOrganizer` (lines 17-24); import
  `assertOrganizer` from `../auth/guards`; replace the three call sites
  (`closePoll` line 193, `updateProposalStatus` line 436, `confirmTrip` line
  525) with `assertOrganizer(ctx.tripRole, "Only organizers can perform this action.")`
  (same default message, so you can also just call `assertOrganizer(ctx.tripRole)`
  and rely on the default — pick whichever reads more clearly, they're
  behaviorally identical since the message matches the new default).
- `trips.ts`: delete `requireOrganizerTripRole` (lines 280-287); import
  `assertOrganizer` from `../auth/guards`; replace the call site (line 367)
  with `assertOrganizer(input.tripRole, "Only organizers can update trip settings.")`.
- `lodging.ts`: replace the inline check in `deleteLodging` (lines 324-327)
  with `assertOrganizerOrOwner(ctx.tripRole, existing.createdByUserId, ctx.session.user.id, "Only the creator or an organizer can delete this lodging.")`.
  Leave `createTransit`'s inline check (lines 363-366) alone — it is NOT an
  owner check (it compares against `input.userId`, the transit's *subject*,
  which the caller may be setting for someone else — there is no
  `createdByUserId` on the transit being created yet at check time). Forcing
  it into `assertOrganizerOrOwner` would misrepresent what's being checked;
  note this explicitly as "intentionally not consolidated" in your commit
  message so a future reviewer doesn't think it was missed.
- `pins.ts`: replace the inline check in `delete` (lines 221-228) with
  `assertOrganizerOrOwner(ctx.tripRole, existing.createdByUserId, ctx.session.user.id, "Only the creator or a trip organizer can delete this pin.")`.

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0 after each file; run all after finishing the set.

### Step 3: Merge `assertLodgingInTrip`

Keep `lodging.ts`'s raw-`db` signature and `NOT_FOUND`-on-any-mismatch
behavior as the canonical one (it's the one with the documented
existence-hiding rationale, and it's already exported and imported
elsewhere per plan 002's pattern). Move it into
`packages/api/src/trips/segment-guard.ts` next to
`validateSegmentBelongsToTrip`, keeping its exact signature and behavior:

```ts
export async function assertLodgingInTrip(
  db: any,
  lodging: { segmentId: string },
  tripId: string,
): Promise<void> {
  // body unchanged from lodging.ts:66-88
}
```

In `lodging.ts`, delete the local definition (lines 66-88) and import it
from `../trips/segment-guard` instead (matching the file's existing import
of `validateSegmentBelongsToTrip` from the same module, line 16).

In `rooms.ts`, `assertLodgingInTrip` (lines 47-67) has a genuinely different
call contract (`RoomStore` + bare `lodgingId`, not `db` + already-fetched
`{ segmentId }`) because `rooms.ts` follows the store-interface pattern
throughout. Do NOT force it onto the `lodging.ts` signature — that would
require threading a raw `db` through `RoomStore`-based call sites, which is
out of scope. Instead:

1. Rename `rooms.ts`'s local `assertLodgingInTrip` to
   `assertLodgingInTripViaStore` (keeps it distinguishable from the merged
   `segment-guard.ts` export at the call site and in stack traces).
2. Change its "wrong trip" branch to throw the same `NOT_FOUND` +
   `"Lodging not found."` as the canonical helper (matching existence-hiding
   behavior), instead of `BAD_REQUEST` + `"Lodging does not belong to this trip."`:
   ```ts
   if (!belongs) {
     throw new TRPCError({ code: "NOT_FOUND", message: "Lodging not found." });
   }
   ```
3. Add a one-line comment above the function noting it is the `RoomStore`-backed
   sibling of `packages/api/src/trips/segment-guard.ts`'s `assertLodgingInTrip`,
   kept separate because of the store-vs-raw-db signature difference, but now
   codes/messages-aligned.

Before landing the `BAD_REQUEST` → `NOT_FOUND` change in `rooms.ts`, grep
both apps for any code branching on the specific error code from a
`rooms.*` procedure (`grep -rn "BAD_REQUEST" apps/nextjs apps/expo` and
manually check any hits near room/lodging call sites) — if you find a
client branching on `BAD_REQUEST` specifically for this case, STOP (see
below) instead of changing the code.

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0; `grep -n "export async function assertLodgingInTrip" packages/api/src/router/lodging.ts` returns no matches (moved out); `grep -n "assertLodgingInTrip" packages/api/src/router/lodging.ts` shows an import.

### Step 4: Tests

- `packages/api/src/router/__tests__/guards.test.ts` (new): unit tests for
  `assertOrganizer` (organizer passes; member throws `FORBIDDEN` with
  default and custom messages) and `assertOrganizerOrOwner` (organizer
  passes regardless of owner; owner-matching non-organizer passes;
  non-owner non-organizer throws; `null` ownerId always throws for a
  non-organizer). Follow the plain-function-unit-test style already used in
  `expenses.test.ts`'s "role guards" `describe` block (lines 208-244) —
  no DB stub needed, these are pure functions.
- `packages/api/src/router/__tests__/tenant-scoping.test.ts`: update the
  existing `assertLodgingInTrip` tests (added by plan 002, currently
  importing from `lodging.ts` per that plan's Step 1 note — confirm the
  current import path before editing) to import from
  `../../trips/segment-guard` instead; behavior/assertions unchanged.
- Add a case (new file or extend `rooms.test.ts` if one exists — check
  first) for `assertLodgingInTripViaStore`'s wrong-trip case now returning
  `NOT_FOUND` instead of `BAD_REQUEST`.
- `expenses.test.ts`'s "role guards" describe block (lines 208-244) is
  confirmed to define its OWN local `requireOrganizerOrSelf` (lines 66-92 of
  that file) rather than importing the real one from `expenses.ts` — it is
  a decoy test, same class of issue as the `assignLineItem` decoy plan 014
  flags. It will keep passing unmodified after Step 2 regardless of what you
  do to the real `expenses.ts`, because it never touches the real code. Do
  NOT treat that as evidence the refactor is safe. Leave this file's local
  reimplementation alone (rewriting the test file to import and exercise the
  real `assertOrganizerOrOwner` is a testing-quality fix, not an
  authorization-consolidation task — it's plan 014's territory; flag it
  there if plan 014 hasn't already covered it) and instead rely on the new
  `guards.test.ts` (pure-function tests against the real, exported
  `assertOrganizer`/`assertOrganizerOrOwner`) as this plan's actual
  regression coverage.

**Verify**: `pnpm -F @sortey/api test` → all pass

### Step 5: Full package check

**Verify**: `pnpm -F @sortey/api test` → all pass; `pnpm -F @sortey/api lint` → exit 0; `pnpm -F @sortey/api typecheck` → exit 0; `pnpm format:check` → exit 0 (run `pnpm format:fix` if not)

## Test plan

See Step 4. New pure-function tests for the two helpers
(`guards.test.ts`), updated tests for the merged `assertLodgingInTrip`
(`tenant-scoping.test.ts`), and a new/extended test for
`assertLodgingInTripViaStore`'s corrected error code. All five call-site
routers' existing test suites (`expenses.test.ts`, `planning.test.ts` if it
has organizer-check coverage, `trips.test.ts`, `lodging.test.ts`/`rooms.test.ts`
if they exist, `pins.test.ts` if created by plan 012) must continue passing
unmodified except where they assert on now-relocated function names.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm -F @sortey/api typecheck` exits 0
- [ ] `pnpm -F @sortey/api lint` exits 0
- [ ] `pnpm -F @sortey/api test` exits 0
- [ ] `grep -rn "function requireOrganizer\b" packages/api/src/router/planning.ts` returns no matches
- [ ] `grep -rn "function requireOrganizerTripRole" packages/api/src/router/trips.ts` returns no matches
- [ ] `grep -rn "function requireOrganizerOrSelf" packages/api/src/router/expenses.ts` returns no matches
- [ ] `grep -rn "export async function assertLodgingInTrip" packages/api/src/router/lodging.ts` returns no matches
- [ ] `grep -c "assertOrganizer\|assertOrganizerOrOwner" packages/api/src/auth/guards.ts` ≥ 2 (both exported)
- [ ] All five original error messages appear unchanged somewhere in the diff (`git diff` for each site shows the same string literal passed as the `message` argument)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any excerpt above doesn't match the live code.
- `rooms.ts`'s `assertLodgingInTripViaStore` BAD_REQUEST→NOT_FOUND change is
  found to be branched on by any client code (see Step 3's grep
  instruction) — report the finding instead of changing the code, and note
  it in the plan's backlog for a follow-up that also updates the client.
- `lodging.ts`'s `createTransit` inline check turns out to have a
  same-shape sibling elsewhere that WOULD consolidate cleanly with
  `assertOrganizerOrOwner` (re-read it carefully — it compares against
  `input.userId`, not a resource owner, which is why this plan leaves it
  alone; if that reading is wrong, stop and re-scope rather than force a
  bad abstraction).
- Any existing test is found to import the real guard function by name
  (rather than redefining a local copy, as confirmed for
  `expenses.test.ts:66` and `planning.test.ts:63` — both are decoys that
  redefine `requireOrganizerOrSelf`/`requireOrganizer` locally and never
  import the real symbol, so removing the real functions is safe for
  compilation but does NOT mean those tests exercised the change; do not
  mistake their continued passing for regression coverage) — if a test file
  you touch turns out to import the real symbol, update the import to the
  new helper name and re-verify the assertions still hold with the new
  signature order.

## Maintenance notes

- `assertOrganizer`/`assertOrganizerOrOwner` now live in
  `packages/api/src/auth/guards.ts` alongside `resolveTripAccess` — the
  natural place for any *future* organizer-adjacent rule (e.g. "co-organizer"
  role) to be added once, rather than hunted down across routers again.
- The `lodging.ts` vs `rooms.ts` `assertLodgingInTrip` split (raw-`db` vs
  `RoomStore`) reflects a broader inconsistency: `rooms.ts` uses the
  store-interface pattern (like `settlements.ts`, `fuel-logs.ts`) and
  `lodging.ts` does not. Unifying `lodging.ts` onto a store interface is a
  larger, separate refactor — not in scope here, but worth a future plan if
  the router keeps growing (639 lines today).
- Reviewer focus: message-text parity per site (grep for the five original
  strings above, confirm each survives in the diff verbatim) and the two
  intentionally-NOT-consolidated inline checks (`createTransit` in
  `lodging.ts`, and any others found during Step 2 that don't fit the
  owner-vs-organizer shape).
