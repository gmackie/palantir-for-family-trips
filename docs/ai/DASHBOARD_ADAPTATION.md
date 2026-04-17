# Dashboard Adaptation — Demo → Live Trip UI

## Principle

The existing demo dashboard at `/demo` (ported from the original Vite app) IS the product design. Every trip view should look exactly like it, with live data from tRPC replacing the hardcoded Pine Mountain Lake fixtures.

The demo has: left nav rail, situation board, command map (center), inspector rail (right), timeline board (bottom), family travel units, planning tasks, playback controls, daily briefing. All of this stays. The new features (expenses, settlement, polls, proposals, arrivals, lodging) render as panels within this existing frame, not as separate pages.

## Source Files

The demo components live at `apps/nextjs/src/app/demo/_components/`:
- `app-shell.tsx` — 5000 lines, the entire UI including all page components
- `command-map.tsx` — 2700 lines, Google Maps with route rendering
- `inspector-rail.tsx` — 800 lines, right-side context panel
- `trip-model.ts` — 2700 lines, data model logic
- `trip-data.ts` — 370 lines, hardcoded trip fixture data
- `weather.ts` — 180 lines, weather API
- `demo-styles.css` — dark theme CSS

## Data Model Mapping

| Demo concept | Demo data source | Live data source (tRPC) |
|---|---|---|
| Trip document | `tripData.ts` fixtures + localStorage | `trips.get({ tripId })` |
| Families / Travel Units | `PUBLIC_FAMILY_PROFILES` in tripModel | `tripMembers` with role + displayName + colorHex |
| Locations (basecamp, restaurants) | Hardcoded in tripData | `pins` with type=lodging/meal/activity |
| Routes (LA→PML, SF→PML) | Hardcoded polylines in tripData | Google Maps Directions API between pins |
| Itinerary Items | `itineraryItems` array in tripData | `pins` with startsAt/endsAt sorted by time |
| Meals | `meals` array in tripData | `pins` with type=meal |
| Activities | `activities` array in tripData | `pins` with type=activity |
| Stay Items | `stayItems` array in tripData | `lodgings` with check-in/check-out |
| Expenses | `expenses` array in tripData | `expenses.list({ tripId })` |
| Tasks | `tasks` array in tripData | `polls` (planning mode) or manual tasks |
| Timeline slots | `TIME_SLOTS` constant | Computed from trip startDate/endDate + segment dates |
| Days | `DAYS` constant | Computed from trip date range |
| Navigation pages | Hardcoded `NAV_ITEMS` | Same items: Itinerary, Stay, Meals, Activities, Expenses, Families |
| Viewer profile | localStorage `VIEWER_PROFILE_STORAGE_KEY` | Session user from Better Auth |
| Entity selection | `doc.ui.selectedEntity` | URL state or React state |
| Weather | OpenWeatherMap API | Same (or deferred) |
| Map center | Hardcoded `PUBLIC_BASECAMP_COORDINATES` | `trip.destinationLat/Lng` |
| Map routes | Hardcoded route paths | Google Maps Directions between pins |

## New Panels (not in demo, need to be designed)

These features exist in the tRPC API but have no dashboard-style UI yet. They need to be designed as panels within the existing dashboard frame, matching the dark Palantir aesthetic.

### 1. Expenses Panel (replaces light-mode /expenses page)
- Lives in the inspector rail when "Expenses" nav is active
- Shows expense cards: merchant, total (monospace), category icon, status badge, payer
- Tap a card → expense detail slides in with line items + claim UI
- "New expense" button opens a compact dark-themed form (not a full page)
- Receipt upload inline with OCR progress skeleton
- Share summary at the bottom of each expense

### 2. Settlement Panel (replaces light-mode /settle page)
- Inspector rail view when "Settlement" nav icon is active
- Balance cards per member: green (owed) / red (owes), monospace dollar amounts
- Suggested transactions list with "Mark paid" buttons
- Venmo deep-link icons next to each transaction
- "Everyone's square" celebration state
- Compact, data-dense, same card style as the situation board

### 3. Polls Panel (replaces light-mode /plan/polls pages)
- Inspector rail view during planning mode
- Active polls as cards with vote counts
- Tap a poll → voting interface slides in
- Date polls render as a mini availability grid (green/yellow/red cells)
- Results bar charts for single/multi choice
- "Create poll" as a compact inline form

### 4. Proposals Panel (replaces light-mode /plan/proposals page)
- Inspector rail view alongside polls during planning mode
- Proposal cards with image thumbnail (from URL parsing), title, price, reaction counts
- Reaction buttons (up/down/interested) inline on each card
- Filter pills by type (flight/lodging/car/activity)
- "Add proposal" as compact inline form with URL paste

### 5. Arrivals Board Panel
- Situation board component (left side, above travel units)
- Airport-style arrival/departure rows: carrier + number, route, status badge, scheduled/ETA times
- Color-coded status: scheduled (blue), en_route (yellow), delayed (red), arrived (green)
- Monospace times throughout

### 6. Lodging Panel
- Inspector rail view when "Stay" nav is active
- Property cards with provider icon (Airbnb/hotel/VRBO), name, dates, address
- Check-in instructions prominently displayed
- Guest list with member chips
- Cost per night + total in monospace

### 7. Ground Transport Panel
- Sub-section of arrivals board
- Group cards: "Airport pickup group 1 (arriving ~3pm)" with member avatars
- Transport type icon (car/taxi/shuttle/transit)
- Cost split preview

## Architecture

### Single Route: `/trips/[tripId]`

The entire trip UI is ONE client component (like the demo's `App` component) that:
1. Loads all trip data via tRPC on mount
2. Manages internal page state (which nav item is active, which entity is selected)
3. Renders the same frame: left rail + map + inspector + timeline
4. Switches inspector content based on active nav item
5. Updates map pins/routes based on the data

### Component Structure

```
TripDashboard (client, "use client")
├── TopBar (trip name, status, segment switcher, member avatars)
├── LeftNavRail (icon buttons: Itinerary, Stay, Meals, Activities, Expenses, Families, Settings)
├── SituationBoard (left panel: mission status, arrivals, weather, travel units)
├── CommandMap (center: Google Maps with pins, routes, overlays)
├── InspectorRail (right panel: context-sensitive based on nav selection)
│   ├── ItineraryInspector (pin details, timeline context)
│   ├── StayInspector (lodging details, room assignments)
│   ├── MealsInspector (meal pins, restaurant details)
│   ├── ActivitiesInspector (activity pins)
│   ├── ExpensesInspector (expense list, detail, claiming)
│   ├── SettlementInspector (balances, suggested payments)
│   ├── FamiliesInspector (member profiles, arrival status)
│   ├── PollsInspector (planning mode: polls + voting)
│   └── ProposalsInspector (planning mode: proposals + reactions)
├── TimelineBoard (bottom: Gantt grid with day/hour columns, pin bars)
└── Modals
    ├── DailyBriefingModal
    ├── MissionLaunchModal (trip kickoff)
    └── NewExpenseModal (compact dark form)
```

### Data Loading

```typescript
// Single tRPC call per data type, all loaded in parallel on mount
const [trip, segments, members, pins, expenses, settlements, polls, proposals, lodgings, transits] = await Promise.all([
  trpc.trips.get.queryOptions({ workspaceId, tripId }),
  trpc.trips.listSegments.queryOptions({ workspaceId, tripId }),
  // ... etc
]);
```

### Dark Theme

Every component uses DESIGN.md tokens:
- Background: `#0A0C10`
- Surface/cards: `#161B22`
- Borders: `#21262D` / `#30363D`
- Text: `#C9D1D9` (primary), `#8B949E` (muted)
- Accent: `#58A6FF` (info/links)
- Monospace numbers: `font-family: 'Geist Mono'; font-variant-numeric: tabular-nums`
- Status colors: red `#F85149`, amber `#D29922`, green `#3FB950`, blue `#58A6FF`

## Implementation Order

1. **Extract reusable components** from `app-shell.tsx`: NavRail, SituationBoard, TimelineBoard, InspectorRail frame, StatusPill, SectionTitle, InfoRow, SelectableCard
2. **Build TripDashboard** as a client component at `/trips/[tripId]/page.tsx` that uses these components with tRPC data
3. **Wire CommandMap** to live pins + Google Maps Directions
4. **Build new inspector panels** (Expenses, Settlement, Polls, Proposals, Arrivals, Lodging) matching the existing dark aesthetic
5. **Wire TimelineBoard** to live pins sorted by startsAt across trip days
6. **Delete the separate light-mode pages** (/expenses, /settle, /plan/*, /map, /itinerary, /lodging, /dashboard)

## Design Mockup Needs

Before building, generate HTML mockups for:
- ExpensesInspector panel (expense list + detail + claiming in dark theme)
- SettlementInspector panel (balances + transactions in dark theme)
- PollsInspector panel (poll cards + voting UI in dark theme)
- ProposalsInspector panel (proposal cards + reactions in dark theme)
- ArrivalsBoard section (airport-style transit rows in dark theme)

These mockups should match the existing demo's visual density and dark palette exactly.
