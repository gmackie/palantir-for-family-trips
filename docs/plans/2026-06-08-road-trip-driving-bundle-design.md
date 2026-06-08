# Road-Trip Driving Bundle — Design

**Date:** 2026-06-08
**Context:** Pre-Omaha (driving road trip). Three features that turn Sortey's built
road-trip data into a usable on-the-road experience. All three are assembly over
systems already in the repo, not greenfield backend.

**Features (in build order):**
1. Always-on location (realtime, then background)
2. Gas splits itself (fuel log → split expense → settlement)
3. Driving Mode (glanceable day-of road dashboard)

Order rationale: Driving Mode consumes live location + fuel data, so the data
layers (1, 2) land first and Driving Mode (3) assembles them.

---

## What already exists (do NOT rebuild)

- **Live location data layer:** `memberLocations` table; `location` router
  (`updateLocation`, `setSharingEnabled`, `getSharingStatus`, `listMemberLocations`).
- **Mobile location push:** `apps/expo/src/utils/use-location-sharing.ts` uses
  `expo-location` `watchPositionAsync` (foreground) → `updateLocation`, and polls
  `listMemberLocations`. `map.tsx` renders live member markers + "N live" + toggle.
- **Fuel:** `fuelLogs` table (gallons, pricePerGallon, totalCents, odometerMiles,
  fuelType, vanProfileId); `fuel-logs` router with MPG computation; `fuel-log-panel.tsx`.
- **Expenses + split:** `expenses.create` + standalone `computeExpenseShares`
  (`packages/api/src/expenses/shares.ts`); flows into `settlements`.
- **Route + ETA:** `route-planner` router returns `distanceMeters`, `duration`,
  `distanceMiles`, `durationMinutes`, `polyline`, `legs` (Google Routes, with an
  `AVG_SPEED_MPH` fallback). `corridor` router for POIs along the route.
- **Realtime transport:** TripRoom Durable Object (one per trip) + `broadcastToTripRoom`
  in `apps/nextjs/worker/index.ts`, with the `runWithRealtimeRuntime` ALS seam. Chat
  already rides this. Location can reuse the SAME trip room — no new Pusher channel.

---

## Feature 1 — Always-on location

**Problem:** the live map only updates while the app is foregrounded and polling.
On a drive the phone is locked in a cupholder, so "where's everyone" goes stale.

**Two layers, shipped independently so the safe half lands even if the risky half slips:**

### 1a. Realtime (low risk) — reuse the trip room
- When `updateLocation` writes a position, the server broadcasts a `location.update`
  event to that trip's TripRoom DO (via the existing `runWithRealtimeRuntime` seam /
  `broadcastToTripRoom`), payload `{ userId, lat, lng, heading?, speed?, updatedAt }`.
- Clients subscribed to the trip room apply the event to the member-locations cache
  (mirror of `mergeMessages` for chat). Map markers move without a poll.
- Keep the existing poll as the cold-start / fallback (5-state discipline:
  reconnect → backfill via `listMemberLocations`).

### 1b. Background updates (higher risk — native) — opt-in
- Use `expo-location` `startLocationUpdatesAsync` + a `TaskManager` background task
  that calls `updateLocation` on a throttled cadence (e.g. every 60s or 500m).
- Requires native config: `expo-location` plugin with `NSLocationAlwaysAndWhenInUse...`
  (iOS) + Android foreground-service location type, and an EAS dev/preview rebuild.
- Gated behind an explicit "Share my location in the background" toggle (battery +
  privacy). Default OFF. A persistent "sharing live" indicator while active.
- **Risk flag:** background geolocation needs a native rebuild and store-review
  attention. If the Omaha timeline is tight, ship 1a alone (realtime foreground is
  already a big upgrade) and treat 1b as fast-follow.

**Privacy:** sharing already gated by `setSharingEnabled`; background respects it.
Stop background updates when sharing is disabled or the trip is `completed`.

---

## Feature 2 — Gas splits itself

**Problem:** fuel logs and expense-splitting are separate; gas (a road trip's biggest
shared cost) isn't split unless someone re-enters it as an expense.

**Design:**
- Add an optional `splitWithGroup: boolean` (default true on the road-trip fuel UI) to
  `fuel-logs.create`. When set, after inserting the fuel log, create an expense:
  - `merchant`: station name or "Fuel", `category: "fuel"`, `totalCents` from the log,
    `currency`: trip currency, `occurredAt`: fill-up time.
  - Equal split across current trip members via `computeExpenseShares` (no line items;
    the whole total is the shared pool). Payer = the logging user.
- **Link the two:** add nullable `expenseId` (uuid, FK → expenses, on delete set null)
  to `fuel_log`. Lets the fuel panel show "split ✓" and lets delete clean up.
- Editing/deleting a fuel log with a linked expense: deleting the log voids/deletes the
  linked expense (or leaves it; decide in plan — simplest: delete-log → delete-expense
  if expense is still `draft`/unclaimed).
- Surfaces: fuel-log-panel shows a "Split with group" toggle + a "→ Expense" link when
  linked. Settlement automatically reflects it (no settlement changes needed).

**Store pattern:** follow the mandated TripStore pattern — standalone logic fn
`createFuelSplitExpense(...)` + thin procedure + in-memory test mock. Reuse
`computeExpenseShares`; do not duplicate split math.

---

## Feature 3 — Driving Mode

**Problem:** no single glanceable screen for "what's happening on the road right now."

**Design:** a new mobile screen `apps/expo/src/app/trip/[tripId]/drive.tsx` (and an
optional web `/trips/[tripId]/drive`), dark, big-type, tabular-nums, DESIGN.md
command-center. Four stacked blocks, each degrades gracefully (5-state rule):

1. **Next stop** — from itinerary stops ordered by sequence/time vs. now: name,
   distance + ETA via `route-planner` (current position → next stop). Big mileage
   readout in Geist Mono. Empty state: "No stops planned."
2. **Leg progress** — % of current leg done (distance covered / leg distance), a thin
   progress bar, miles remaining.
3. **Fuel range** — from the latest fuel log's MPG × tank (van profile capacity) minus
   miles since fill-up → estimated range; compare to distance-to-next-stop / to-go.
   Warn (semantic amber/critical) if range < distance remaining. Empty: "Log a fill-up
   to see range."
4. **Convoy** — live member positions (realtime from Feature 1): who's ahead/behind
   relative to you along the route, last-seen age. Tapping opens the existing map.

**Data sources:** itinerary router, `route-planner`, `fuelLogs` + `vanProfiles`,
`memberLocations` (live via Feature 1). Mostly a read-only assembly screen; the only
new backend is a `drivingSummary` query (or compose existing queries client-side —
prefer a single `trips.drivingSummary` procedure for one round-trip on cellular).

**Mobile-first:** big touch targets (44px+), high contrast for sunlight, no tiny text.
Add a "Drive" entry to the trip nav. Web version is a nice-to-have / large-display view.

---

## Cross-cutting

- **Realtime:** one transport (TripRoom DO). Location events reuse it; no new infra.
- **Offline (explicitly OUT of scope for v1):** rural-signal offline caching/queue is a
  separate, larger effort (LAUNCH_PLAN B-stretch). Driving Mode should *tolerate* stale
  data (show last-seen ages, don't crash on null), but full offline is not in this bundle.
- **Tests:** store-pattern logic fns get in-memory unit tests (fuel-split math, driving
  summary assembly). Realtime merge gets a merge test mirroring chat's.
- **Design:** all new UI on the DESIGN.md command-center tokens + the StatusPill/banner
  primitives added earlier.

## Build order

**Decision (2026-06-08): this bundle is 1a + 2 + 3 (all JS, no native rebuild).
Feature 1b (background location) is a SEPARATE fast-follow with its own EAS build.**

1. Feature 1a (realtime location over trip room) — unblocks convoy block.
2. Feature 2 (gas → split expense) — independent, quick.
3. Feature 3 (Driving Mode screen) — assembles 1 + 2 + route/itinerary.

Fast-follow (not in this bundle):
- Feature 1b (background location) — `expo-location` background task + native config
  + EAS dev/preview rebuild + opt-in toggle. Build and test on its own branch so a
  native-build problem can't block the JS bundle before the trip.
