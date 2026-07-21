# Changelog

All notable changes to Sortey are documented in this file.

Versions follow the gstack `MAJOR.MINOR.PATCH.MICRO` scheme.

## [0.1.0.0] - 2026-07-18

### Added
- The app now opens straight into your running trip: on cold start Sortey detects an in-progress trip and lands on Today Command (parked) or Driving Mode (moving) instead of the trip list.
- Driving Mode and Stopped Mode chrome switch automatically based on GPS motion, with debounced transitions so a red light doesn't flip the UI.
- The trip map colors your route by fuel range — green/amber bands computed from your van's tank size and MPG — and surfaces fuel stops with Costco first.
- Quick-stop shortcuts from Driving Mode ("Quick stop", "Park for the night") deep-link into stop logging with location and kind prefilled.
- Trip cards on the home screen show status-colored borders (green while active, amber en route or paused) matching the trip detail screens.
- Track recording keeps a GPS breadcrumb trail while Driving Mode is open and reports actual driven miles in the recap; failed uploads are re-queued so spotty coverage doesn't leave gaps.
- Mobile builds: local preview build profiles with a Preflight OTA loop for on-van testing, and app variants renamed to the fleet standard (development → "Sortey (Expo)", preview → "Sortey (Dev)").

### Changed
- Driving summary falls back to your workspace's only van when the latest fuel log isn't linked to a van profile, so fuel range still renders.
- The mph readout in Driving Mode uses a fixed-width font so it no longer jitters.

### Fixed
- Returning to the home screen during an active trip no longer re-redirects into the trip — the auto-redirect fires once per app launch, keeping the trip list and invite links reachable.
- Stopping track recording while driving now sticks; previously the auto-record loop restarted it immediately.
- GPS watchers no longer leak when Driving Mode screens unmount or stop mid-setup (motion mode, dwell suggest, and track recording all guard against it).
- Preflight OTA dev builds no longer disable App Transport Security globally; only local-network HTTP is allowed.
- Removed the retired `sortey-preview://` scheme from trusted auth origins.
- Fixed pre-existing API router test failures caused by the RLS session wrapper.

### Infrastructure
- Expo app tests now run in CI (vitest wired into turbo). 45 new tests cover the motion-mode state machine, client/server fuel-band parity, driving-summary fallbacks, and route-picking edge cases.
