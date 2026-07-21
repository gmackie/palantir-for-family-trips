# TODOS

## Fuel Range & Map

- [ ] Feed real fuel state into route coloring
  **Priority:** P1
  `map.tsx` calls `colorPolylineByFuelRange` with no `milesSinceFill`, so the route always assumes a full tank at the trip origin, and the wrap loop "auto-refills" past projected empty — the route flips back to green exactly where the tank would run dry. Use the latest fuel log + odometer/breadcrumb miles, and render the `empty` band instead of silently refilling. (Flagged independently by Claude and Codex adversarial review.)

- [ ] Split map polylines at missing segments
  **Priority:** P2
  When a middle segment lacks `routePolyline`, the member polyline concatenates across the gap, drawing a false straight connection and counting its great-circle distance against fuel range. Break into one polyline per continuous run.

- [ ] Deduplicate fuel-band logic between `packages/api/route-planner/zones.ts` and `apps/expo/src/utils/fuel-route-colors.ts`
  **Priority:** P3
  Two copies of `fuelBandAt`/`colorPolylineByFuelRange`/`isCostcoName` will drift. Parity tests exist on both sides as a tripwire; long-term, extract a shared package or delete the unused server copy.

- [ ] drivingSummary: engage van fallback when the linked van was deleted, and pass current odometer so a stale fuel log isn't treated as a fresh fill
  **Priority:** P3

## Preflight OTA / Build Profiles

- [ ] Sign Preflight OTA updates (expo-updates code signing) or serve HTTPS
  **Priority:** P1
  Preview device builds poll a plain-HTTP LAN endpoint while authenticated against the production API — any LAN peer that can answer for the OTA host can push arbitrary JS. Internal fleet only today, but code signing closes it. Also revisit the static `sortey-p0` runtimeVersion (manual bump required after any native change).

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

## Completed

- [x] v0.1.0.0 — Active-trip command center: cold-start redirect (one-shot), motion modes, fuel-colored map, quick stops, breadcrumb recording with re-queue on failed upload, GPS watcher leak fixes, ATS scoped to local networking, expo vitest wired into CI.
