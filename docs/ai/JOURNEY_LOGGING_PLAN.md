# In-App Journey Logging — Implementation Plan

## Production implementation (2026-07-12)

Journey logging is now a first-class product workflow rather than a segment
editing shortcut. `journey_stop` records what actually happened and links to a
`trip_segment` for route/map rendering. Client-generated UUIDs make mobile
retries idempotent; multi-row stop/segment/pin writes are transactional.

The Expo app is the primary capture surface. It saves a compact command to a
persisted outbox before attempting the network, retries on reconnect, and shows
queued entries in the Journey timeline. Driving Mode includes `Log a stop` and
`Camp here`. The production web app uses the same API for capture, correction,
reordering, deletion, route retry, notes, and photos.

Planned route segments and recorded stops are intentionally distinct. Only
`journey.list` is allowed to drive Journey timelines or current-progress UI.

The remaining release work is operational: integrate concurrent itinerary/OTA
changes, apply migration `0011_journey_stops.sql`, deploy through ForgeGraph,
and complete production browser plus physical-device proof.

**Goal:** Let a traveler log their trip *from the mobile app as they go* — "I pulled
into X", "camped here", "correct that date" — so nobody needs DB scripts or an
assistant to capture the journey. This is the workflow we've been doing by hand
in-session; it should live in the app.

## Historical starting state

- **Model is right.** `tripSegments` (driving legs w/ origin/dest coords,
  polyline, distance, duration, date) + `pins` (typed points: `campsite`,
  `rest_area`, `scenic`, `fuel`, …, attached to a segment). This already
  expresses "journey as a sequence of stops."
- **`routePlanner.planRoute`** does Google routing but is built for *whole-trip*
  planning (origin→dest, auto-split), not incremental "append one stop."
- **`trips.createSegment` is a stub** — inserts a bare segment (name + dates), no
  coords, no routing, no polyline, no pin. Not usable for real logging.
- **No `updateSegment` / `deleteSegment` / `reorderSegment`.**
- **`routePlanner.searchPlaces`** geocodes a query (usable for "search a place").
  No reverse-geocode (GPS → place name) yet.
- **Mobile has GPS** (`apps/expo/src/utils/use-location-sharing.ts`, expo-location).
- The Google Routes call is **duplicated** (planRoute + the in-session scripts);
  should be one shared helper.

## Prerequisite (Phase 0): tRPC type-ceiling remediation — BLOCKING

The app has **~155 tRPC procedures**. That pushes `RouterOutputs`/`RouterInputs`
past TypeScript's type-instantiation budget, so deep type accesses collapse to
`any` in **both** apps (e.g. `drive.tsx` `summary.convoy.map((m)=>…)` → `m: any`;
`expense-detail.tsx` `share: any`). The app runs fine (compile-time only, and
`next build` doesn't fail on it) but type safety is silently gone, and every new
procedure makes it worse. This session's route-planner additions tipped it over.

- Already done: slimmed `planRoute`'s return (dropped the `FerryGatedLeg[]` +
  `fullPolyline`; clients only used `segmentCount`). Necessary but **not
  sufficient** — confirmed the collapse persists, so it's aggregate.
- **Primary fix:** add explicit `.output(...)`/return-type annotations to the
  ~12–15 heaviest procedures so TS uses the annotation instead of deep-inferring:
  `trips.drivingSummary`, `trips.get`, `trips.listSegments`, `expenses.list`,
  `settlements.summary`, `planRoute` (done), `predictZones`, `corridor.*`, etc.
  Each annotation removes a chunk of instantiation cost.
- **If still over budget:** split `appRouter` into domain sub-apps (trips /
  money / map / realtime) so no single `RouterOutputs` mapped type is huge.
- **Exit criteria:** `pnpm -F @sortey/api typecheck`, `-F @sortey/nextjs
  typecheck`, `-F @sortey/expo typecheck` all green. Add a CI gate so it can't
  silently regress again.

## Phase 1: Backend — a `journey` router

Extract the Google Routes call into `packages/api/src/route-planner/routing.ts`
(`routeLeg(a, b) → { miles, minutes, polyline }`), then:

- **`journey.logStop`** (mutation): `{ tripId, name?, lat, lng, date?, kind,
  note? }` where `kind ∈ {camp, rest, scenic, fuel, water, dump, overnight,
  town, custom}`. Finds the last segment's destination (or the trip origin),
  `routeLeg(prevDest → stop)`, inserts a segment (polyline/distance/duration/
  date default today) and, when `kind` maps to a pin type, a pin at the stop.
  Idempotent-friendly (client-supplied id, ties into the offline outbox — see
  `OFFLINE_FIRST_DESIGN.md`).
- **`journey.updateStop`** (mutation): rename / re-date / move a stop's
  destination; re-route the leg into it and the leg out of it.
- **`journey.deleteStop`** (mutation): remove a stop and heal the gap (re-route
  prev→next), fixing `sortOrder`.
- **`journey.reverseGeocode`** (query): GPS lat/lng → a human name (Google
  reverse geocoding) to prefill "I'm here now".
- Pure helpers (sortOrder math, prev-dest resolution, kind→pinType) unit-tested;
  keep procedures thin.

## Phase 2: Mobile — "Log a stop"

- A prominent **"Log a stop"** action (Driving Mode + trip screen):
  - **"I'm here now"** → GPS → `reverseGeocode` prefill, or **"Search a place"**
    → `searchPlaces`.
  - Pick **kind** (camp/rest/scenic/fuel/water/dump/overnight/…), **date**
    (default today), optional **note**.
  - Save → `logStop` → the leg + pin appear on the map and in the log.
- **Journey list** screen: the ordered stops with dates/miles; tap to
  **rename / re-date / move / delete**; drag to reorder.
- **Quick "camp here"**: one-tap drop a `campsite` pin at current GPS.

## Phase 3: Polish

- Offline queueing of `logStop` (persist to the outbox from
  `OFFLINE_FIRST_DESIGN.md`; replay on reconnect — the killer feature for
  no-signal backcountry logging).
- GPS breadcrumbs (`gpsTrackPoints`, schema exists) → auto-suggest stops + a
  post-trip recap.
- Import corridor POIs for the *actual* logged corridor automatically as the
  journey grows (reuse `import-ioverlander --trip`).

## Sequencing / effort

1. **Phase 0** (type ceiling) — prerequisite, ~0.5–1 day, unblocks everything.
2. **Phase 1** (journey router + tests) — ~1 day.
3. **Phase 2** (mobile Log-a-stop + list) — ~1–2 days.
4. **Phase 3** — folds into the offline-first work.

Phase 0 and Phase 1 backend can proceed in parallel with the mobile UI once the
`journey` router contract is fixed.
