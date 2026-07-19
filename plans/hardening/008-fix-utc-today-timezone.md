# Plan 008: Fix "today" computed as server UTC instead of the trip's timezone

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/hardening/README.md` (create it, modeled on `plans/README.md`,
> if it doesn't exist yet) — unless a reviewer dispatched you and told you
> they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 0c1ffab..HEAD -- packages/api/src/route-planner packages/api/src/daymap packages/api/src/router/anchors.ts packages/api/src/router/share.ts packages/api/src/router/route-planner.ts apps/expo/src/app/trip`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED (touches the day-boundary logic for Today Command, Replan, briefings, service alerts, anchors, and the public share recap — high fan-out, but each site is a small, mechanical substitution)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `0c1ffab`, 2026-07-19

## Why this matters

"Today" for a road-trip app must mean the trip's local calendar day, not the
server's UTC day. The correct helper already exists —
`todayInTz(tz)` at `packages/api/src/route-planner/journey-ops.ts:30` — and is
used exactly once, at `journey-ops.ts:243`. Every other place that needs
"today" instead does `new Date().toISOString().slice(0, 10)`, which is the
UTC calendar date. For any trip in the Americas (the product's home
territory — CLAUDE.md's road-trip scenarios are all US-based), server UTC
rolls over to the next day at 4–8pm local depending on DST. Concretely: a
van in Pacific time (UTC-7) at 6:00pm local is already at `2026-07-20T01:00Z`
— the UTC-slice bug reads "today" as **tomorrow** for the last several hours
of every single day. Today Command shows tomorrow's plan, "next anchor"
math skips today's anchor, Replan starts rewriting from the wrong day, and
service alerts / briefings key off the wrong date. This is a correctness bug
that fires predictably, every evening, for the app's primary use case.

A second, related bug compounds it: newly-created `tripSegments` rows always
get `tz: "America/Los_Angeles"` hardcoded at insert time, even though
`tripSegments.tz` and `trips.tz` are real, independent columns
(`packages/db/src/schema.ts:223`, `:300`) meant to carry the actual
timezone. An itinerary that crosses into Mountain, Central, or Eastern time
(or leaves the US) silently mislabels every later segment's clock as
Pacific, which feeds wrong sunset times, wrong "leave by" clocks
(`formatLocalHm(computed.leaveBy, tz)` in `today-command-ops.ts:234`), and
wrong day-boundary math for anything that reads a segment's own `tz`
(`daymap/briefing-ops.ts:161`: `const tz = todaySeg?.tz ?? DEFAULT_TZ;`).

## Current state

### The correct helper (do not modify its contract)

`packages/api/src/route-planner/journey-ops.ts:27-32`:

```ts
const DEFAULT_TZ = "America/Los_Angeles";

/** Today's date (YYYY-MM-DD) in a tz — the soft, editable default. */
export function todayInTz(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}
```

Used once, at `journey-ops.ts:243` (`startDate: todayInTz(tz)`), where `tz`
comes from `p.tz ?? DEFAULT_TZ` (line 225) — `DEFAULT_TZ` there is a
last-resort fallback when literally nothing else is known, which is fine;
the bug is everywhere else skipping `todayInTz` entirely.

### Every UTC-slice "today" site (verified by `grep -rn "toISOString().slice(0, 10)" packages/api/src apps/expo/src` and reading each hit; date-arithmetic call sites that convert an *already-known* date/timestamp — not "what day is it now" — are excluded, see Scope)

1. **`packages/api/src/route-planner/today-command-ops.ts:107-124`** (`getTodayCommand`) — the Today Command entry point:
   ```ts
   const now = p.now ?? new Date();
   const date = p.date ?? now.toISOString().slice(0, 10);   // line 108, BUG

   const [trip] = (await db.select({ tz: trips.tz, ... }).from(trips)...);
   const tz = trip?.tz ?? "America/Los_Angeles";              // line 124, tz known AFTER date is computed
   ```
   `date` drives everything downstream (which `tripDays` row is "today", which anchor is "next", leave-by target). `trip.tz` is fetched two lines later but never used to compute `date` — only as a fallback default and later for `formatLocalHm`.

2. **`packages/api/src/route-planner/replan-reality.ts:40-52`** (`buildReplanPreview`) — no trip row is fetched here at all:
   ```ts
   export async function buildReplanPreview(
     db: any,
     p: { tripId: string; reason: ReplanReason; fromDate?: string; mode?: ReplanMode; origin?: {...} },
   ): Promise<ReplanPreview> {
     const mode = p.mode ?? "soft_route";
     const today = new Date().toISOString().slice(0, 10);   // line 52, BUG
     let fromDate = p.fromDate ?? today;
   ```
   `fromDate` decides where the replan starts rewriting the itinerary — a wrong "today" means Replan clips or keeps the wrong day.

3. **`packages/api/src/route-planner/plan-itinerary-ops.ts:99-107`** (`planItineraryOp`, full-rebuild-from-GPS branch):
   ```ts
   } else if (p.origin && !fromDate) {
     // Full rebuild from GPS: treat today as fromDate for origin injection only
     // on the first stop of the full template.
     const today = new Date().toISOString().slice(0, 10);   // line 105, BUG
     stops = injectLiveOrigin(stops, p.origin, today);
   ```
   No trip row is selected in this function before this line; the trip is only read/patched later (line 179, `db.update(trips)...where(eq(trips.id, p.tripId))`).

4. **`packages/api/src/daymap/service-ops.ts:41-61`** (`computeServiceAlerts`):
   ```ts
   export async function computeServiceAlerts(
     db: any,
     p: { tripId: string; workspaceId?: string; levels?: ServiceLevels },
   ): Promise<ServiceAlertsResult> {
     const segments = (await db.select({...}).from(tripSegments)...);
     const today = new Date().toISOString().slice(0, 10);   // line 60, BUG
     const position = resolveCurrentPoint(segments, today);
   ```
   No trip row is fetched here either. `resolveCurrentPoint` uses `today` to decide which segment is "current," which decides which POIs and alerts are "nearby."

5. **`packages/api/src/daymap/briefing-ops.ts:45-70`** (`computeBriefing`):
   ```ts
   const DEFAULT_TZ = "America/Los_Angeles";   // line 45 — only used as a segment-tz fallback at line 161, keep it

   function today(): string {
     return new Date().toISOString().slice(0, 10);   // lines 47-48, BUG
   }
   ...
   export async function computeBriefing(db, p): Promise<DayBriefing | null> {
     const date = p.date ?? today();   // line 70
   ```
   This file already reads a segment's own `tz` later (`todaySeg?.tz ?? DEFAULT_TZ` at line 161) for clock formatting, but `date` itself (which day's segment/tripDay to brief) is picked before any tz is known.

6. **`packages/api/src/router/anchors.ts:60-66`** (`anchorsRouter.next`):
   ```ts
   next: tripProcedure()
     .input(z.object({ workspaceId: z.string().min(1), tripId: z.string().min(1) }))
     .query(async ({ ctx }) => {
       const today = new Date().toISOString().slice(0, 10);   // line 63, BUG
       const from = await currentPoint(ctx.db, ctx.tripId, today);
       return computeNextAnchor(ctx.db, { tripId: ctx.tripId, from, today });
     }),
   ```
   `ctx` here is a `tripProcedure` context — it does not currently carry `trip.tz`; check what `ctx` already exposes (Step 1) before deciding whether to add a query or thread it from context.

7. **`packages/api/src/router/share.ts:42-47`** (`share.publicRecap`) — found via the grep audit, not in the original known-sites list, but the same bug:
   ```ts
   publicRecap: publicProcedure
     .input(z.object({ token: z.string().min(8).max(64) }))
     .query(({ ctx, input }) => {
       const today = new Date().toISOString().slice(0, 10);   // line 45, BUG
       return resolveSharedRecap(ctx.db, input.token, today);
     }),
   ```
   `resolveSharedRecap` (`packages/api/src/route-planner/share-ops.ts:88-149`) already selects `trips.name` at line 101-105 but not `trips.tz`; `today` decides which legs count as "traveled" (line 142: `s.startDate <= today`) on the **public**, unauthenticated recap page.

8. **Mobile — `apps/expo/src/app/trip/[tripId]/today.tsx:71`**:
   ```ts
   const todayStr = new Date().toISOString().slice(0, 10);
   ```
   Contrast with the correct pattern already in the same app,
   **`apps/expo/src/app/trip/[tripId]/log-stop.tsx:38-40`**:
   ```ts
   function todayLocal(): string {
     return new Intl.DateTimeFormat("en-CA").format(new Date());
   }
   ```
   `todayLocal()` uses the *device's* locale/timezone (no explicit `timeZone` arg to `Intl.DateTimeFormat`), which is far closer to correct than UTC-slicing — a phone reports the user's actual local day. It is still not necessarily the *trip's* timezone (a member could be checking the app from home while the van is in another zone), but it never has the "shows tomorrow all evening" failure mode. `today.tsx` should adopt the same device-local pattern at minimum; ideally the server-returned `TodayCommand.tz` (already computed server-side, see `today-command-ops.ts:124`) should be threaded to the client and used for the date shown, since Today Command's whole point is the *trip's* day, not the viewer's.

### Segment `tz` hardcoding (verified by `grep -rn 'America/Los_Angeles' packages/api/src`)

- `packages/api/src/route-planner/plan-itinerary-ops.ts:221-237` — the `tripSegments` insert inside the leg-building loop hardcodes `tz: "America/Los_Angeles"` (line 235) regardless of where the leg actually is.
- `packages/api/src/router/route-planner.ts:479-504` (auto-split branch) and `:529-547` (single-segment branch) — both insert `tripSegments` with `tz: "America/Los_Angeles"` hardcoded (lines 501 and 545).
- Schema already supports the real value: `packages/db/src/schema.ts:223` (`trips.tz`, default `"UTC"`) and `:300` (`tripSegments.tz`, default `"UTC"`) are both plain `varchar` columns — nothing stops writing the correct IANA tz string, it's just never computed.
- `packages/api/src/route-planner/journey-ops.ts:27` and `packages/api/src/daymap/briefing-ops.ts:45` each define their own local `DEFAULT_TZ = "America/Los_Angeles"` constant used only as an ultimate fallback (`p.tz ?? DEFAULT_TZ`, `todaySeg?.tz ?? DEFAULT_TZ`) — these are acceptable defensive fallbacks and are **out of scope to remove**, but they mean a segment that never got a real tz silently degrades to Pacific-time math everywhere downstream, which is exactly what happens today for every segment.

## Commands you will need

| Purpose   | Command                                                            | Expected on success |
|-----------|---------------------------------------------------------------------|---------------------|
| Typecheck | `pnpm -F @sortey/api typecheck`                                     | exit 0               |
| Lint      | `pnpm -F @sortey/api lint`                                          | exit 0               |
| Format    | `pnpm format:check` (fix with `pnpm format:fix`)                    | exit 0               |
| Tests     | `pnpm -F @sortey/api test`                                          | all pass             |
| Focused   | `pnpm --filter @sortey/api exec vitest run src/route-planner/__tests__/journey-ops.test.ts src/route-planner/__tests__/today-command-ops.test.ts src/route-planner/__tests__/replan-reality.test.ts` | all pass (create the two that don't exist yet) |

## Scope

**In scope** (the only files you should modify/create):
- `packages/api/src/route-planner/today-command-ops.ts` (fix `date` computation, use `trip.tz`)
- `packages/api/src/route-planner/replan-reality.ts` (fetch `trip.tz`, use `todayInTz`)
- `packages/api/src/route-planner/plan-itinerary-ops.ts` (fix the GPS-rebuild `today`, stop hardcoding segment `tz`, derive/propagate real tz)
- `packages/api/src/daymap/service-ops.ts` (fetch `trip.tz`, use `todayInTz`)
- `packages/api/src/daymap/briefing-ops.ts` (fetch `trip.tz` for the `date` default; keep the existing per-segment `DEFAULT_TZ` fallback as-is)
- `packages/api/src/router/anchors.ts` (use trip tz for `next`)
- `packages/api/src/router/share.ts` + `packages/api/src/route-planner/share-ops.ts` (select `trips.tz`, use `todayInTz`)
- `packages/api/src/router/route-planner.ts` (stop hardcoding segment `tz` in both insert branches)
- `apps/expo/src/app/trip/[tripId]/today.tsx` (replace UTC-slice with the device-local pattern from `log-stop.tsx`, or better, the server's returned tz — see Step 6)
- New/extended test files under `packages/api/src/route-planner/__tests__/` and `packages/api/src/daymap/__tests__/` pinning evening-boundary behavior (create per-file as needed, following the existing `__tests__` convention in each directory)

**Out of scope** (do NOT touch, even though they look related):
- `packages/api/src/route-planner/day-plan.ts:94` (`eachDateInclusive`) and `packages/api/src/route-planner/itinerary-template.ts:229,270` (`expandStopDays`/`lastNightOf`) — these do date-string arithmetic on an *already-known* date, not "what day is it now"; UTC-noon anchoring there is deliberate and correct (see the code comment at `day-plan.ts:89`).
- `packages/api/src/router/lodging.ts:479` and `packages/api/src/router/photos.ts:54` — these convert an *input* timestamp (`transit.scheduledAt`, `input.takenAt`) to a date string, not "now." A real fix there is a legitimate future finding but is a different bug (input-timestamp bucketing, not server-clock "today") — do not fold it into this plan.
- `packages/api/src/router/route-planner.ts:172` (`autoSplitRoute`'s `currentDate.toISOString().slice(0, 10)`) — iterates a *given* `startDate` forward day-by-day, not "now." Leave it.
- `journey-ops.ts`'s `todayInTz` function itself and its one existing call site (line 243) — already correct, do not change its signature.
- The `DEFAULT_TZ` fallback constants in `journey-ops.ts:27` and `briefing-ops.ts:45` — keep them as last-resort fallbacks; do not delete.
- Any UI/formatting logic beyond the minimum date-string fix in `today.tsx`.

## Git workflow

- Branch: `advisor/008-fix-utc-today-timezone` (branch from current branch; repo default is `master`)
- Commits: conventional, e.g. `fix(api): compute "today" in trip timezone across route-planner and daymap` + `fix(api): stop hardcoding segment tz to America/Los_Angeles` + `test(api): pin evening-boundary today/replan behavior`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Inventory every remaining call site and every `ctx` shape

- Re-run `grep -rn "toISOString().slice(0, 10)" packages/api/src apps/expo/src` and confirm the 8 sites above are still current (line numbers may have drifted slightly — match by surrounding code, not line number alone, if so).
- For each of `today-command-ops.ts`, `replan-reality.ts`, `plan-itinerary-ops.ts`, `service-ops.ts`, `briefing-ops.ts`, `anchors.ts`, `share.ts`/`share-ops.ts`: confirm whether the enclosing function already has a `db` handle and a `tripId` (all of them do, per the excerpts above) and whether `tripProcedure`'s `ctx` (used in `anchors.ts`, `share.ts`) already carries the trip row or just `ctx.tripId`. Read `packages/api/src/auth/guards.ts`'s `tripProcedure` definition to confirm — if it already loads the trip row (organizer check likely needs status/role, not necessarily `tz`), note whether extending `ctx` is cheaper than adding a per-call query.

**Verify**: written inventory in your report; no code changed yet.

### Step 2: Fix `today-command-ops.ts`

Reorder so `trip` (and `tz`) is fetched **before** `date` is computed; replace the UTC slice with `todayInTz`:

```ts
const now = p.now ?? new Date();
const [trip] = (await db.select({ tz: trips.tz, runState: trips.runState, runStateNote: trips.runStateNote }).from(trips).where(eq(trips.id, p.tripId)).limit(1)) as Array<{...}>;
const tz = trip?.tz ?? "America/Los_Angeles";
const date = p.date ?? todayInTz(tz);
```

Import `todayInTz` from `./journey-ops`. Keep `p.date` as an explicit override (tests and callers that pass a fixed date must keep working). Keep the `p.now` escape hatch — but note `todayInTz` uses `new Date()` internally, not `now`; if pinning `now` needs to also pin the tz-computed date for tests, either (a) accept the tradeoff and have tests pass `p.date` explicitly instead of `p.now`, or (b) extend `todayInTz` to accept an optional reference `Date` (default `new Date()`) so `p.now` stays meaningful — prefer (b) since `journey-ops.ts:225`'s only call site (`todayInTz(tz)`) still works unchanged with a defaulted second param. If you choose (b), it's a `journey-ops.ts` signature change — allowed here since it's additive/backward-compatible (do not change the existing call site).

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0

### Step 3: Fix `replan-reality.ts`, `plan-itinerary-ops.ts`, `service-ops.ts`, `anchors.ts`

For each, add a minimal `trips.tz` select keyed by `p.tripId`/`tripId` before computing `today`, and replace the UTC slice with `todayInTz(tz)` (using the same `now`-accepting signature from Step 2 if you took option (b); otherwise plain `todayInTz(tz)`):

- `replan-reality.ts`: `buildReplanPreview` has no trip fetch at all — add one.
- `plan-itinerary-ops.ts`: the GPS-rebuild branch (line ~105) has no trip fetch before that point — add one, or if a trip fetch already exists further down (line 179's `db.update`), hoist a `select` above the branch instead of duplicating full-row reads.
- `service-ops.ts`: `computeServiceAlerts` has no trip fetch — add one.
- `anchors.ts`: `next` — decide per Step 1's finding whether to add a query or use `ctx`.

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0

### Step 4: Fix `briefing-ops.ts` and `share.ts`/`share-ops.ts`

- `briefing-ops.ts`: `computeBriefing`'s `date = p.date ?? today()` — fetch `trips.tz` (a segment select already exists later in the function; check whether trip.tz can be added to an existing query or needs its own) and use `todayInTz(tz)` in place of the local `today()` helper. Leave the per-segment `DEFAULT_TZ` fallback at line 161 untouched — it serves a different purpose (formatting a specific segment's clock once the segment is already chosen).
- `share.ts` + `share-ops.ts`: move the `today` computation *into* `resolveSharedRecap` (it already loads the trip row at `share-ops.ts:101-105` — add `tz: trips.tz` to that existing select) instead of computing it in the router and passing it in. Update `resolveSharedRecap`'s signature to drop the `today` parameter (or make it optional-override) and callers (`share.ts:46`) accordingly. This is a public, unauthenticated endpoint — get the tz join right since there is no `tripProcedure` context to lean on here.

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0

### Step 5: Stop hardcoding segment `tz`

In `plan-itinerary-ops.ts` (the `tripSegments` insert around line 221-237) and `route-planner.ts` (both inserts, ~479-504 and ~529-547), replace the literal `tz: "America/Los_Angeles"` with the actual timezone for that leg's location.

- There is no existing geocoding-to-tz lookup in this codebase (confirm via `grep -rn "timezone\|tzlookup\|geo-tz" packages/api/src` during this step); adding a full lat/lng→IANA-tz resolver is a larger, separate piece of work. For this plan, the minimum correct fix is: **derive the segment's tz from the trip's tz** (`trips.tz`, already being fetched/selected in each of these call sites per Steps 2-4, or add the select if the insert path doesn't already have it) rather than a hardcoded literal. This does not solve "itinerary crosses timezones" perfectly (a trip's single `tz` column can't represent a corridor spanning zones), but it removes the silent Pacific-time default for every trip that isn't in Pacific time, which is the acute bug. Note this limitation explicitly in the commit message and in Maintenance notes below — do not attempt a full multi-zone-per-segment resolver in this plan.
- If `plan-itinerary-ops.ts` or `route-planner.ts` don't already have `trips.tz` in scope at the insert site after Steps 3/4's changes, add the minimal select.

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0; `grep -n '"America/Los_Angeles"' packages/api/src/route-planner/plan-itinerary-ops.ts packages/api/src/router/route-planner.ts` returns no matches (the string should no longer appear as a segment-insert literal; it's fine if it remains as a fallback default expression like `trip?.tz ?? "America/Los_Angeles"`).

### Step 6: Mobile — `today.tsx`

Replace `apps/expo/src/app/trip/[tripId]/today.tsx:71`'s
`new Date().toISOString().slice(0, 10)` with the same device-local pattern
already used in `log-stop.tsx:38-40` (`new Intl.DateTimeFormat("en-CA").format(new Date())`) — either inline or by extracting a tiny shared `todayLocal()` util both screens import (check `apps/expo/src/utils/` for an existing date-utils file first; if none exists, a one-line inline fix in `today.tsx` matching `log-stop.tsx`'s pattern is acceptable and lower-risk than introducing a new shared module in this plan). Confirm `todayStr`'s only use is the query param sent to `getTodayCommand` (grep its usages in the file) so the fix doesn't have unintended UI side effects.

**Verify**: `grep -n "todayStr" apps/expo/src/app/trip/\[tripId\]/today.tsx` — the definition should no longer read `toISOString().slice`.

### Step 7: Tests pinning evening-boundary behavior

Add/extend tests, following the existing in-memory-store convention (see `settlements.test.ts` pattern referenced in `plans/001-fix-settlement-summary-claims-query.md`, and this directory's own `journey-ops.test.ts`):

- `packages/api/src/route-planner/__tests__/today-command-ops.test.ts` (create if it doesn't exist — check first): with a trip `tz: "America/Los_Angeles"` and a pinned reference time of `2026-07-19T23:30:00Z` (which is `2026-07-19T16:30:00-07:00` — 4:30pm Pacific, clearly "today" in Pacific but already `2026-07-19` UTC too — pick a boundary case that's `2026-07-20` UTC but still `2026-07-19` Pacific, e.g. `2026-07-20T02:30:00Z` = `2026-07-19T19:30:00-07:00`), assert `getTodayCommand` resolves `date` (and the day it looks up) to `2026-07-19`, not `2026-07-20`.
- `packages/api/src/route-planner/__tests__/replan-reality.test.ts` (create if missing): same boundary case, assert `buildReplanPreview`'s `fromDate` default is the trip-local day.
- Add one boundary-case test each to `service-ops` and `briefing-ops`'s existing test files if present (check `packages/api/src/daymap/__tests__/` first), else create them.
- Add a segment-insert test (in whichever existing test file covers `plan-itinerary-ops.ts` or `route-planner.ts`'s segment creation) asserting the inserted `tripSegments.tz` matches the trip's `tz`, not the literal `"America/Los_Angeles"`, for a non-Pacific trip fixture (e.g. `tz: "America/New_York"`).

**Verify**: `pnpm -F @sortey/api test` → all pass, including the new boundary tests

### Step 8: Full package check

**Verify**: `pnpm -F @sortey/api test` → all pass; `pnpm -F @sortey/api lint` → exit 0; `pnpm -F @sortey/api typecheck` → exit 0; `pnpm format:check` → exit 0 (run `pnpm format:fix` if not)

## Test plan

Covered by Step 7. The load-bearing case in every new/extended test is a
reference instant that is already the *next* UTC calendar day while still
being the *same* local day in a non-UTC, non-trivially-offset zone (Pacific,
UTC-7 in July) — that is exactly the failure window the bug produces every
single evening, and it's the case that silently passes today's code (which
picks the UTC day) while a correct fix must pick the local day.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm -F @sortey/api typecheck` exits 0
- [ ] `pnpm -F @sortey/api test` exits 0, including new evening-boundary tests in at least `today-command-ops`, `replan-reality`, and the segment-tz insert path
- [ ] `grep -rn "new Date().toISOString().slice(0, 10)" packages/api/src/route-planner/today-command-ops.ts packages/api/src/route-planner/replan-reality.ts packages/api/src/route-planner/plan-itinerary-ops.ts packages/api/src/daymap/service-ops.ts packages/api/src/daymap/briefing-ops.ts packages/api/src/router/anchors.ts packages/api/src/router/share.ts` returns no matches
- [ ] `grep -n "toISOString().slice(0, 10)" apps/expo/src/app/trip/\[tripId\]/today.tsx` returns no matches
- [ ] `grep -n '"America/Los_Angeles"' packages/api/src/route-planner/plan-itinerary-ops.ts packages/api/src/router/route-planner.ts` returns no matches as a segment-insert literal (fallback-default usages like `?? "America/Los_Angeles"` are fine)
- [ ] `pnpm -F @sortey/api lint` exits 0; `pnpm format:check` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/hardening/README.md` status row updated (create the index file if this is the first plan merged from this batch)

## STOP conditions

Stop and report back (do not improvise) if:

- Any of the 8 known "today" sites no longer match the excerpts above (someone may have partially fixed this already) — diff carefully before assuming it's stale.
- `tripProcedure`'s `ctx` (Step 1) already carries trip.tz somewhere non-obvious — report where instead of adding a duplicate query.
- A full lat/lng→IANA-timezone resolver turns out to already exist somewhere in the repo (Step 5's grep) — use it instead of the trip-tz fallback, and note the change of approach.
- Fixing `today-command-ops.ts`'s `date` computation changes the *value* returned by any existing passing test that hardcodes a specific "today" expectation without pinning `now`/`date` explicitly — that test was relying on the bug; fix the test's fixture to pin a timezone-safe reference time rather than special-casing the source.
- The `todayInTz` signature change (Step 2, option (b)) breaks `journey-ops.ts:243`'s existing call or any other current caller — it must remain backward compatible with zero call-site changes elsewhere.

## Maintenance notes

- Segment `tz` in this plan is derived from the **trip's** single `tz`
  column, not a true per-leg geocoded timezone. A trip whose corridor
  actually crosses timezones (e.g. Pacific → Mountain) will still show the
  trip's origin tz for every segment after this fix. A follow-up plan should
  add a lat/lng→IANA-tz resolver (e.g. a small bundled tz-boundary lookup
  library) and call it per-segment at insert time; this plan intentionally
  stops short of that to keep risk and scope bounded.
- `todayInTz`'s `Intl.DateTimeFormat("en-CA", { timeZone: tz })` pattern
  throws on an invalid IANA tz string. If `trips.tz` can ever contain a
  non-canonical value (check whether `trips.tz`/`tripSegments.tz` have any
  server-side validation on write — a quick grep during Step 1 is worth it),
  wrap the call sites added in this plan in a try/catch falling back to
  `DEFAULT_TZ`, matching the defensive style already used for the segment-tz
  fallback in `briefing-ops.ts:161`.
- The mobile `today.tsx` fix (Step 6) uses the *device's* local day, which
  is correct for "what day does the person looking at their phone think it
  is" but is not necessarily the *trip's* day if a member checks the app
  from a different timezone than the van. `getTodayCommand`'s response
  already carries the resolved `tz` (`today-command-ops.ts:124`); a future
  plan could thread that back to the client so the mobile "today" query
  param matches the server's trip-local day exactly, closing that last gap.
