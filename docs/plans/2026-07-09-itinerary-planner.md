# Itinerary Planner — Design & Implementation Plan

**Date:** 2026-07-09  
**Status:** P0–P3.5 shipped (2026-07-12); P2 hour packer / P4 dual-candidate / formal pause state remaining  
**Dogfood scenario:** Open Sauce 2026 road trip (Hood → Bend → Crater → coast → San Mateo → Yosemite → Moab)

## Problem

Trip planning currently lives in chat with an agent: day intents, play vs drive days, fixed anchors (Open Sauce, Ahwahnee), live replan from “we’re at Zigzag,” and cut-lists when behind schedule. That must live **in Sortey** as structured data + UI, not conversation logs.

## Principle

> **The planning unit is the calendar day, not the polyline.**  
> The route is geometry. The day is the plan: intent, overnight, one hero effort, and what to cut.  
> Anchors are non-negotiable. Everything between anchors is recomputed from live position.

## Vocabulary (add to CONTEXT.md)

| Term | Definition |
|---|---|
| **Trip Day** | One calendar day on a road trip with intent, overnight, optional hero, and time blocks. |
| **Day Intent** | `play` \| `drive` \| `position` \| `event` \| `recovery` |
| **Anchor** | Fixed commitment (event, lodging reservation, must-see date). Already: `trip_anchor`. |
| **Hero Effort** | At most one featured activity per day (hike, swim, park). |
| **Replan** | Regenerate trip days from current position until the next anchor, honoring prefs. |

_Avoid:_ calling a Trip Day an “itinerary event” (destination-mode concept) or a “segment” (drive geometry).

## Relationship to existing systems

| Existing | Role after planner |
|---|---|
| `trip_segment` | Drive geometry for a day (optional 0–N segments per day) |
| `trip_anchor` | Hard constraints (Open Sauce, Ahwahnee) — **P0 surface** |
| `daymap` briefing | Renders **today’s** Trip Day + weather/POIs |
| Journey log | Actuals (“we camped here”) vs planned Trip Days |
| TripTik | Primary **editor** for Trip Days (not only segments) |
| Auto-split | Hour-based A→B only; planner is **date-aware** packer |

## Data model

### `trip_day` (new)

```
id, tripId
date                 -- YYYY-MM-DD, unique per trip
intent               -- play | drive | position | event | recovery
title                -- "Bend / Deschutes"
overnightName
overnightKind        -- dispersed | campground | hotel | unknown | null
overnightLat/Lng     -- optional
heroTitle, heroDetail
cutIfBehind          -- free text: what to drop first
blocksJson           -- [{ part, title, detail }] morning|midday|afternoon|evening
segmentId            -- optional FK to primary drive segment
sortOrder
note
createdAt, updatedAt
UNIQUE(tripId, date)
```

### Anchors (existing `trip_anchor`)

Kinds: `event` | `reservation` | `lodging` | `must_see`  
No schema change for P0 — wire UI + use in replan.

## API (`planner` router)

| Procedure | Purpose |
|---|---|
| `listDays` | All trip days ordered by date |
| `upsertDay` | Create/update one day by date |
| `deleteDay` | Remove a day |
| `seedRange` | Create empty/default days for `[from, to]` |
| `applyDraft` | Replace days in a range with a draft array (from replan) |
| `replanDraft` | Pure draft: position + until anchor + prefs → `DayPlanDraft[]` (no write) |
| Anchors | Existing `anchors.*` — list/create/update/delete/next |

### `replanDraft` input (P1)

```ts
{
  tripId, workspaceId,
  fromDate: string,          // first day to plan (often "today")
  untilDate: string,         // last day inclusive before/at buffer
  mustVisits?: { name: string; nights?: number; intent?: DayIntent }[],
  playDates?: string[],      // force play intent on these dates
  defaultOvernightKind?: OvernightKind,
}
```

P1 algorithm: pack must-visits left-to-right across the date range; mark `playDates`; remaining days `drive` or `position` near the end. No Google routing yet (P2).

## UI

### Web (command center)

- Road-trip left rail: **Day plan strip** (intent badge, overnight, hero) when days exist; fall back to segment TripTik.
- Inspector tab **Plan**: edit selected day + list anchors with “next anchor” pacing.
- Seed range control: from/to dates → `seedRange`.

### Expo

- Trip home: “Day plan” entry.
- Screen: scroll of days + anchors; tap day to edit intent/overnight/hero.
- “Replan from today” → preview draft → apply.

## Phases

| Phase | Outcome | Acceptance |
|---|---|---|
| **P0** | Anchors visible on road-trip UI; next-anchor pacing | ✅ |
| **P1** | `trip_day` CRUD + Day plan strip + seed/replan draft | ✅ |
| **P1.5** | Full multi-stop itinerary (`planItinerary`) | ✅ Hood→Moab template + map markers |
| **P1.6** | Replan from today / GPS + day chips + callouts | ✅ |
| **P3** | Daymap briefing reads Trip Day blocks / hero / cut | ✅ Drive mode + web briefing card |
| **P3.5** | Selected-day leg highlight on map | ✅ |
| **P2** | Date-aware packer uses max drive hours | Partial (waypoint packer; hour-split still for plain A→B) |
| **P4** | Must-visit waypoints + route candidates | Partial (template stops; no dual-candidate UI) |
| **P5** | Experience POIs + cut-if-behind automation | Partial (cut text + hero blocks seeded) |
| **P6** | Side-trip detect + prompt | ✅ `assessSideTrip` + Drive banner (no paused-trip state yet) |

### End-to-end loop (shipped)

1. **Build full map plan** → segments + trip days + anchors + default time blocks  
2. **Map** shows corridor, overnight markers, day chips; select day → highlight that leg  
3. **Day plan** edits intent / overnight / hero / cut / blocks; briefing card for selected date  
4. **Drive mode** shows today's plan + schedule from daymap briefing  
5. **Replan from today / GPS** keeps past days, rewrites future legs from live position  
6. **Mobile** chips, pull-to-refresh, map callout → day editor  
7. **iOverlander amenities** — sleep / parking / dump / water / fuel / toll near each day; apply sleep to trip day  

### Long-term amenity planning (E2E)

| API | Role |
|---|---|
| `planner.suggestOvernights` | Sleep POIs near a day's endpoint |
| `planner.suggestAmenities` | Service/fuel/parking/toll near a day |
| `planner.suggestOvernightsTrip` | Whole-trip overnight scan |
| `planner.applyOvernight` | Set trip day overnight from imported POI |
| `planner.autoAssignOvernights` | Best sleep per night (skip hotels) |
| `planner.scanAmenities` | Per-day sleep/dump/water/fuel/parking/tolls + warnings |
| `planItinerary.autoAssignOvernights` | Default on after full plan build |
| `corridor.searchImported` | `group` / `categories` / `rankByDistance` |
| `corridor.amenityGroups` | sleep / parking / service / fuel / food / road |
| `POST /api/poi/ioverlander` | Workspace-scoped CSV import |

**UI:** Amenity scan panel (import CSV, auto-assign, per-day warnings) · day editor Sleep/Service/Fuel/Park/Road · map amenity chips · drive mode today's amenities · day chips flag sleep/fuel/dump/toll.

iOverlander category map includes parking, overnight parking, tolls, wifi, medical.  
Imports remain **workspace-scoped** (licensing).

### Full map plan (P1.5)

`planner.planItinerary({ template: "open_sauce_full" })`:

1. Loads ordered stops with lat/lng (Hood → Bend → Crater → Port Orford → Redwoods → North Bay → San Mateo → Yosemite → Ahwahnee → Reno → NV → Bryce → Moab).
2. Routes each leg (Google Routes, straight-line polyline fallback).
3. Writes `trip_segment` per leg, `trip_day` per calendar night, `trip_anchor` for Sauce / parks / Ahwahnee.
4. `getPlanMap` feeds overnight + anchor markers on the gradient map.

This is the in-app version of the multi-state route image.

## Golden scenario (tests + dogfood)

```
Jul 11  play      Bend          Smith Rock + lakes/Newberry
Jul 12  drive     Crater Lake   Rim
Jul 13  drive     Port Orford   West cut + ocean
Jul 14  play      Redwoods      One grove hike
Jul 15  position  North Bay     Stage for San Mateo
Jul 16  position  San Mateo     Buffer
Jul 17–19 event   San Mateo     Open Sauce (anchor)
Jul 20–22 play    Yosemite NF   Real park days
Jul 23  recovery  Ahwahnee      Anchor lodging
```

## Non-goals (P0/P1)

- LLM chat as source of truth
- Turn-by-turn navigation
- Auto-booking lodging
- Full coast-vs-inland multi-candidate solver (P4)

## Files (P0/P1)

| Path | Change |
|---|---|
| `docs/plans/2026-07-09-itinerary-planner.md` | This doc |
| `CONTEXT.md` | Trip Day / Day Intent vocabulary |
| `packages/db/src/schema.ts` | `tripDays` table |
| `packages/db/drizzle/0010_*.sql` | Migration |
| `packages/api/src/route-planner/day-plan.ts` | Pure types + replan draft |
| `packages/api/src/route-planner/day-plan-ops.ts` | Persistence |
| `packages/api/src/router/planner.ts` | tRPC |
| `packages/api/src/root.ts` | Register `planner` |
| `packages/api/src/route-planner/__tests__/day-plan.test.ts` | Unit tests |
| `apps/nextjs/.../day-plan-panel.tsx` | Plan UI |
| `apps/nextjs/.../road-trip-dashboard.tsx` | Wire plan + anchors |
| `apps/expo/.../day-plan.tsx` | Mobile plan screen |
