# Plan 002: Close cross-trip IDOR holes in itinerary, lodging, and photo-reaction mutations

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2408b3e..HEAD -- packages/api/src/router/itinerary.ts packages/api/src/router/lodging.ts packages/api/src/router/photos.ts packages/api/src/trips/ packages/api/src/router/__tests__/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `2408b3e`, 2026-06-12

## Why this matters

This is a multi-tenant app (Workspace ⊃ Trip ⊃ Segments). The `tripProcedure()` middleware verifies the caller is a member of the trip named in the request input, but several mutations then act on a row fetched **by bare id only**, never checking that the row belongs to that trip. Any authenticated trip member who obtains (or guesses) another trip's row UUID can delete itinerary events, modify or delete lodgings, and attach reactions across trips. Object ids are UUIDs, so practical exploitability is limited, but this is a tenant-isolation defect in defensive-maintenance terms, and the codebase already has the correct pattern (pins, chat, expenses, planning, van-profiles all scope correctly) — these are the stragglers.

## Current state

`tripProcedure()` (defined in `packages/api/src/auth/guards.ts`) puts the verified `ctx.tripId` on the context; every handler below already has it available.

**Affected sites (verified at commit 2408b3e):**

1. `packages/api/src/router/itinerary.ts:89-111` — `delete` removes by bare event id:

```ts
.mutation(async ({ ctx, input }) => {
  const [deleted] = (await ctx.db
    .delete(itineraryEvents)
    .where(eq(itineraryEvents.id, input.eventId))   // no tripId scope
    .returning()) as Array<typeof itineraryEvents.$inferSelect>;
```

2. `packages/api/src/router/itinerary.ts:29-69` — `create` accepts an optional `segmentId` (line 34) and inserts it (line 59: `segmentId: input.segmentId ?? null`) without checking the segment belongs to `ctx.tripId`.

3. `packages/api/src/router/lodging.ts:145-186` — `updateLodging` updates by bare lodging id:

```ts
const { lodgingId, workspaceId, tripId, ...changes } = input;
const [updated] = (await ctx.db
  .update(lodgings)
  .set(changes)
  .where(eq(lodgings.id, lodgingId))   // no trip scope
  .returning()) as (typeof lodgings.$inferSelect)[];
```

4. `packages/api/src/router/lodging.ts:262-299` — `deleteLodging` fetches `lodgings` by bare id (`.where(eq(lodgings.id, input.lodgingId))`), checks creator/organizer of the *caller's* trip, then deletes — an organizer of any trip can delete any lodging.

5. `packages/api/src/router/photos.ts:171-213` — `react` toggles a `photoReactions` row keyed by `input.photoId` without verifying the photo belongs to `ctx.tripId`. (For contrast, `photos.delete` at lines 214+ correctly scopes with `and(eq(tripPhotos.id, input.photoId), eq(tripPhotos.userId, ...))`.)

**Important schema fact**: `lodgings` rows do NOT have a `tripId` column — they link to a trip via `segmentId` → `tripSegments.tripId`. Scoping a lodging means checking its segment's trip.

**The existing correct patterns to copy:**

- Scoped delete with pre-fetch — `packages/api/src/router/pins.ts:205-238` (`delete`): select the row `where(and(eq(pins.id, input.pinId), eq(pins.tripId, ctx.tripId)))`, throw `NOT_FOUND` if missing, then role-check, then delete.
- Segment-ownership validation — `packages/api/src/router/lodging.ts:60-77`:

```ts
async function validateSegmentBelongsToTrip(
  db: any,
  segmentId: string,
  tripId: string,
) {
  const [segment] = (await db
    .select({ id: tripSegments.id })
    .from(tripSegments)
    .where(and(eq(tripSegments.id, segmentId), eq(tripSegments.tripId, tripId)))
    .limit(1)) as { id: string }[];

  if (!segment) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Segment does not belong to this trip.",
    });
  }
}
```

Conventions: Drizzle operators imported from `@sortey/db`; errors are `TRPCError` with `NOT_FOUND` / `BAD_REQUEST` / `FORBIDDEN`; conventional commits with scope (`fix(api): ...`, recent example in history: `harden(api): gas-split expense inherits the trip's currency`).

## Commands you will need

| Purpose   | Command                                                            | Expected on success |
|-----------|--------------------------------------------------------------------|---------------------|
| Typecheck | `pnpm turbo run typecheck -F @sortey/api`                          | exit 0              |
| Lint      | `pnpm turbo run lint -F @sortey/api`                               | exit 0              |
| Format    | `pnpm format:check` (fix with `pnpm format:fix`)                   | exit 0              |
| Tests     | `pnpm --filter @sortey/api test`                                   | all pass            |

## Scope

**In scope** (the only files you should modify/create):
- `packages/api/src/router/itinerary.ts`
- `packages/api/src/router/lodging.ts`
- `packages/api/src/router/photos.ts`
- `packages/api/src/trips/segment-guard.ts` (create — shared helper)
- `packages/api/src/router/__tests__/tenant-scoping.test.ts` (create)

**Out of scope** (do NOT touch, even though they look related):
- `packages/api/src/auth/guards.ts` — the middleware chain is correct; the gap is per-row scoping, not trip access.
- `packages/api/src/router/pins.ts`, `chat.ts`, `expenses.ts`, `planning.ts`, `van-profiles.ts`, `fuel-logs.ts` — verified correctly scoped during the audit; leave them alone.
- Database schema / RLS policies (`packages/db/src/`) — DB-level enforcement is a separate, larger effort tracked in the audit backlog.
- Input zod schemas' field names — clients depend on them.

## Git workflow

- Branch: `advisor/002-tenant-scope-mutations`
- Commits: e.g. `fix(api): scope itinerary/lodging/photo mutations to the authorized trip`, `test(api): cross-trip access regression coverage`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Promote `validateSegmentBelongsToTrip` to a shared module

Create `packages/api/src/trips/segment-guard.ts` containing the helper exactly as it exists in `lodging.ts:60-77` (typed `db` parameter as the lodging file types its db usage — if it uses `any`, keep `any` to match; do not redesign). Export it. In `lodging.ts`, delete the local copy and import from `../trips/segment-guard`. All seven existing call sites in `lodging.ts` keep working unchanged.

**Verify**: `pnpm turbo run typecheck -F @sortey/api` → exit 0

### Step 2: Fix `itinerary.ts`

- `create`: when `input.segmentId` is provided, call `await validateSegmentBelongsToTrip(ctx.db, input.segmentId, ctx.tripId)` before the insert.
- `delete`: change the where clause to `and(eq(itineraryEvents.id, input.eventId), eq(itineraryEvents.tripId, ctx.tripId))` (add `and` to the `@sortey/db` import). The existing `NOT_FOUND` throw when nothing is returned already gives the right behavior for cross-trip ids.

**Verify**: `pnpm turbo run typecheck -F @sortey/api` → exit 0

### Step 3: Fix `lodging.ts`

Lodgings scope via their segment. For both `updateLodging` and `deleteLodging`:

1. Fetch the lodging's `id`, `segmentId`, and `createdByUserId` by `eq(lodgings.id, input.lodgingId)` (deleteLodging already fetches; extend its select with `segmentId`).
2. If not found → `NOT_FOUND` (existing behavior in delete; add it to update).
3. `await validateSegmentBelongsToTrip(ctx.db, lodging.segmentId, ctx.tripId)` — but throw `NOT_FOUND` semantics are fine too; prefer rethrowing the helper's `BAD_REQUEST`? No: for these two sites, a cross-trip lodging should read as `NOT_FOUND` to avoid confirming the id exists. Wrap the check: select the segment scoped to `ctx.tripId` and throw `new TRPCError({ code: "NOT_FOUND", message: "Lodging not found." })` if it doesn't match. Implement this as a small local function `assertLodgingInTrip(db, lodging, tripId)` in `lodging.ts` so both procedures share it.
4. Keep `deleteLodging`'s existing creator/organizer check after the scope check.
5. Then perform the update/delete (still by `eq(lodgings.id, ...)` — now safe).

**Verify**: `pnpm turbo run typecheck -F @sortey/api` → exit 0

### Step 4: Fix `photos.ts` `react`

Before the existing `photoReactions` select in `react` (lines 181+), verify the photo is in the trip:

```ts
const [photo] = await ctx.db
  .select({ id: tripPhotos.id })
  .from(tripPhotos)
  .where(and(eq(tripPhotos.id, input.photoId), eq(tripPhotos.tripId, ctx.tripId)))
  .limit(1);
if (!photo) {
  throw new TRPCError({ code: "NOT_FOUND", message: "Photo not found." });
}
```

Check the actual column name linking `tripPhotos` to trips in `packages/db/src/schema.ts` before writing this (expected `tripId`; the `photos.delete` procedure and `list` will show the real shape). Import whatever is missing (`and`, `TRPCError`) if not already imported.

**Verify**: `pnpm turbo run typecheck -F @sortey/api` → exit 0

### Step 5: Regression tests

Create `packages/api/src/router/__tests__/tenant-scoping.test.ts`. The four fixed handlers query `ctx.db` inline (no store interface), so test at the query-shape level the same way the repo's other inline-router tests do — if no such exemplar fits, write focused unit tests against exported helpers plus a documented manual check:

- Test `validateSegmentBelongsToTrip` (now in `packages/api/src/trips/segment-guard.ts`) with a stub `db` object whose `select().from().where().limit()` chain returns: (a) a matching segment → resolves; (b) empty → throws `TRPCError` with code `BAD_REQUEST`. The fuel-logs test (`packages/api/src/router/__tests__/fuel-logs.test.ts`) shows the repo's stub style.
- Test `assertLodgingInTrip` the same way (cross-trip → `NOT_FOUND`).
- Add a grep-style guard test: read `itinerary.ts` source in the test (via `node:fs`) and assert the delete where-clause references `itineraryEvents.tripId` — crude, but it pins the fix without a DB. Only do this if the team has no DB-backed test harness available; otherwise prefer a real DB test.

**Verify**: `pnpm --filter @sortey/api exec vitest run src/router/__tests__/tenant-scoping.test.ts` → all pass

### Step 6: Full package check

**Verify**: `pnpm --filter @sortey/api test` → all pass; `pnpm turbo run lint -F @sortey/api` → exit 0; `pnpm format:check` → exit 0

## Test plan

See Step 5. Cases: segment-in-trip pass/fail, lodging-in-trip pass/fail (cross-trip reads as NOT_FOUND), itinerary delete where-clause includes trip scope. Pattern file: `packages/api/src/router/__tests__/fuel-logs.test.ts`.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm turbo run typecheck -F @sortey/api` exits 0
- [ ] `pnpm --filter @sortey/api test` exits 0, including the new `tenant-scoping.test.ts`
- [ ] In `itinerary.ts`, the delete where-clause contains `itineraryEvents.tripId`
- [ ] In `lodging.ts`, both `updateLodging` and `deleteLodging` verify the lodging's segment belongs to `ctx.tripId` before mutating
- [ ] In `photos.ts` `react`, a scoped `tripPhotos` existence check precedes the reaction toggle
- [ ] `grep -n "validateSegmentBelongsToTrip" packages/api/src/router/lodging.ts` shows an import, not a local definition
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any excerpt above doesn't match the live code (the holes may have been fixed since 2408b3e).
- `tripPhotos` turns out not to have a direct trip column — report the actual linkage instead of inventing a join.
- `lodgings` rows can have a NULL `segmentId` (check the schema) — that breaks the scoping strategy and needs a decision, not a workaround.
- Fixing a site appears to require changing a zod input schema or a response shape.

## Maintenance notes

- The durable fix for this class is Postgres RLS on the trip-scoped tables (`packages/db/src/tenant.ts` has the policy builders; the audit logged "trip RLS" as backlog). When that lands, these application-level checks remain as defense-in-depth.
- Review checklist for future routers: any mutation whose where-clause is a bare row id must either include the trip/workspace column or pre-fetch scoped by `ctx.tripId`. `pins.ts:delete` is the exemplar.
- Deferred: a lint rule or CI grep that flags `\.where\(eq\([a-z]+\.id, input\.` in `packages/api/src/router/` without an accompanying scope condition.
