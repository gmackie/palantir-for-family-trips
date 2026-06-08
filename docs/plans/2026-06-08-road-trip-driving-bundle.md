# Road-Trip Driving Bundle Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Ship three on-the-road features for the Omaha drive — realtime location, gas-splits-itself, and a Driving Mode dashboard — all as JS over systems already in the repo.

**Architecture:** Location pings reuse the existing TripRoom Durable Object broadcast seam (`ctx.realtime?.broadcast`). Gas splitting bridges `fuel-logs.create` → an equal-split `fuel` expense via `computeExpenseShares` (the `fuel_log.expenseId` FK already exists — no migration). Driving Mode is a read-only assembly screen over itinerary + route-planner + fuel/van + member locations, fed by one new `trips.drivingSummary` procedure.

**Tech Stack:** tRPC + Drizzle (Postgres), better-auth `tripProcedure` guards, Cloudflare Durable Objects (realtime), Expo Router (mobile), DESIGN.md command-center tokens.

**Design doc:** `docs/plans/2026-06-08-road-trip-driving-bundle-design.md`

**Conventions (read before starting):**
- Store pattern is mandatory for router logic: standalone DB/IO-free logic fn + thin procedure + in-memory test mock. See `packages/api/src/router/chat.ts` (logic fns at the bottom, side effects in the procedure) and its `__tests__`.
- `ctx.realtime?.broadcast(tripId, payload)` is the broadcast seam. `ctx.realtime` is `undefined` in tests (no-op) — never let a broadcast failure throw.
- Expenses are segment-scoped: `expenses.create` requires a non-empty `segmentId`.
- DESIGN.md: dark `#0A0C10`/`#161B22`, semantic `#3FB950`/`#D29922`/`#F85149`/`#58A6FF`, sharp 2-4px radii, Geist Mono tabular-nums for numbers, 44px touch floor, all-caps status. Use the `StatusPill`/`WarningBanner`/`CommandPanel` primitives where applicable.
- Run a focused test with: `pnpm --filter @sortey/api test -- <pattern>`. Typecheck: `pnpm --filter @sortey/api typecheck` / `pnpm --filter @sortey/nextjs typecheck`.

---

## Feature 2 — Gas splits itself (build FIRST; smallest, no realtime, no migration)

### Task 1: `createFuelSplitExpense` logic fn + tests

**Files:**
- Create: `packages/api/src/fuel/split-expense.ts`
- Create: `packages/api/src/fuel/__tests__/split-expense.test.ts`

**What it does:** Pure-ish helper that, given a fuel log row + the list of trip members + a resolved `segmentId`, returns the expense `insert` values for an equal-split fuel expense. No DB calls inside the logic fn — it returns the values object; the procedure does the insert. Mirror how `chat.ts` keeps logic DB-free.

**Step 1 — failing test:** assert `buildFuelExpenseValues({ fuelLog, segmentId, payerUserId })` returns `{ category: "fuel", totalCents: fuelLog.totalCents, merchant: fuelLog.stationName ?? "Fuel", occurredAt: fuelLog.loggedAt, currency: <trip currency or "USD">, payerUserId, segmentId, tripId }`. Add a case: missing `stationName` → merchant `"Fuel"`. Add a case: `totalCents` passes through unchanged (split happens at read time via the unclaimed-pool logic, so no line items needed).

**Step 2:** run `pnpm --filter @sortey/api test -- split-expense` → FAIL (module not found).

**Step 3:** implement `buildFuelExpenseValues`. Keep it a pure function returning the insert-values object. Document that splitting is implicit (expense with no line items → `computeExpenseShares` splits the total equally across members at read time).

**Step 4:** test passes.

**Step 5:** commit `feat(api): fuel-split expense builder`.

### Task 2: wire `splitWithGroup` into `fuel-logs.create`

**Files:**
- Modify: `packages/api/src/router/fuel-logs.ts` (the `create` procedure)
- Modify: `packages/api/src/router/__tests__/` (add `fuel-logs.test.ts` if absent)

**Step 1 — failing test (in-memory mock):** calling `create` with `splitWithGroup: true` inserts a fuel log AND an expense, and sets `fuelLog.expenseId` to the new expense id. With `splitWithGroup: false` (or omitted), no expense is created and `expenseId` is null. Use the in-memory store mock pattern from existing api tests.

**Step 2:** run the test → FAIL.

**Step 3 — implement:**
- Add `splitWithGroup: z.boolean().default(false)` to the `create` input.
- After inserting the fuel log, if `splitWithGroup`:
  - Resolve `segmentId`: use `input.segmentId` if present; else look up a default segment for the trip (first/active `tripSegments` row by sort order). If none exists, skip the split and return the log with a `splitSkipped: "no_segment"` flag (do NOT throw — logging fuel must still succeed).
  - Load trip members; call `buildFuelExpenseValues(...)`; insert the expense; update the fuel log's `expenseId`.
  - This is a side effect in the procedure, not the logic fn.

**Step 4:** tests pass; `pnpm --filter @sortey/api typecheck`.

**Step 5:** commit `feat(api): split gas fill-ups into a group expense`.

### Task 3: fuel-log UI — toggle + linked-expense affordance

**Files:**
- Modify: `apps/nextjs/src/components/road-trip/fuel-log-panel.tsx`
- Modify: mobile fuel entry if present (`apps/expo/src/app/trip/[tripId]/stats.tsx` or wherever fuel is logged) — grep first.

**Steps:** Add a "Split with group" checkbox (default ON for road trips) to the fuel entry form, pass `splitWithGroup`. When a log has `expenseId`, show a small "SPLIT" `StatusPill tone="success"` + a link to the expense. Typecheck both apps. Commit `feat(ui): split-with-group toggle on fuel log`.

---

## Feature 1a — Realtime location (build SECOND; unblocks Driving Mode convoy)

### Task 4: extend the realtime broadcast union + broadcast from `updateLocation`

**Files:**
- Modify: `packages/api/src/realtime-runtime.ts` (the `RealtimeBroadcast` union)
- Modify: `packages/api/src/router/location.ts` (`updateLocation`)
- Modify: `packages/api/src/router/__tests__/location.test.ts` (create if absent)

**Step 1 — failing test:** with a fake `ctx.realtime` that records calls, `updateLocation` calls `broadcast(tripId, { type: "location", userId, lat, lng, heading, speed, updatedAt })` exactly once after the upsert. With `ctx.realtime` undefined, it does not throw.

**Step 2:** run → FAIL.

**Step 3 — implement:**
- Add to `RealtimeBroadcast`: `| { type: "location"; userId: string; lat: number; lng: number; heading: number | null; speed: number | null; updatedAt: string }`.
- In `updateLocation`, after the upsert returns `row`, call `ctx.realtime?.broadcast(ctx.tripId, { type: "location", userId: ctx.session.user.id, lat: input.lat, lng: input.lng, heading: input.heading ?? null, speed: input.speed ?? null, updatedAt: row.updatedAt.toISOString() })`. Best-effort; never throw.

**Step 4:** tests pass; typecheck api.

**Step 5:** commit `feat(api): broadcast member location updates over the trip room`.

### Task 5: client — apply location events on the live map

**Files:**
- Inspect: `packages/realtime/src/use-trip-chat.ts` (the WS subscription it opens), `apps/nextjs/worker/trip-room.ts`, `apps/expo/src/app/trip/[tripId]/map.tsx`.
- Create: `packages/realtime/src/use-trip-locations.ts` (a sibling hook that opens the same trip-room WS and yields the latest position per `userId`, filtering `type === "location"`).
- Modify: `apps/expo/src/app/trip/[tripId]/map.tsx` to merge live events into the `listMemberLocations` cache (keep the existing query as cold-start/fallback; mirror chat's `mergeMessages` reconnect→backfill discipline).

**Steps:** TDD the merge reducer (a pure `mergeLocations(prev, event)` keyed by userId, newest `updatedAt` wins) with a unit test in `packages/realtime/src/__tests__/`. Then wire the hook into the map. Keep poll as fallback. Typecheck. Commit `feat(realtime): live member locations on the map`.

> If wiring the mobile WS subscription proves heavy, the minimal acceptable version is: server broadcast (Task 4, done) + tighten the map poll interval to ~5s and document the WS hook as the follow-up. Do not block the bundle on a deep mobile WS refactor — note the decision in the commit.

---

## Feature 3 — Driving Mode (build THIRD; assembles 1a + 2 + route/itinerary)

### Task 6: `trips.drivingSummary` query + logic fn + tests

**Files:**
- Create: `packages/api/src/trips/driving-summary.ts` (pure assembly logic)
- Add procedure to: `packages/api/src/router/trips.ts`
- Create: `packages/api/src/trips/__tests__/driving-summary.test.ts`

**What it returns (assembled, all nullable-tolerant):**
```ts
{
  nextStop: { name, lat, lng, distanceMiles, etaMinutes } | null,
  legProgress: { fractionDone: number, milesRemaining: number } | null,
  fuelRange: { estimatedRangeMiles: number, distanceToGoMiles: number, low: boolean } | null,
  convoy: Array<{ userId, name, lat, lng, lastSeenSecondsAgo, aheadOrBehind: "ahead"|"behind"|"unknown" }>,
}
```

**Step 1 — failing test:** feed fixture inputs (itinerary stops, current position, route distances, latest fuel log + van profile mpg/tank, member locations) to `buildDrivingSummary(...)`; assert each block. Cases: no stops → `nextStop: null`; no fuel log → `fuelRange: null`; range < distanceToGo → `low: true`.

**Step 2:** run → FAIL.

**Step 3 — implement** `buildDrivingSummary` as a pure fn (no DB). `etaMinutes`/`distanceMiles` from route-planner outputs (`distanceMiles`/`durationMinutes`), or the `AVG_SPEED_MPH` fallback already in `route-planner.ts`. `estimatedRangeMiles = mpgEstimate * tankGallons - milesSinceFillUp` (clamp ≥ 0; null if mpg/tank/odometer missing). Add the thin `trips.drivingSummary` procedure that loads the rows and calls the logic fn.

**Step 4:** tests pass; typecheck api.

**Step 5:** commit `feat(api): drivingSummary assembly for Driving Mode`.

### Task 7: Driving Mode mobile screen

**Files:**
- Create: `apps/expo/src/app/trip/[tripId]/drive.tsx`
- Modify: the trip nav (grep `apps/expo/src/app/trip/[tripId]/_layout.tsx` or `index.tsx` for how screens are linked) to add a "Drive" entry.

**Steps:** Build the four stacked blocks from the design (next stop, leg progress, fuel range, convoy), each with explicit loading/empty/error/success states. Dark, big Geist-Mono mileage readouts, 44px touch targets, semantic warn color when `fuelRange.low`. Poll `drivingSummary` on a short interval; merge live convoy from the Task-5 hook if available. Typecheck expo. Commit `feat(mobile): Driving Mode day-of road dashboard`.

### Task 8: (optional) web Driving Mode at `/trips/[tripId]/drive`

Only if time allows — large-display version reusing `drivingSummary`. Same blocks, command-center panels. Commit separately. YAGNI: skip if the mobile screen covers the need.

---

## Final review
After all tasks: full typecheck both apps + `pnpm --filter @sortey/api test`, then a final code-review pass and deploy (`cd apps/nextjs && pnpm deploy:cloudflare:production`). Background location (Feature 1b) is a separate follow-up branch — not part of this bundle.
