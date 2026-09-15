# TODOS

## Fuel Range & Map

- [x] Feed real fuel state into route coloring
  **Priority:** P1 — done 2026-08-02
  `colorPolylineByFuelRange` no longer wraps: `milesSinceFill` is not reduced modulo the tank (an already-dry van reads empty, not full) and the accumulator resets only at caller-supplied `refuelAtMiles` — the predicted Fuel Zones — so the route goes red where the tank actually runs dry and stays red. `routePlanner.zones` now returns `milesSinceFill`, computed from the GPS breadcrumb distance since the latest fuel log (0 when no track exists, matching driving-summary's topped-off assumption), and `map.tsx` passes both it and the Fuel Zone mile markers.

- [x] Split map polylines at missing segments
  **Priority:** P2 — done 2026-08-02
  `colorRouteRunsByFuelRange` colors one run per continuous stretch; a segment without geometry ends the run rather than joining across it. Its own `distanceMiles` is carried forward as `gapMilesBefore` so the miles still count against range without drawing a road that doesn't exist.

- [ ] Deduplicate fuel-band logic between `packages/api/route-planner/zones.ts` and `apps/expo/src/utils/fuel-route-colors.ts`
  **Priority:** P3
  Two copies of `fuelBandAt`/`colorPolylineByFuelRange`/`isCostcoName` will drift. Parity tests exist on both sides as a tripwire; long-term, extract a shared package or delete the unused server copy.

- [ ] drivingSummary: engage van fallback when the linked van was deleted, and pass current odometer so a stale fuel log isn't treated as a fresh fill
  **Priority:** P3

## Preflight OTA / Build Profiles

- [x] Sign Preflight OTA updates (expo-updates code signing) or serve HTTPS
  **Priority:** P1 — done 2026-08-02
  `apps/expo/ota-config.js` refuses a non-loopback plain-HTTP `PREFLIGHT_OTA_URL` at config time, so a build that would trust a LAN peer can't be produced (loopback stays allowed for the simulator; ATS local networking is now only reachable on that path). Optional expo-updates code signing rides along via `PREFLIGHT_OTA_CODE_SIGNING_CERT` — set it once preflight-app signs manifests, and the client will reject anything unsigned even if the transport is later downgraded. Still open: the static `sortey-p0` runtimeVersion needs a manual bump after any native change.

- [ ] Make Android preview OTA usable
  **Priority:** P3
  The shared preview profile bakes `127.0.0.1` (unreachable from a device), Android release builds block cleartext by default, and the publish script exports `--platform ios` only.

## Mobile UX

- [ ] E2E (Maestro) coverage for the active-trip flows
  **Priority:** P2
  Cold-start redirect, trip-card context landing, en_route auto-navigate to Drive, motion-mode chrome + auto recording, quick-stop prefill, fuel-colored map, deep links on the `sortey-expo://` scheme.

- [ ] Motion mode settles on the first GPS sample from `unknown`
  **Priority:** P4
  One noisy speed reading >2.2 m/s at cold start flips the UI to Driving Mode (and auto-starts recording) with no hold time. Consider requiring a short hold for the first transition too.

## Corridor Cast (post-P0 follow-ups — see `docs/plans/2026-07-22-corridor-cast-podcast-studio.html` and plan v2 at https://yub8q70wviyl.postplan.dev)

- [ ] Native audio player for Corridor Cast (expo-audio + drive-mode mini player)
  **Priority:** P2
  P0 ships web-only because the standalone trip-device build has no expo-av/expo-audio and a mid-trip rebuild+reinstall is impractical. Post-trip: add expo-audio, a drive-mode mini player, background playback with Maps, and lock-screen controls, then rebuild with the trip-device EAS profile (the `eas-build-post-install` hook must build workspace deps first — see `sortey-standalone-trip-profile` learning). Blocked by: trip ending / device access for reinstall; P0 pipeline shipped.

- [ ] Precache service worker for in-app offline Corridor Cast playback
  **Priority:** P1
  P0's offline guarantee is Download MP3 (played from the Files app); the IndexedDB blob player only works when the app shell can load. A minimal SW that precaches the player route's HTML + vinext static assets at prefetch time (cache-first offline, NO Range/206 logic, no audio caching) restores in-app airplane-mode playback with segment titles and speed control. Deferred from P0 (eng-review Issue 6) because vinext hashed-chunk enumeration and offline session/tRPC hydration are white-screen-prone and must be tested at home, not discovered on I-70. Depends on: P0 player shipped.

- [x] Corridor Cast script-quality eval + real documentary grounding source
  **Priority:** P2 — done 2026-08-02
  Two-part trust upgrade deferred from P0 (eng-review Issues 7/8): (1) `cast/__evals__` structural eval — fixture day contexts asserting schema validity, per-segment word budgets ±20%, disclaimers, must-mention anchors, ≥1 grounded POI reference — as the regression floor once prompts iterate; (2) a real grounding source for documentary content (Wikipedia/corridor-town lookups in the context pack), since trip data can only ground operational facts (roads/towns/distances/stops/anchors) — P0 handles this with two-tier prompt honesty (grounded ops facts; hedged, non-specific model-knowledge color). Together these raise the D4 "source-backed claims" premise from ritual to machinery. Depends on: P0 prompt stabilized.

- [x] Evict the Corridor Cast IndexedDB audio cache on sign-out
  **Priority:** P2 — done 2026-08-02
  Keyed `<userId>:<episodeId>` and foreign entries (including legacy unscoped keys) are purged on first access. Scoping beats an eviction hook: sign-out is only one of the ways a browser changes hands, and a session that expires or is revoked elsewhere fires nothing.

- [x] Composite index on imported_poi (lat, lng)
  **Priority:** P3 — done 2026-08-02
  `imported_poi_lat_lng_idx`. The eventual upgrade is a PostGIS geography column + GiST (docs/adr/0001), which replaces the 5-sample box approximation with one ST_DWithin.

- [x] Copilot router tests + retire or wire copilot.estimateDrive
  **Priority:** P3 — partially done 2026-08-02: `defaultSeedWorld` no longer serves real trips. `copilot/world-ops.ts` builds the world from the trip's own anchors and segments; a trip with nothing planned gets an empty world rather than another trip's route. `estimateDrive` is wired to it and returns `source: "missing"` for a leg this trip does not have. Still open: router-level tests for the auth chain.
  copilotRouter has no router-level tests (auth chain, estimateDrive missing-leg fallback) and estimateDrive has no callers. Also: defaultSeedWorld hardcodes July-2026 dogfood anchors served to every trip — gate by trip id or derive from real anchors before the co-pilot feature ships beyond the dogfood. (Ship review, testing + maintainability specialists.)

## Completed

- [x] v0.1.0.0 — Active-trip command center: cold-start redirect (one-shot), motion modes, fuel-colored map, quick stops, breadcrumb recording with re-queue on failed upload, GPS watcher leak fixes, ATS scoped to local networking, expo vitest wired into CI.
