# Design: Today Command + Reality Replan

**Date:** 2026-07-12  
**Status:** Draft — W1 + W2 designed together for van dogfood  
**Dogfood:** Open Sauce 2026 road trip (Crater Lake → coast → Sauce → Yosemite → Moab)  
**Principle:** Sortie is the **trip companion**, not the navigator. Today is the primary screen; replan is a first-class action from that screen, not a separate “power user” path.

---

## 1. Problem

We have multi-day **Trip Days**, anchors, amenities, Drive mode, and side-trip *detection*. On the rim at Crater Lake we still had to think in chat-level fidelity:

- What is the **next 2 hours**?
- When do we **leave** to protect tomorrow (Port Orford)?
- Is **tonight’s sleep** still good?
- If we’re late / side-tripped / stayed longer — **rewrite remaining days** without an agent.

Those two needs are one product surface:

1. **Today Command** — glanceable execution of the current calendar day  
2. **Reality Replan** — draft → apply when reality diverges, always reachable from Today  

---

## 2. Goals / non-goals

### Goals

| ID | Goal |
|---|---|
| G1 | One mobile entry: **Today** answers hero, cut, leave-by, sleep, amenity reds, navigate, log done |
| G2 | Replan is **draft-first, apply-second**, never silent overwrite of past days |
| G3 | Side-trip / behind / stayed longer share **one replan pipeline** with different presets |
| G4 | Anchors (Open Sauce, Ahwahnee) are **never moved** by soft replan |
| G5 | Web road-trip dashboard shows the same Today + replan preview (parity) |

### Non-goals (this wave)

- Turn-by-turn navigation  
- Auto-booking campsites  
- Dual-candidate coast-vs-inland solver  
- Background Always-on GPS / CarPlay  
- Offline-first full trip cache (note: **today+tomorrow snapshot** is in-scope light)  
- driftport hardware  

---

## 3. Vocabulary (additions)

| Term | Definition |
|---|---|
| **Today Command** | The primary mobile/web surface for the current Trip Day: execution, not full plan editor. |
| **Leave-by** | Latest departure time (or “leave now”) to hit the next overnight or anchor with a daylight / max-drive budget. |
| **Day status** | `planned` \| `active` \| `done` \| `skipped` \| `partial` — actuals vs plan for a Trip Day. |
| **Trip run state** | `on_plan` \| `side_trip` \| `paused` — execution state orthogonal to day status. |
| **Replan reason** | `behind` \| `side_trip` \| `stayed` \| `manual` — preset that seeds replanDraft inputs. |
| **Replan draft** | Non-persisted `DayPlanDraft[]` (+ optional segment rewrite flags) for preview. |
| **Soft replan** | Rewrite days/segments **on or after `fromDate`** only; past stays. |

_Avoid:_ calling Today Command “dashboard” (overloaded with trip dashboard).

---

## 4. System shape

```
┌─────────────────────────────────────────────────────────┐
│  Today Command (mobile primary / web panel)               │
│  - Trip Day + briefing + amenities + leave-by             │
│  - Navigate · Log done · Cut mode · Replan…               │
└───────────────┬─────────────────────────┬─────────────────┘
                │                         │
                ▼                         ▼
        day status / log stop      Replan sheet
                │                   (reason + GPS)
                │                         │
                │                         ▼
                │              planner.replanPreview
                │              (draft, no write)
                │                         │
                │                         ▼
                │              user Accept / Discard
                │                         │
                │                         ▼
                │              planner.applyReplan
                │              (days ± segments ± overnights)
                ▼
         journey / trip_day.updated
```

**Drive Mode** becomes a *thin* shell: Today Command summary + route-ahead + side-trip banner that deep-links into Replan with reason `side_trip`.

**Day Plan** remains the full multi-day editor; Today does not replace it.

---

## 5. W1 — Today Command

### 5.1 Data: `planner.todayCommand`

Single query assembling what the phone needs (one round-trip).

**Input**

```ts
{
  workspaceId, tripId,
  date?: string,           // default: today in trip tz
  lat?: number, lng?: number,  // live GPS for leave-by + side-trip
  now?: string,            // ISO; tests only
}
```

**Output (conceptual)**

```ts
{
  date, tz,
  day: TripDay | null,           // intent, title, hero, cut, overnight, blocks
  dayStatus: DayStatus,          // planned|active|done|skipped|partial
  runState: RunState,            // on_plan|side_trip|paused
  nextAnchor: { title, startDate, endDate, kind, milesAway?, daysAway } | null,
  leaveBy: {
    target: "overnight" | "anchor" | "next_day_drive",
    leaveByLocal: string | null, // "14:30" in trip tz
    reason: string,              // "Port Orford ~200mi · aim daylight"
    minutesSlack: number | null, // negative = already late
  } | null,
  amenities: {                   // today’s amenity scan row
    overnight, dump, water, fuel, parking, tolls, warnings
  } | null,
  briefing: DayBriefing | null,  // existing daymap shape (subset)
  tomorrow: { date, title, intent, overnightName, driveMilesEstimate } | null,
  sideTrip: SideTripAssessment | null, // if lat/lng provided
  actions: {
    canReplan: true,
    canMarkDone: boolean,
    navigateOvernight: { lat, lng, label } | null,
    navigateFuel: { lat, lng, label } | null,
  }
}
```

**Leave-by algorithm (v1, deterministic)**

1. Resolve **target** = next night’s overnight coords if set, else next anchor with coords, else tomorrow’s destination from segment.  
2. Estimate road miles (segment sum remaining today + first leg tomorrow, or haversine × 1.3 fallback).  
3. Hours = miles / 45 (coast/mountain default) or van AVG if known.  
4. Desired arrival = sunset − 1h at target (reuse suncalc like route-planner) or 18:00 local if unknown.  
5. `leaveBy = arrival − hours − 0.5h buffer`.  
6. If `now > leaveBy`, `minutesSlack` negative and UI shows **LATE — cut or replan**.

### 5.2 Day status persistence

Add columns on `trip_day` (migration `0011`):

| Column | Type | Notes |
|---|---|---|
| `status` | text | `planned` default; enum above |
| `completed_at` | timestamptz | when marked done |
| `actual_note` | varchar(500) | “Rim Drive only” |

API: `planner.setDayStatus({ date, status, actualNote? })`.

Marking **done** may prompt “Log a stop?” → existing `journey.logStop` with kind scenic/overnight.

### 5.3 Mobile UI — route `/trip/[tripId]/today`

**Default home for roadtrip** when trip is `active` (road-trip-detail entry: **Today** first).

Layout (top → bottom):

1. **Header** — date · intent badge · run state chip  
2. **Hero** — title + hero detail  
3. **Cut if behind** — warning tone if `minutesSlack < 0` or user toggles Cut mode  
4. **Leave-by** — large monospace time + reason + slack  
5. **Tonight** — overnight name · kind · Navigate  
6. **Services** — fuel / dump / water reds from scan (tap → map or Maps deep link)  
7. **Tomorrow one-liner** — so today decisions account for next day  
8. **Primary actions**  
   - Mark done / partial  
   - **Replan…** (opens sheet)  
   - Full day plan  
9. **Secondary** — Map · Drive · Log stop · Journey  

**Cut mode:** collapses to hero + cut + leave-by + overnight only (one-thumb).

### 5.4 Web

`TodayCommandPanel` on road-trip dashboard above day chips — same query; replan opens modal.

### 5.5 Maps deep links

`Navigate` uses platform URLs:

- iOS: `maps://?daddr=lat,lng`  
- Android: `google.navigation:q=lat,lng`  
- fallback: `https://www.google.com/maps/dir/?api=1&destination=lat,lng`

---

## 6. W2 — Reality Replan (first-class from Today)

### 6.1 Unified pipeline

Existing pieces:

- `replanDraft` (day intents only, pure)  
- `planItinerary` with `fromDate` + `origin` (segments + days + anchors + optional overnights)

**New:** one user-facing flow that chooses how deep to rewrite.

| Mode | Days | Segments | Overnights | Anchors |
|---|---|---|---|---|
| **Soft days** | rewrite ≥ fromDate | keep | optional re-assign | keep |
| **Soft route** | rewrite ≥ fromDate | rewrite ≥ fromDate | auto-assign non-hotel | keep if ≥ fromDate only deletes future anchors |
| **Hard rebuild** | template full | full | auto | replace (existing planItinerary; confirm twice) |

Van dogfood default: **Soft route** from today + live GPS.

### 6.2 Replan reasons → presets

| Reason | fromDate | origin | mode | UX copy |
|---|---|---|---|---|
| `behind` | today | GPS or last overnight | soft route | “Compress remaining days to next anchor” |
| `side_trip` | today | GPS | soft route + set runState paused→side_trip | “Resume from here; keep past days” |
| `stayed` | tomorrow | current overnight coords | soft route | “Push remaining plan one day” (shift) *or* compress — see below |
| `manual` | user pick | optional GPS | user picks mode | Full controls |

**`stayed` v1:** shift all flexible days after today by +1 night until next anchor (bump dates); if that would collide with anchor, **compress** instead (drop a play day / shorten extraNights). Algorithm pure function + tests.

### 6.3 API

#### `planner.replanPreview`

```ts
input: {
  workspaceId, tripId,
  reason: "behind" | "side_trip" | "stayed" | "manual",
  fromDate: string,
  mode: "soft_days" | "soft_route",
  origin?: { lat, lng, name? },
  // manual overrides
  untilDate?: string,
  maxDriveHours?: number, // default 10
}
output: {
  reason, mode, fromDate,
  draftDays: DayPlanDraft[],
  // if soft_route:
  proposedLegs?: { fromName, toName, date, milesEstimate }[],
  keptPastDays: number,
  nextAnchor: ...,
  warnings: string[],  // "Open Sauce immovable", "Tight: 2 days for 400mi"
  summary: string,     // one paragraph for Accept screen
}
```

Implementation:

1. Load days, anchors, segments.  
2. Apply reason preset.  
3. Soft days: `replanDraft` between fromDate and day before next anchor (or trip end).  
4. Soft route: `remainingStopsFromDate` from template **or** rebuild stop list from existing future days’ overnight coords + titles; inject origin; call routing estimates (no write).  
5. Return draft only.

#### `planner.applyReplan`

```ts
input: {
  workspaceId, tripId,
  preview: // same shape as preview output OR re-run with identical inputs + acceptToken
  reassignOvernights?: boolean, // default true for soft_route
}
```

Writes via existing `applyDraft` + segment rewrite path extracted from `planItineraryOp` (`fromDate` branch). Sets `runState` back to `on_plan` unless user stays paused.

**Idempotency:** accept uses server-side recompute from inputs (don’t trust client draft for writes) — client preview is display-only; apply re-runs preview server-side then commits.

### 6.4 Trip run state

Store on `trip` (or lightweight `trip_runtime` row):

| Field | Values |
|---|---|
| `run_state` | `on_plan` \| `side_trip` \| `paused` |
| `run_state_since` | timestamptz |
| `run_state_note` | optional |

Side-trip card actions:

- **Explore (pause)** → `run_state = side_trip`, keep breadcrumbs  
- **Replan from here** → open Replan sheet reason=`side_trip`  
- **Dismiss** → hide until next off-route  

While `side_trip` / `paused`: Today Command banner “Exploring — corridor guidance soft”; leave-by still shown to next anchor.

### 6.5 Replan sheet UX (mobile)

1. Reason chips (Behind / Side trip / Stayed / Custom)  
2. Show **summary** + warnings + draft day list (compact)  
3. Toggle: reassign overnights  
4. **Accept** / Discard  
5. On Accept: toast “Plan updated · N days” → Today refreshes  

Web: same in modal from Today panel + day-plan panel.

---

## 7. Cross-cutting

### Caching / light offline

- React Query: `todayCommand` staleTime 60s; replanPreview no cache.  
- On successful fetch, write `todayCommand` snapshot to AsyncStorage keyed by tripId+date for **read-only** last-known if network fails (v1: display only, mutations queue later — **mutations require network** in this wave).

### Permissions

- Foreground location for leave-by + side-trip (existing).  
- No Always upgrade required for W1/W2.

### Telemetry (if PostHog later)

- `today_command_view`, `replan_preview`, `replan_apply`, `day_status_set`, `side_trip_pause`.

### Testing

| Layer | Cases |
|---|---|
| Pure | leave-by math; stayed shift vs compress; remainingStopsFromDate |
| Ops | replanPreview soft_route keeps past segments; apply doesn’t delete past |
| Router | unauthorized; accept recompute |
| Maestro | open Today · open Replan sheet (best-effort) |

---

## 8. File map (implementation)

| Area | Paths |
|---|---|
| Schema | `packages/db` — `trip_day.status`, `trip.run_state*` · migration 0011 |
| Leave-by / replan pure | `packages/api/src/route-planner/today-command.ts`, `replan-reality.ts` |
| Ops | `today-command-ops.ts`, extend `plan-itinerary-ops` extract |
| Router | `planner.todayCommand`, `setDayStatus`, `replanPreview`, `applyReplan` |
| Expo | `app/trip/[tripId]/today.tsx`, replan sheet component, Drive/home links |
| Web | `today-command-panel.tsx`, wire dashboard |
| Docs | this file; update planner plan phases W1/W2 |

---

## 9. Phased delivery (still one design)

| Slice | Deliverable | Acceptance |
|---|---|---|
| **S0** | Schema + setDayStatus + run_state | DB applied; API only |
| **S1** | `todayCommand` query + pure leave-by tests | Curl/unit green |
| **S2** | Mobile Today screen + entry points | Crater-style day usable offline-read |
| **S3** | replanPreview + sheet (soft_days) | Preview behind without write |
| **S4** | applyReplan soft_route + GPS origin | Accept rewrites future segs/days |
| **S5** | Side-trip → pause + replan reason | Banner actions wired |
| **S6** | Web parity + Maestro | Dashboard Today + replan modal |

Ship order **S0→S6**; dogfood after **S2** and again after **S4**.

---

## 10. Success criteria (dogfood)

Standing at a place like Crater Lake or Port Orford:

1. Open app → **Today** shows hero, cut, leave-by, tonight, tomorrow one-liner.  
2. Navigate opens Maps to overnight.  
3. Mark done / partial in <5s.  
4. Behind schedule → Replan → see draft → Accept → remaining days make sense; Open Sauce dates unchanged.  
5. Off corridor → prompt → Explore or Replan from here.  

---

## 11. Open decisions (resolve during implement if needed)

1. **`stayed` default:** shift-forward vs compress-first when anchor is near? **Recommend:** compress if shift would hit anchor within 1 day; else shift.  
2. **Soft route stop list source:** re-use template stops vs rebuild from existing future day titles/coords? **Recommend:** prefer **existing future days’ endpoints** (preserves curation); fall back to template remainingStops.  
3. **Today as default tab** vs keep Drive as default when moving? **Recommend:** roadtrip home → Today; Drive linked from Today when speed > threshold later (out of scope).  

---

## 12. Next step

After design approval: implementation plan task-by-task (`writing-plans`) and execute **S0–S2** first for on-van value, then **S3–S5** replan loop.
