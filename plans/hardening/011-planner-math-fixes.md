# Plan 011: Route-planner and fuel-log math fixes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/hardening/README.md` (create it, modeled on `plans/README.md`,
> if it doesn't exist yet) — unless a reviewer dispatched you and told you
> they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 0c1ffab..HEAD -- packages/api/src/route-planner/itinerary-template.ts packages/api/src/route-planner/route-candidates.ts packages/api/src/route-planner/leave-by.ts packages/api/src/router/fuel-logs.ts packages/api/src/fuel packages/db/src/schema.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2 (see per-item severity ranking below — this batch spans one real user-facing bug down to one latent/dead-code footgun)
- **Effort**: M
- **Risk**: LOW for (b)/(c)/(d); MED for (a) (touches the itinerary day-labeling logic that already has trip-specific special cases hardcoded by name/date, so any refactor risks disturbing those)
- **Depends on**: none (four independent sub-items; safe to execute in any order)
- **Category**: bug
- **Planned at**: commit `0c1ffab`, 2026-07-19

## Severity ranking (do the plan in this order; each is independently shippable)

1. **(a) `expandStopDays` mislabels replanned play days as drive days** —
   real, user-facing, triggers on a common flow (mid-stay replan). Highest
   severity of the four.
2. **(d) `fuel_log` has no `currency` column** — real, user-facing for any
   trip with mixed-currency fuel stops (e.g. crossing into Canada/Mexico, or
   any non-USD trip); silently corrupts the trip's fuel total and the
   split-expense amount with no FX conversion. Second-highest.
3. **(b) `route-candidates.ts` duplicate `rank` values** — real but lower
   blast radius: only affects UI ordering/display when there are 3+ route
   candidates and the "Shorter" swap fires; no money or itinerary-date
   corruption, just a display-ordering bug (possible duplicate/ambiguous
   sort key).
4. **(c) `leaveByLocal` uses UTC getters despite the "local" name** —
   **currently dead code** per the audit (the one production caller,
   `today-command-ops.ts:234`, recomputes the value correctly via
   `formatLocalHm` and never reads `computed.leaveByLocal`). Fix it as a
   footgun-removal, not an active-bug fix; lowest severity, but cheap and
   worth closing since the dead field is still exported in the public
   `LeaveByResult` type and could be read by a future caller or test.

## Why this matters

Four independent correctness gaps in the road-trip planning math:

- **(a)**: `expandStopDays` derives a day's `intent` ("drive" vs "play")
  from its position `i` in the *current* nights-loop for a stop (`i === 0`
  → "drive", `i > 0` → "play", for named multi-night stops like Bend/Bryce
  Canyon). `remainingStopsFromDate` — the function that slices a template
  down to "what's left" during a replan — clamps a stay that's already
  started by rewriting `stop.date = fromDate` and resetting the *effective*
  night index to 0 for that stop. When `expandStopDays` is called again on
  that clamped stop (as it is, per-stop, inside `planItineraryOp`'s
  day-draft loop at `plan-itinerary-ops.ts:246`), night index resets to 0
  regardless of which actual night of the stay `fromDate` falls on — so
  replanning on, say, the second night of a two-night "play" stop mislabels
  it "Drive · Bend" instead of keeping it a play day.
- **(d)**: `fuelLogs` (`fuel_log` table) has a `totalCents` column and no
  `currency` column. `fuelLogsRouter.stats()` sums `totalCents` across every
  log for a trip with no currency grouping — if a trip has fuel logged in
  two currencies, the sum is meaningless (adding raw cents across
  currencies). Separately, the fuel→expense split path
  (`buildFuelExpenseValues` in `packages/api/src/fuel/split-expense.ts`)
  passes `fuelLog.totalCents` straight through as the linked expense's
  `totalCents`, while *relabeling* the currency to whatever the trip's
  other expenses already use (`findTripExpenseCurrency`) — with no FX
  conversion. A fill-up actually paid in, say, CAD gets recorded as the
  same numeric cents under USD, silently changing its real-world value.
- **(b)**: after `labelRouteCandidates` picks a "Shorter" candidate and
  promotes it to `rank: 0` (demoting the original primary to `rank: 1`),
  every *other* candidate keeps its original index-based `rank` — which can
  collide with 0 or 1 (e.g. a 3rd candidate that started at index 1 already
  has `rank: 1`, now duplicated by the demoted primary). Sorting by `rank`
  after this swap is not guaranteed to produce a stable, unambiguous order.
- **(c)**: `leaveByLocal` is built with `getUTCHours()`/`getUTCMinutes()`
  despite its name and its purpose (a human-readable local clock time) —
  it's UTC in a field named "Local." It happens to be dead in production
  today because `today-command-ops.ts` throws the value away and recomputes
  correctly with `formatLocalHm(computed.leaveBy, tz)`, but the buggy
  field is still part of the public `computeLeaveBy` API surface (tested
  directly in `leave-by.test.ts`) and will silently produce wrong output
  the moment any new caller reads it directly instead of recomputing.

## Current state

### (a) `packages/api/src/route-planner/itinerary-template.ts`

`expandStopDays` (lines 200-264), the intent-by-index logic (lines 227-245):
```ts
let t = Date.parse(`${stop.date}T12:00:00Z`);
for (let i = 0; i < nights; i++) {
  const date = new Date(t).toISOString().slice(0, 10);
  let intent = stop.intent;
  // Multi-night San Mateo: buffer day then event days
  if (stop.name === "San Mateo") { ... }
  // Yosemite park block: all play
  if (stop.name === "Yosemite Valley area") intent = "play";
  // Bend: first night drive-in, second play
  if (stop.name === "Bend") {
    intent = i === 0 ? "drive" : "play";       // keyed on loop index i
  }
  // Bryce: first drive-in, second play
  if (stop.name === "Bryce Canyon area") {
    intent = i === 0 ? "drive" : "play";       // keyed on loop index i
  }
  ...
  t += 86_400_000;
}
```

`remainingStopsFromDate` (lines 286-315), the clamp that resets the
effective start of a stay (lines 300-309):
```ts
// Stay already started: clamp to remaining nights from fromDate.
const remainingNights = nightsBetween(fromDate, last) + 1;
out.push({
  ...stop,
  date: fromDate,                                    // rewrites stop.date — next expandStopDays call starts i at 0 here
  extraNights: Math.max(0, remainingNights - 1),
  isOrigin: true,
  intent: stop.intent === "drive" ? "play" : stop.intent,
});
```
Note this clamp branch DOES account for `intent` at the *stop* level
(downgrading a `"drive"` stop-level intent to `"play"` once already there),
but `expandStopDays`'s later per-night override for `"Bend"`/`"Bryce Canyon
area"` (keyed purely on `i === 0`) runs unconditionally regardless of that
adjusted stop-level intent or of which real night `fromDate` corresponds
to — so a clamped mid-stay Bend/Bryce stop is re-labeled "drive" on its
first remaining day even when that's actually the stay's second (play)
night.

Caller: `plan-itinerary-ops.ts:243-246`:
```ts
for (const stop of stops) {                 // `stops` already ran through remainingStopsFromDate when fromDate is set
  if (stop.heroTitle === "Live position") continue;
  for (const d of expandStopDays(stop)) {    // fresh i-loop from 0 for the clamped stop
```

### (b) `packages/api/src/route-planner/route-candidates.ts`

`labelRouteCandidates` (lines 31-102), the rank-assignment (lines 48-80) and
the post-hoc "Shorter → rank 0" swap (lines 82-99):
```ts
const labeled: LabeledRouteCandidate[] = withMeta.map((r) => {
  ...
  return {
    id: `candidate-${r.index}`,
    label,
    rank: r.index,          // every candidate gets its original index as rank
    ...
  };
});

// Prefer shorter as rank 0 only when it is substantially shorter (>5%).
const primary = labeled[0]!;
const shorter = labeled.find((c) => c.label === "Shorter");
if (shorter && shorter.id !== primary.id && shorter.distanceMiles < primary.distanceMiles * 0.95) {
  return labeled
    .map((c) =>
      c.id === shorter.id
        ? { ...c, rank: 0 }        // shorter → 0
        : c.id === primary.id
          ? { ...c, rank: 1 }      // original primary → 1
          : c,                     // everyone else: UNCHANGED, still index-based
    )
    .sort((a, b) => a.rank - b.rank);
}
```
With 3+ candidates, e.g. index 0 (primary, becomes rank 1), index 1
("Shorter", becomes rank 0), index 2 (some other label, keeps `rank: 2` —
fine in this exact case) — but if the "Shorter" candidate is NOT index 1
(e.g. it's index 2, and index 1 is some other candidate that already has
`rank: 1`), the swap produces two candidates both claiming `rank: 1`: the
demoted primary (explicitly set to 1) and the untouched index-1 candidate
(still 1 from its original index). `sort((a,b) => a.rank - b.rank)` on
duplicate ranks is not a stable disambiguator for the UI's "Primary" /
"Shorter" / positional expectations.

### (c) `packages/api/src/route-planner/leave-by.ts`

`computeLeaveBy` (lines 48-74), the buggy field (line 68):
```ts
return {
  leaveBy,
  leaveByLocal: `${pad2(leaveBy.getUTCHours())}:${pad2(leaveBy.getUTCMinutes())}`,   // UTC despite the name
  minutesSlack,
  driveHours: Math.round(driveHours * 10) / 10,
  late,
  reason,
};
```
`desiredArrivalFromSunset`'s no-sunset fallback (lines 80-92), also UTC
despite documenting itself as producing a "local" hour:
```ts
export function desiredArrivalFromSunset(sunset: Date | null, dayDate: string, fallbackHourLocal = 18): Date {
  if (sunset && Number.isFinite(sunset.getTime())) {
    return new Date(sunset.getTime() - 3_600_000);
  }
  // noon UTC proxy for the calendar day + fallback hour as UTC (good enough
  // for relative leave-by; callers with tz should pass real sunset).
  const [y, m, d] = dayDate.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, fallbackHourLocal, 0, 0));   // line 91 — fallbackHourLocal treated as a UTC hour
}
```
Confirmed dead in production: the only caller of `computeLeaveBy`,
`today-command-ops.ts:219-234`, discards `computed.leaveByLocal` entirely
and recomputes via `formatLocalHm(computed.leaveBy, tz)` (the *correct*,
tz-aware formatter, also exported from `leave-by.ts:35-42`) using the trip's
real tz. The `desiredArrivalFromSunset` UTC fallback (line 91) IS live —
`today-command-ops.ts:218` calls it whenever `sunset` is null (no
lat/lng target resolved) — so that half of item (c) is not dead, only
`leaveByLocal` itself is.

### (d) `fuel_log` schema and fuel-logs currency handling

`packages/db/src/schema.ts:1401-1430`, the `fuelLogs` table — no `currency`
column:
```ts
export const fuelLogs = pgTable("fuel_log", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  tripId: t.uuid().notNull().references(() => trips.id, { onDelete: "cascade" }),
  segmentId: t.uuid().references(() => tripSegments.id, { onDelete: "set null" }),
  userId: t.text().notNull().references(() => user.id, { onDelete: "cascade" }),
  vanProfileId: t.uuid().references(() => vanProfiles.id, { onDelete: "set null" }),
  odometerMiles: t.numeric(),
  gallons: t.numeric().notNull(),
  pricePerGallon: t.numeric().notNull(),
  totalCents: t.integer().notNull(),          // no companion `currency` column
  fuelType: t.varchar({ length: 20 }).notNull().default("gas"),
  ...
}));
```

`packages/api/src/router/fuel-logs.ts`'s `stats` procedure (lines 346-374),
summing across all logs regardless of currency:
```ts
const logs = await ctx.db.select().from(fuelLogs).where(eq(fuelLogs.tripId, ctx.tripId)).orderBy(desc(fuelLogs.loggedAt));
...
const totalFuelCents = logs.reduce((sum, l) => sum + l.totalCents, 0);   // line 371 — sums totalCents with no currency awareness
```

`fuel-logs.ts`'s create flow (lines 175-262) — the fuel log itself is
inserted with no currency (there's nowhere to put one), and when
`splitWithGroup` is true, the linked expense's currency is inherited from
the trip's *other* expenses, not from what the user actually paid (lines
240-246):
```ts
// Settlement refuses mixed currencies, so the split expense must match the
// currency the trip's other expenses already use (trips have no currency
// column). Inherit it; fall back to the request default only for the first
// expense in a trip.
const currency = (await store.findTripExpenseCurrency(input.tripId)) ?? input.currency;

const values = buildFuelExpenseValues({ fuelLog, segmentId, payerUserId: input.userId, currency });
```

`packages/api/src/fuel/split-expense.ts`'s `buildFuelExpenseValues`
(lines 39-56) passes `fuelLog.totalCents` straight through under the
inherited `currency`, with an explicit comment admitting no conversion
happens:
```ts
return {
  tripId: fuelLog.tripId,
  segmentId,
  payerUserId,
  merchant: fuelLog.stationName ?? "Fuel",
  category: "fuel",
  // Passes through unchanged — the equal split happens at read time, so no
  // line items and no pre-division of the total here.
  totalCents: fuelLog.totalCents,
  currency,
  occurredAt: fuelLog.loggedAt,
};
```
`input.currency` IS collected from the client on fuel-log creation (the
create-input schema has `currency: z.string().length(3).toUpperCase().default("USD")`,
per `fuel-logs.ts:316`) — it's just never persisted on `fuelLogs` itself,
only used transiently to help pick the linked expense's currency, and only
when it's the *first* expense in the trip.

## Commands you will need

| Purpose   | Command                                                            | Expected on success |
|-----------|---------------------------------------------------------------------|---------------------|
| Typecheck | `pnpm -F @sortey/api typecheck`                                     | exit 0               |
| Lint      | `pnpm -F @sortey/api lint`                                          | exit 0               |
| Format    | `pnpm format:check` (fix with `pnpm format:fix`)                    | exit 0               |
| Tests     | `pnpm -F @sortey/api test`                                          | all pass             |
| Focused   | `pnpm --filter @sortey/api exec vitest run src/route-planner/__tests__/itinerary-template.test.ts src/route-planner/__tests__/route-candidates.test.ts src/route-planner/__tests__/leave-by.test.ts src/router/__tests__/fuel-logs.test.ts src/fuel/__tests__/split-expense.test.ts` | all pass |

## Scope

**In scope** (the only files you should modify/create), by sub-item:
- (a) `packages/api/src/route-planner/itinerary-template.ts` (`expandStopDays`, and/or `remainingStopsFromDate` — see Step 1 for which side should own the fix); `packages/api/src/route-planner/__tests__/itinerary-template.test.ts` (extend)
- (b) `packages/api/src/route-planner/route-candidates.ts` (`labelRouteCandidates`'s post-swap rank reassignment); its test file (find/create under `packages/api/src/route-planner/__tests__/`)
- (c) `packages/api/src/route-planner/leave-by.ts` (`computeLeaveBy`'s `leaveByLocal`; `desiredArrivalFromSunset`'s fallback — only if Step 4 confirms it needs a tz param); `packages/api/src/route-planner/__tests__/leave-by.test.ts` (extend)
- (d) `packages/db/src/schema.ts` (add `currency` to `fuelLogs`); the generated migration under `packages/db/`; `packages/api/src/router/fuel-logs.ts` (persist + use it; guard `stats`); `packages/api/src/fuel/split-expense.ts` (stop silent relabeling — see Step 5); their respective test files

**Out of scope** (do NOT touch, even though they look related):
- The hardcoded trip-specific special cases in `expandStopDays` ("San Mateo," "Yosemite Valley area") — these are content/data, not the bug; do not generalize or remove them unless your fix for (a) naturally subsumes them (it shouldn't need to).
- `route-candidates.ts`'s labeling heuristics themselves (coastal/inland bias, "Shorter" threshold) — only the rank-collision bug after the swap is in scope.
- `formatLocalHm` (`leave-by.ts:35-42`) — already correct, do not touch.
- Actual FX-rate fetching/conversion for (d) — out of scope for this plan; the fix is to stop pretending a fuel log's `totalCents` is denominated in whatever currency the trip happens to be using, not to build a currency converter. See Step 5 for the scoped fix (persist real currency; make the split-expense path either skip splitting or clearly flag when currencies genuinely differ, rather than silently relabeling).
- `packages/api/src/router/route-planner.ts`'s other route-selection logic beyond `labelRouteCandidates`'s output consumption.

## Git workflow

- Branch: `advisor/011-planner-math-fixes`
- Commits: conventional, one per sub-item, e.g. `fix(api): preserve night-index intent across replan clamp`, `fix(api): dedupe route-candidate ranks after Shorter swap`, `fix(api): compute leaveByLocal in local time`, `feat(db): add currency to fuel_log`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1 (sub-item a, highest severity — do first): Fix `expandStopDays`/`remainingStopsFromDate` intent loss

Read `packages/api/src/route-planner/__tests__/itinerary-template.test.ts`
in full first (it's referenced at line 87 doing exactly this
clamp-then-expand sequence: `const nights = expandStopDays(remaining[0]!);`)
to understand what's already covered before changing behavior.

The fix needs `expandStopDays` to know which *actual* night of the original
stay each clamped day corresponds to, not just its position in the
(possibly clamped) loop. Two reasonable approaches — pick based on which
fits the existing `ItineraryStopDef`/clamp shape more cleanly once you've
read both functions in full:

- **(i)** Have `remainingStopsFromDate` carry forward an explicit
  `nightIndexOffset` (or similar) field on the clamped stop, and have
  `expandStopDays`'s per-night special cases (`"Bend"`, `"Bryce Canyon
  area"`, and the `San Mateo` date-range check) use `nightIndexOffset + i`
  instead of raw `i` when deciding drive-vs-play. This requires adding a
  field to `ItineraryStopDef` (check its type definition for how invasive
  that is) but keeps `expandStopDays` pure and stateless per call.
- **(ii)** Have `remainingStopsFromDate`'s clamp branch pre-compute and
  carry forward the correct `intent` for the *first* remaining night
  directly (it already does something like this for the stop-level
  `intent: stop.intent === "drive" ? "play" : stop.intent` at line 308) and
  have `expandStopDays` respect a per-stop "first night intent override"
  instead of hardcoding `i === 0 ? "drive" : "play"` by name. This is
  probably the less invasive fix: the named special cases
  (`"Bend"`/`"Bryce Canyon area"`) only actually need "is this the
  visually-first night of the *original* stay, or not" — which the clamp
  already implicitly knows (it's clamping *because* the stay already
  started) — so `expandStopDays` could accept an optional `firstNightIntent
  overrides via the stop object itself (e.g. `stop.isOrigin` is already set
  `true` by the clamp — check whether `isOrigin` can double as, or be
  extended to encode, "don't treat night 0 as a fresh drive-in").

Whichever you choose, the acceptance bar is: replanning from the *second*
night of a clamped "Bend" or "Bryce Canyon area" stay must still produce a
`"play"` day, not `"drive"`, for that remaining night.

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0

### Step 2 (sub-item a): Tests

Extend `itinerary-template.test.ts`: a stop like `"Bend"` with
`extraNights: 1` (2 total nights), call `remainingStopsFromDate` with
`fromDate` equal to the stop's *second* night, then `expandStopDays` on the
result — assert the single remaining day's `intent` is `"play"`, not
`"drive"`. Add the mirror case (`fromDate` equal to the *first* night —
still `"drive"`) as a regression guard for the non-buggy path.

**Verify**: `pnpm --filter @sortey/api exec vitest run src/route-planner/__tests__/itinerary-template.test.ts` → all pass

### Step 3 (sub-item d, second-highest severity): Add `currency` to `fuel_log`

- `packages/db/src/schema.ts`: add `currency: t.varchar({ length: 8 }).notNull().default("USD")` to `fuelLogs` (match the column style already used on `expenses` and other money tables per the earlier grep — several use `varchar({ length: 8 })` default `"USD"`, one uses `length: 3`; match the `expenses` table's own choice for consistency, check its exact definition before picking).
- Generate the migration using this repo's existing workflow (check
  `packages/db/package.json` scripts — likely a `drizzle-kit generate`
  equivalent; do NOT hand-write migration SQL if a generator exists).
- `fuel-logs.ts`: thread `currency` through `insertFuelLog`'s values and the
  `FuelLogStore` interface/implementation so it's actually persisted (the
  create-input schema already collects `currency` at line 316 — it's
  currently dropped before reaching `store.insertFuelLog`, check the values
  object built around lines 194-211 to confirm and fix).
- `fuel-logs.ts`'s `stats` procedure (lines 346-374): group `totalFuelCents`
  (and `avgPricePerGallon`) by `currency` instead of summing blindly across
  currencies. Decide the output shape (options: return a per-currency
  breakdown array; or return the single-currency totals when the trip has
  only one fuel currency and a `mixedCurrencies: true` flag plus `null`
  totals otherwise) — prefer whichever requires the smaller client change;
  check `apps/nextjs`/`apps/expo` for where `fuelLogsRouter.stats` output is
  rendered before deciding, since this is a response-shape change.
- `packages/api/src/fuel/split-expense.ts`'s `buildFuelExpenseValues`: stop
  silently relabeling currency. When the fuel log's own `currency` (now
  persisted) differs from `findTripExpenseCurrency`'s result, either (a)
  skip the auto-split entirely and return a `splitSkipped: "currency_mismatch"`
  reason (extending the existing `splitSkipped` union already used for
  `"no_segment"` at `fuel-logs.ts:230`) — recommended, matches the existing
  "skip and tell the caller why" pattern — or (b) use the fuel log's own
  currency for the linked expense instead of the trip's inherited one, which
  may then trip the mixed-currency guard in `expenses.finalize` (plan
  010(d)) later, surfacing the conflict at finalize time instead of hiding
  it at creation time. Prefer (a): it requires no downstream currency-guard
  interaction and matches this file's existing skip-with-reason convention.

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0; `pnpm -F @sortey/api test` → all pass (migration applies cleanly against the test DB — check how other schema-touching plans in this repo run migrations before tests, e.g. via `packages/db`'s test setup)

### Step 4 (sub-item b): Dedupe ranks after the "Shorter" swap

In `route-candidates.ts`'s `labelRouteCandidates`, after the conditional
swap (lines 82-99), reassign ranks by a single final sort pass instead of
patching only two candidates:

```ts
if (shorter && shorter.id !== primary.id && shorter.distanceMiles < primary.distanceMiles * 0.95) {
  const reordered = [
    shorter,
    primary,
    ...labeled.filter((c) => c.id !== shorter.id && c.id !== primary.id),
  ];
  return reordered.map((c, i) => ({ ...c, rank: i }));
}
```
This guarantees ranks `0..n-1` with no duplicates regardless of how many
candidates exist or which index "Shorter" started at, while preserving the
existing intent (shorter first, demoted-primary second, everyone else in
their original relative order after that).

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0

### Step 5 (sub-item b): Test

Add a test with 3+ candidates where the "Shorter" candidate is NOT at
index 1 (e.g. 3 candidates, "Shorter" at index 2) — assert the returned
ranks are `0, 1, 2` with no duplicates, and that candidate identities land
in the right rank slots (shorter → 0, original primary → 1, the
in-between candidate → 2).

**Verify**: `pnpm --filter @sortey/api exec vitest run` on the route-candidates test file → all pass

### Step 6 (sub-item c, lowest severity): Fix `leaveByLocal`

`leaveByLocal` needs a timezone to be genuinely "local," but
`computeLeaveBy`'s `LeaveByInput` doesn't currently carry one. Two options:

- **(i, recommended)**: add an optional `timeZone?: string` to
  `LeaveByInput`; when present, build `leaveByLocal` via the already-correct
  `formatLocalHm(leaveBy, timeZone)` instead of the raw UTC getters; when
  absent, keep the current UTC-getter behavior but rename the field's
  *documentation* (not its name — that would be a breaking API change for
  the exported type) to make the UTC-when-no-tz behavior explicit, e.g. a
  comment: `/** HH:mm. UTC unless \`timeZone\` is passed to computeLeaveBy — pass a tz for a genuinely local value. */`.
- **(ii)**: since it's confirmed dead, consider removing `leaveByLocal` from
  `computeLeaveBy`'s return value and `LeaveByResult` type entirely, forcing
  any caller (now and future) to use `formatLocalHm` explicitly — but check
  `leave-by.test.ts` for direct assertions on `leaveByLocal` first; if tests
  assert its value, removing it is a larger test-surface change than this
  plan should take on. Prefer (i) unless Step 6's read of the test file
  shows (ii) is a clean one-line test removal.

Also fix `desiredArrivalFromSunset`'s no-sunset fallback (line 91) if you
add the `timeZone` param — the fallback's `Date.UTC(y, m-1, d, fallbackHourLocal, ...)`
should become tz-aware to match, since it's live code (called whenever
`sunset` is null). Check whether `desiredArrivalFromSunset` should also
gain an optional `timeZone` param for this, or whether its existing
"good enough for relative leave-by" comment (line 89) is an intentional,
accepted approximation — if the latter, leave it and only fix the
`leaveByLocal` field itself; note the fallback's UTC behavior explicitly in
a comment either way so it's not mistaken for a bug again.

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0

### Step 7 (sub-item c): Test

Add a test to `leave-by.test.ts`: `computeLeaveBy` with a `timeZone` set to
a non-UTC zone (e.g. `"America/Los_Angeles"`) produces a `leaveByLocal`
matching `formatLocalHm(result.leaveBy, "America/Los_Angeles")`, not the
raw UTC hour. Add/keep a case without `timeZone` asserting the (documented)
UTC fallback behavior, so the distinction is pinned either way.

**Verify**: `pnpm --filter @sortey/api exec vitest run src/route-planner/__tests__/leave-by.test.ts` → all pass

### Step 8: Full package check

**Verify**: `pnpm -F @sortey/api test` → all pass; `pnpm -F @sortey/api lint` → exit 0; `pnpm -F @sortey/api typecheck` → exit 0; `pnpm format:check` → exit 0 (run `pnpm format:fix` if not)

## Test plan

Covered per sub-item (Steps 2, 5, 7, and Step 3's currency-grouping
assertions in `fuel-logs.test.ts`/`split-expense.test.ts`). The
highest-value new coverage is (a)'s clamp-then-expand-on-second-night case
— it's the one that reproduces the actual user-facing bug (mid-stay
replan mislabeling) — and (d)'s currency-mismatch skip in
`buildFuelExpenseValues`, which is the one that stops silent money
corruption.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm -F @sortey/api typecheck` exits 0
- [ ] `pnpm -F @sortey/api test` exits 0, including new tests for all four sub-items
- [ ] A test asserts replanning from a stay's second night keeps a `"play"` day `"play"` (not `"drive"`) for at least one of the named special-case stops (Bend or Bryce Canyon area)
- [ ] `grep -n "currency" packages/db/src/schema.ts` shows a new `fuelLogs`/`fuel_log` hit; a migration file exists under `packages/db/` for it
- [ ] `fuelLogsRouter.stats()` no longer sums `totalCents` across differing currencies unconditionally — either grouped output or a mixed-currency flag
- [ ] A test with 3+ route candidates and "Shorter" not at index 1 asserts unique, contiguous ranks after `labelRouteCandidates`
- [ ] A test asserts `computeLeaveBy`'s `leaveByLocal` matches `formatLocalHm` output when a `timeZone` is supplied
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/hardening/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `expandStopDays`/`remainingStopsFromDate`'s clamp behavior (Step 1) turns
  out to be exercised by more special-case stop names than the two named in
  this plan (re-grep `itinerary-template.ts` for `stop.name ===` before
  changing the loop-index logic) — extend the fix to cover them, don't
  leave a partial fix; if the scope grows significantly beyond Bend/Bryce
  Canyon/San Mateo, report before proceeding.
- `ItineraryStopDef`'s type is shared/serialized somewhere outside
  `packages/api` (e.g. exported to a client package) such that adding a
  field (Step 1, option (i)) would be a wider breaking change than
  expected — check its import graph before adding fields.
- Changing `fuelLogsRouter.stats()`'s response shape (Step 3) has more than
  one client consumer with meaningfully different rendering needs — report
  the consumers found and let a reviewer confirm the chosen shape before
  you wire up both apps' changes (if any client changes are even needed in
  this plan's scope — prefer a shape that doesn't require client changes at
  all if honestly possible, e.g. keep `totalFuelCents` as "same-currency
  total, or 0/null with a `mixedCurrencies: true` flag").
- Any currently-passing test in `leave-by.test.ts` asserts `leaveByLocal`
  behaves as UTC-without-tz and would break under option (i)'s change —
  that's expected and fine (the whole point is adding an opt-in tz param
  without changing default behavior), but if a test asserts it must ALWAYS
  be UTC regardless of any parameter, treat that as a signal the test
  itself encodes the bug and needs updating, and say so in your report.
- The migration generator (Step 3) requires a running Postgres instance you
  don't have — report what's needed rather than hand-writing SQL that might
  not match the repo's actual migration format/naming convention.

## Maintenance notes

- (a)'s fix only handles the two currently-named multi-night special cases
  plus whatever Step 1's re-grep finds. If more named-stop special cases
  are added to `expandStopDays` in the future, they must use whatever
  night-index mechanism this plan lands on (offset field or intent
  override), not raw loop index `i`, or the same class of bug reappears.
- (d) intentionally does not add real FX conversion — it stops the silent
  mislabeling by skipping the auto-split when currencies genuinely differ
  (Step 3's option (a)). A trip that logs fuel in a second currency will
  see that fuel log NOT auto-split into the group expense pool; the user
  would need to manually create/adjust an expense for it. A future plan
  could add a manual "convert and split anyway" affordance once a real FX
  source is decided on.
- (b)'s fix generalizes to any future additional candidate-labeling rule
  that reorders candidates post-hoc — the "reassign all ranks via a single
  final sort/reindex pass" pattern should be reused rather than patching
  two candidates by id again.
- (c) is the one item in this batch that's currently inert — verify at
  execution time (re-run the `grep -rn "leaveByLocal"` from the audit) that
  it's still unread by any caller before treating this as purely
  cosmetic/preventative; if a new caller was added since this plan was
  written, this item's severity should be re-ranked to match (a)/(d).
