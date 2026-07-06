# Sortey Day-Map, Powered by DriftPort — Feature Spec

**Source:** brainstorm 2026-07-05 grounded in the Obsidian vault
(`Projects/Sortey.md`, `Road Trip App Dogfood Operating Plan.md`) + the current
Sortey codebase. Chosen directions: **predictive service logistics (A)** +
**daily day-map / work-window (B)**, with **deep DriftPort integration as the
North Star**.

## North Star

> Sortey answers *"What does today look like physically?"* and wins when it's
> *"better than notes + maps for deciding the shape of a real travel day."*
> — `Projects/Sortey.md`

The unifying thesis: **the van's real telemetry (from DriftPort) drives a
predictive daily plan.** DriftPort answers *"can the van support what we're
about to do?"*; Sortey turns that state into *where to stop, when to service,
where to work, and what today looks like.* This is the "integrated daily
operating loop" from `Road Trip App Dogfood Operating Plan.md`.

## What already exists (build on, don't rebuild)

- **DriftPort telemetry integration** (spiked this session): `vanTelemetry.getSnapshot`
  — flag-gated (`driftportTelemetryPreview`), fail-safe, resolves trip → van
  profile → `vanProfiles.driftportRigId`, pulls `VanSystemReading[]`
  (`{system, metric, value, unit, readAt}`, mirroring DriftPort `system.dashboard`).
  Van-status card already renders it in mobile Driving Mode.
- **Corridor POIs** — ~14k van amenities imported (fuel/water/**dump**/propane/
  shower/grocery/campsite) via `corridor.searchImported` + the route-aware importer.
  **The service *options* data already exists — this spec makes it predictive.**
- **Journey / route** — segments with polylines, `predictZones` (fuel + overnight
  zones), driving summary, journey logging (log/edit stops; web + CLI live).
- **Weather** — `weather/open-meteo.ts` forecast client (per-coordinate, fail-soft).
- **Fuel logs** — odometer/gallons/MPG model (feeds range + consumption).

## Foundation: deepen the VanState

Extend the telemetry snapshot into a typed **VanState** (still a metric-bag under
the hood, so DriftPort can add metrics without a Sortey schema change):

| Subsystem | Metrics we consume |
|---|---|
| water | `fresh_level`, `grey_level`, `black_level` (%) |
| power | `battery_soc` (%), `solar_w`, `load_w`, `shore_connected` |
| propane | `propane_level` or 1-lb tank count (manual) |
| connectivity | `starlink_state`, `lte_rssi`, `wifi` |

Fallbacks when a rig isn't linked or a metric is absent: **manual entry**
(tank sliders, "trash bags: 2") so Sortey works before DriftPort is wired on a
given van. Persist periodic snapshots (`van_state_reading`) to get **rate-of-change**.

## Feature A — Predictive service logistics ⭐

*"Service stop chosen before it becomes urgent." — Projects/Sortey.md*

1. **Consumption model** (pure, testable): from persisted VanState history,
   estimate fill/drain rate per resource → **hours/miles until** grey full,
   fresh empty, propane out, trash overflow, next fuel (reuse the MPG range model).
2. **Route-matched alerts**: intersect each predicted shortfall with corridor
   POIs on the *remaining* route (dump/water/propane/grocery) → *"Grey tank full
   in ~1.5 days; nearest dump on your route is Rest Area X at mile 212 — hit it
   Thursday."* Surfaced in Driving Mode + the daily briefing, ranked by urgency.
3. **Service-run clustering**: when several needs converge, bundle them into one
   optimal stop/detour ("water + dump + groceries + trash within 4 mi of tonight's
   overnight zone"). A `serviceRun.plan(vanState, route, pois)` pure function.

Ties together: VanState (rates) × corridor POIs (options) × route/segments
(where) × overnight zones (when we're stopped anyway).

## Feature B1 — Work-window finder

*"Where we can work from." + Starlink visibility. — Sortey.md*

- **Candidate spots** on/near today's route: cafés/libraries/coworking (POI +
  Places), rest areas, and open-sky pullouts (for Starlink).
- **Score** each by: **connectivity** (LTE signal data / Starlink sky-openness),
  **power** (from VanState — *"battery 80% + solar charging → ~4h off-grid"* vs
  *"need shore power → café"*), quiet, hours, parking (reuse parking-logistics notes).
- Output: a ranked "work from here today" list feeding the briefing. DriftPort's
  power + Starlink state is what makes this *specific* instead of generic.

## Feature B2 — The Daily Briefing (the day-map)

The assembly layer — *"what does today look like physically?"* in one view:

- **Drive**: today's leg(s) from journey/route + ETA + route gradient.
- **Stop / sleep**: chosen stop + overnight zone options + weather (Open-Meteo).
- **Work window**: top pick from B1, with the van's off-grid work budget.
- **Service**: today's predicted needs + the route-matched stop (Feature A).
- **Experiences / anchors**: hikes/food/family + "one anchor per city".
- **Constraints**: weather, parking, Starlink visibility, latest-start time.

Generated on demand + **exportable to the Obsidian `Road Trip Daily Briefing`
template** (the user already lives in Obsidian — meet them there). This is the
concrete artifact that proves the launch signal.

## Architecture / reuse

- New pure modules under `packages/api/src/van-state/` (consumption, service-run)
  and `packages/api/src/daymap/` (briefing assembly) — unit-tested, no I/O.
- New `van_state_reading` table (rate-of-change); `daymap` tRPC router
  (`briefing`, `serviceAlerts`, `workWindows`), all `tripProcedure`, fail-soft.
- Reuse: `vanTelemetry` (deepen), `corridor`, `routePlanner.predictZones`,
  `weather/open-meteo`, `journey`, `fuel-logs`. Keep the DriftPort call behind the
  existing service-token + flag; **manual entry is the always-available fallback.**
- **CLI parity** (per the agent-assist goal): extend `scripts/journey.ts` (or a
  `daymap` CLI) with `van-state set`, `service-alerts`, `briefing` so agents can
  drive/inspect the day-map like the app.

## Phasing

1. **VanState + manual entry + persistence** (tanks/power/propane/trash) — the
   substrate. Works without DriftPort.
2. **Feature A** (consumption model + route-matched service alerts) — the
   differentiator; highest "better than maps" signal.
3. **Feature B2** (daily briefing assembling drive/stop/weather/service) +
   Obsidian export — the launch-signal artifact.
4. **Feature B1** (work-window finder) — leans hardest on deep DriftPort power +
   Starlink state.
5. **Deepen DriftPort** throughout: real tank/power/Starlink metrics replace
   manual entry as the rig comes online; alerts become truly predictive.

## Open questions

- DriftPort metric names for grey/black/propane/starlink — confirm against
  `system.dashboard` (align `VanState` mapping).
- Starlink sky-openness data source (terrain/canopy) vs. a simple "open area" heuristic.
- How much of the daily loop is Sortey vs. BizPulse/Calzone (work + deadlines) —
  Sortey owns the *physical* day; it should *link*, not absorb, the others.
