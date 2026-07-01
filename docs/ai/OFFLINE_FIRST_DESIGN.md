# Offline-First Design — Sortey Mobile

**Status:** Design (not implemented)
**Author:** drafted 2026-06-29
**Scope:** Expo mobile app (`apps/expo`). The Next.js web app is out of scope (see Non-goals).

## Why

The driving use case is a van + backcountry road trip: North Cascades, the
Enchantments, PCT Section J, long inland legs (Mt Rainier → Bend is 306 mi).
These have **no cell service**. Today every screen is a live tRPC call
(`apps/expo/src/utils/api.tsx`), so off-grid the app is a spinner: Driving Mode
(`apps/expo/src/app/trip/[tripId]/drive.tsx`), the map
(`.../map.tsx`), corridor POIs, fuel logging — all dead. Offline-first is the
single highest-leverage feature for this use case, and the hardest to retrofit,
so it should be designed in deliberately.

## Goals

1. **Read the trip offline.** Itinerary/segments, route polylines, pins, the
   corridor POIs for *this trip*, expenses, fuel logs, van profile, and the
   `predictZones` result are all viewable with no connection.
2. **Capture offline, sync later.** `expenses.create`, `fuelLogs.create`,
   `pins.create`, and GPS breadcrumbs queue locally and flush on reconnect.
3. **Honest connectivity UX.** A clear offline indicator; "last synced" stamps;
   no silent data loss; no infinite spinners.
4. **Explicit per-trip download.** The user taps "Make available offline" before
   leaving signal; we bundle a bounded snapshot. No surprise background sync of
   16k POIs.

## Non-goals (v1)

- **Web offline.** The Next.js app uses RSC server callers; PWA/offline there is
  a separate, much larger effort. Mobile is what you carry in the van.
- **Full CRDT / real-time collaborative merge.** Solo van use is the target.
  Last-write-wins is acceptable; group-trip merge nuances are flagged, not
  solved (see Conflict policy).
- **Offline auth.** Sessions are cookie-based (`authClient.getCookie()` in
  `api.tsx`). v1 assumes you logged in while online; we cache the session and do
  not attempt offline re-auth. A long-lived session/refresh is a prerequisite.
- **Turn-by-turn nav.** Sortey is the trip companion; Google Maps/Waze handles
  navigation (per `CONTEXT.md` Driving Mode definition).

## Current data layer (what we build on)

- `apps/expo/src/utils/api.tsx`: one `QueryClient` (empty `defaultOptions`) + a
  vanilla `trpcClient` (`httpBatchLink`, superjson, cookie auth). The options
  proxy `trpc.*` returns `queryOptions`/`mutationOptions`.
- Provider mounted once in `apps/expo/src/app/_layout.tsx`
  (`QueryClientProvider`).
- Reads: `useQuery(trpc.X.queryOptions(...))` across screens (e.g.
  `drive.tsx` → `trips.drivingSummary`; `map.tsx` → `corridor.searchImported`,
  `pins.list`; the new `route-ahead-card.tsx` → `routePlanner.predictZones` +
  `getRoutePreview`).
- Writes: `useMutation(trpc.X.mutationOptions(...))` (e.g. `new-expense.tsx` →
  `expenses.create` / `fuelLogs.create`; `map.tsx` → `pins.create`).
- **`@react-native-community/netinfo` is already a dependency** but unused — our
  connectivity signal is free.
- Realtime: Pusher (member locations, chat). Degrades to nothing offline.
- **Not yet present:** any persistent storage (no AsyncStorage/MMKV/SQLite),
  no service-worker equivalent.

## Architecture decision

Three viable approaches:

| Option | Read cache | Write queue | Effort | Notes |
|---|---|---|---|---|
| **A. react-query persistence** (`@tanstack/react-query-persist-client` + MMKV) | reuse existing query cache, persisted | react-query mutation queue / custom outbox | **Low** | No data-model duplication; offline state == the cache the app already reads |
| B. SQLite mirror (`expo-sqlite`/`op-sqlite`) | hand-written queries against a local mirror | outbox table | High | Powerful (joins, partial sync) but duplicates every read path and the schema |
| C. WatermelonDB | reactive local DB | built-in sync protocol | Very high | Sync engine assumes its own schema + a bespoke server sync endpoint; large rewrite |

**Recommendation: Option A for v1** — persist the existing react-query cache with
MMKV, plus a small custom **mutation outbox**. Rationale:

- The app *already* reads exclusively through react-query. Persisting that cache
  makes every read screen work offline with near-zero per-screen changes — the
  query just resolves from the persisted cache instead of the network.
- No second source of truth, no SQL mirror to keep in lockstep with
  `packages/db/src/schema.ts`.
- SQLite (B) only earns its complexity when we need local relational queries or
  selective sync of large tables. Our one large table (corridor POIs) is handled
  by a **bounded bundle**, not a live mirror (below). Revisit B in v3 if POI
  volume or offline querying outgrows the cache.

Add **MMKV** (`react-native-mmkv`) as the storage backend (fast, synchronous,
better than AsyncStorage for a persister) and wire
`persistQueryClient`/`PersistQueryClientProvider` in `_layout.tsx`.

## "Download this trip for offline" flow

A button on the trip screen → `Make available offline`. It runs a prefetch batch
through the existing `queryClient`, so results land in the (now persisted) cache:

Bundle (per trip):
- `trips.get`, `trips.listSegments` (route polylines live on segments —
  `tripSegments.routePolyline`)
- `routePlanner.predictZones`, `routePlanner.getRoutePreview`
- `pins.list`, `itinerary.*`, `lodging`/rooms, `expenses.list`, `fuelLogs.list`,
  `vanProfiles.list`, `ferries.listForTrip`
- **Corridor POIs scoped to the trip's bbox.** `imported_poi` is ~16k rows
  globally — do NOT bundle all of it. Reuse the same bbox the importer derives
  (`packages/db/scripts/import-ioverlander.ts` `bboxFromTrip`); add a
  `corridor.bundleForTrip` procedure returning POIs within the trip's
  segment-derived bbox (the Anacortes→SF trip's corridor is ~16k rows in that
  box though — so cap/paginate and prioritize the van categories: fuel, water,
  campsite, dump_station, propane).

Size estimate: JSON for segments + pins + expenses + ~5–15k POIs ≈ **3–15 MB**
(POIs dominate). Acceptable in MMKV/filesystem. If a trip's POI set is large,
store POIs in a separate file-backed cache (expo-file-system) rather than the
MMKV query blob, and consider an opt-in category filter.

Persisted cache lives in MMKV (small/structured) with an optional
`expo-file-system` spill for the POI payload. Stamp each bundle with a
`downloadedAt` so the UI can show staleness.

## Map tiles offline (the honest part — likely v2)

`react-native-maps` with the Google provider **does not expose offline tile
packs**. Options:
- **Mapbox** (`@rnmapbox/maps`) has first-class offline tile packs
  (`offlineManager.createPack(bounds)`), which maps cleanly onto our trip bbox.
  Cost: swap the map renderer (currently Google in `map.tsx`), Mapbox billing,
  and re-styling. Real but bounded.
- **Pre-cached raster tiles** (download an XYZ pyramid for the bbox to
  `expo-file-system`, serve via a local `UrlTile`/file tile overlay). Cheaper to
  prototype, heavier to do well (zoom levels × bbox = many tiles; respect tile
  provider ToS).
- **v1 compromise:** no base-map tiles offline. Render the **route polyline +
  pins + POIs + zones on a plain dark canvas** (we already draw polylines/markers
  in `map.tsx` and the web `route-gradient-map.tsx`). You still see "where am I
  relative to my route and the nearest fuel/water," which is 80% of the value
  without the tile problem. GPS dot from `expo-location` over that.

**Recommendation:** v1 ships the polyline/POI canvas (no tiles). Tiles are a v2
project; if pursued, Mapbox offline packs over a hand-rolled tile cache.

## Write queue + sync (the outbox)

A persistent **outbox**: an append-only list of pending mutations stored in MMKV.

Shape per entry: `{ id (uuid, client-generated), op: 'expenses.create' |
'fuelLogs.create' | 'pins.create' | 'gps.append', payload, createdAt, status,
attempts }`.

Flow:
1. Mutations route through a wrapper around `trpc.*.mutationOptions`. When
   offline (NetInfo `isInternetReachable === false`) or the request fails with a
   network error, the wrapper **enqueues** instead of failing and applies an
   **optimistic cache update** (react-query `setQueryData`) so the UI reflects it
   immediately.
2. A **sync runner** drains the outbox FIFO when connectivity returns
   (NetInfo listener + app-foreground + manual "Sync now"). Each entry replays
   the real tRPC mutation; on success it's removed and affected queries
   invalidated.
3. **Idempotency.** Generate the entity `id` client-side and send it, so a
   replayed mutation is a no-op server-side. The DB already favors this pattern
   (`onConflictDoNothing` in rooms/POI import, idempotent settlement `record`).
   This requires the create procedures to accept a client-supplied `id` (small
   server change) — without it, a retried-but-actually-succeeded mutation
   double-writes. **This is the key prerequisite server change.**
4. **Conflict policy.** Last-write-wins keyed on `updatedAt`. Fine for solo van
   capture (expenses/fuel/pins/breadcrumbs are append-mostly, rarely contended).
   - *Group-trip caveat:* line-item claiming and settlement are contended,
     realtime, money-touching paths. v1 should **not** queue those offline (keep
     them online-only, disabled with a clear "needs connection" state). Don't let
     LWW silently clobber a claim someone else made while you were off-grid.

## GPS breadcrumbs (offline → batch upload)

`gpsTrackPoints` exists in `packages/db/src/schema.ts` (tripId, segmentId, lat,
lng, speed, recordedAt) but is **unbuilt**. This is the natural offline win:
- A foreground/background `expo-location` watcher samples ~1 point / 5 min while
  driving (per `CONTEXT.md` "GPS Breadcrumbs"). Points append to a local buffer
  (own MMKV ring, not the main outbox — high volume).
- New `gps.appendBatch` procedure: accepts an array, bulk-insert with
  `onConflictDoNothing` on a `(tripId, recordedAt)`-style natural key for
  idempotent replay.
- On reconnect, flush in batches. Powers a **post-trip recap** ("here's where you
  actually went") and feeds Side-Trip detection later.
- Background location needs the `UIBackgroundModes`/Android FGS entitlements —
  flag for the app-store config (`apps/expo/app.config.ts`).

## Phased rollout

**v1 — Read cache + write outbox (≈1.5–2.5 wks)**
- Add MMKV + react-query persister; wrap provider in `_layout.tsx`.
- NetInfo-driven online/offline context + UI indicator + "last synced" stamps.
- "Make available offline" prefetch batch + `corridor.bundleForTrip` (bbox-scoped,
  category-prioritized, capped).
- Mutation wrapper + outbox + sync runner for expenses/fuel/pins, with optimistic
  cache updates.
- Server: accept client-supplied `id` on the three create procedures
  (idempotency).
- Map: polyline/POI/zone canvas works from cache; GPS dot from expo-location.
  No base tiles.

**v2 — Breadcrumbs + recap + tiles (≈2–3 wks)**
- Build `gpsTrackPoints` capture + `gps.appendBatch` + batch flush.
- Post-trip recap view from breadcrumbs.
- Offline base-map tiles (Mapbox offline packs over the trip bbox) — the biggest
  single chunk; can be deferred independently.

**v3 (later)**
- SQLite mirror if offline relational querying/partial sync outgrows the cache.
- Smarter sync (delta/ETags), background prefetch on Wi-Fi, group-trip conflict
  handling for contended paths.

## Risks & open questions

- **Cache size & eviction.** Persisting the full query cache can bloat; persist
  only trip-scoped query keys (use a `dehydrate` filter), and TTL/evict on trip
  archive. POI payload may need the file-system spill, not the MMKV blob.
- **Auth expiry off-grid.** If the cookie session expires mid-trip, queued
  writes fail on return. Needs a long-lived/refreshable session before v1 is
  trustworthy. **Open question:** current session lifetime?
- **Idempotency requires server changes.** Without client-supplied ids, retries
  risk double-writes. Confirm each create procedure can take an `id`
  (`expenses.create`, `fuelLogs.create`, `pins.create`).
- **superjson + persistence.** The persister must serialize superjson-decoded
  values (Dates, etc.). Verify the persister round-trips them (custom
  serialize/deserialize if needed).
- **Pusher offline.** Realtime simply goes silent; ensure subscriptions
  reconnect cleanly and we reconcile via a refetch on reconnect, not stale
  optimistic state.
- **Background location battery/permissions** for breadcrumbs (v2).
- **POI bundle size for big corridors.** The Anacortes→SF bbox already holds
  ~16k POIs; "bbox-scoped" isn't automatically small. Need capping + category
  priority + possibly a narrower buffer than the 30 mi import radius for the
  offline bundle.
