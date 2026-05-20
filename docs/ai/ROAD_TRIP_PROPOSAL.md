# Road Trip Mode — Sortie Feature Proposal

Source: brainstorming + design interrogation session 2026-05-20.

## Context

The user has a converted Sprinter van (gasoline, ~15 MPG, ~24.5 gal tank) and is road-tripping from Seattle → Des Moines (~1,800 miles, ~5 days) starting ~June 5, leading into the family reunion June 10-15. Road trip mode is a separate mode from the group trip planner, sharing core features (expenses, OCR, map, auth). Solo traveler for road trips.

## Mental Model

**Destination trip (existing):** You're AT a place. Map shows an area. Segments are locations you stay.

**Road trip (new):** You're MOVING between places. Map shows a route. Segments are driving legs.

### Example: Seattle → Des Moines

| Segment | Route | Miles | Hrs | Overnight |
|---------|-------|-------|-----|-----------|
| Seattle → Missoula | I-90 E | 475 | 7 | Near Missoula |
| Missoula → Billings | I-90 E | 345 | 5 | BLM land |
| Billings → Rapid City | I-90 E | 375 | 5.5 | Near Badlands |
| Rapid City → Sioux Falls | I-90 E | 350 | 5 | Campground |
| Sioux Falls → Des Moines | I-90/I-35 | 240 | 3.5 | Arrive! |

## What's Shared vs. New

### Shared (no changes needed)
- Auth + workspace model
- Expense tracking + receipt OCR (solo mode: auto-assign all items to you)
- Pin system (extend types)
- Lodging table (overnight stays)
- Mobile app (Expo)

### Extended (small schema changes)
- `trips`: add `tripMode` enum ("destination" | "roadtrip"), add `tripStatus` values ("en_route", "paused")
- `tripSegments`: add `routePolyline`, `distanceMiles`, `durationMinutes`, origin lat/lng/name
- `pinType` enum: add "fuel", "water", "campsite", "dump_station", "rest_area", "scenic", "shower", "grocery", "propane", "laundry"
- `expenseCategory` enum: add "fuel", "camping"

### New tables
- `vanProfiles` — vehicle specs (per-workspace, same van across trips)
- `fuelLogs` — fill-up tracking (first-class, separate from general expenses)
- `imported_pois` — bulk-imported data with PostGIS geography (iOverlander)
- `poiCache` — cached external API results (Google Places, NPS, NREL, Recreation.gov)
- `gpsTrackPoints` — lightweight breadcrumbs (1 point / 5 min while driving)

## API Integration Stack

All free or generous free tier:

| API | Data | Free Tier | MVP? |
|-----|------|-----------|------|
| **Google Routes API** | Route polylines, distance, duration | 10K/month | Yes |
| **Google Places API (New)** | Gas stations, restaurants | 5-10K/month | Post-MVP (real-time prices) |
| **iOverlander** (JSON dump) | Free camping, water, dump stations, propane | Bulk download | Yes |
| **Recreation.gov (RIDB)** | Federal campgrounds, campsite detail | 50 req/min | Post-MVP |
| **NPS API** | National parks, trails, visitor centers | 1K req/hr | Post-MVP |
| **NREL Alt Fuel** | Propane/LPG stations | 1K req/hr | Post-MVP |
| **EIA API** | Regional gas price averages | Free | Post-MVP |

**API keys:** Separate server-side key (`GOOGLE_ROUTES_API_KEY`) for Routes + Places calls. Existing client-side key stays restricted to Maps JS API + domain.

## Design Decisions

### Route Planning
- **Multi-waypoint:** Origin + destination + optional intermediate waypoints (not just A→B)
- **Polyline storage:** Encoded polyline + summary stats (distance, duration, waypoint order). Discard step-by-step instructions and traffic data (ephemeral). Re-fetch if needed.
- **Full route polyline** on trip record, **segment sub-polylines** on each segment
- **Codec:** `@googlemaps/polyline-codec` for encode/decode

### Segment Auto-Split
- **Algorithm:** Walk route polyline forward in time. End a segment when `drivingHours >= 12` OR `hoursUntilSunset < 1`, whichever comes first.
- **Sunset calculation:** `suncalc` npm library (pure JS, zero dependencies, instant, works offline and in Workers)
- **Morning start:** Sunrise + 1 hour (pack-up time)
- **Segment editing:** Drag boundary on TripTik strip → cascading recalc of downstream segments, overnight zones, fuel predictions

### Route Gradient
- **Rainbow spectrum** color ramp encoding hours-from-now on the polyline
- **Implementation:** Split polyline into ~50-100 sub-segments, each with solid color. Looks smooth at map zoom levels.
- **Custom SVG markers** for predicted fuel stops and overnight zone endpoints
- **Day view:** Starts each day showing the full 12-hour gradient

### Overnight Zones
- **30mi radius** highlighted area near predicted sunset endpoint
- **Shows all overnight options** in the zone (not a single pin): campgrounds, BLM/USFS, iOverlander free camping
- **Subtle translucent** rendering on the map

### Corridor
- **30mi buffer** around route polyline
- **PostGIS `ST_DWithin`** queries against `imported_pois` and `poiCache` with geography index
- **Corridor boundary visible but subtle** on the map — translucent, toggleable
- **Hyperdrive compatibility:** Deferred verification to early Phase B (wire-protocol proxy, expected to work)

### Fuel Predictions
- **MVP:** Simple range math (MPG × tank size), fuel zone marker when remaining range < 80mi
- **Costco preference:** Costco gas stations get a visual badge/priority in results
- **Learning:** After 3-4 fill-ups, use actual MPG from fuel logs instead of estimate
- **Post-MVP:** Elevation-aware MPG (Google Elevation API for grade data), price optimization, clustering with other stops

### Side Trip Model
- **Off-route detection:** >2mi from polyline for a non-POI stop → prompt: "Side trip?"
- **Pause/Resume:** User can pause the trip to explore. Deviation marker placed on timeline at exit point. GPS still tracks but Sortie stops route guidance/corridor updates.
- **Resume options:** Pick up from pause point (back to highway) OR recalculate from current GPS position.

### Driving / Stopped Mode
- **Auto-detect + manual override:** GPS speed > 15mph for > 2 min → driving mode. Speed < 5mph for > 3 min → stopped mode. Manual button to force either.
- **Driving Mode UI:** Segment name, progress (mi/%), ETA, next predicted stop, fuel range, route gradient snippet. Large glanceable typography.
- **Stopped Mode UI:** Full Sortie interface — corridor search, TripTik strip, expense logging, segment editing.

### GPS Breadcrumbs
- **1 point every 5 minutes** while in driving mode
- ~84 points/day, ~420 points for a 5-day trip
- Stored in `gpsTrackPoints` table: `(tripId, segmentId, lat, lng, speed, timestamp)`
- Enables post-trip review, actual timing comparison, deviation history

### TripTik Strip View
- **Mobile:** Vertical timeline (primary planning view). Map secondary via tab.
- **Desktop:** Horizontal timeline + map side-by-side with linked highlighting.
- **Mile markers:** Cumulative miles from trip start (0, 200, 475, 820...)
- **Time estimates:** Both distance and time on each stop: "⛽ Fuel — mi 200 — ~10:15am"
- **Tappable items:** Each strip item opens info card / POI detail / fuel log entry

### POI Interaction
- **Tap POI → info card** with name, source badge, category, distance from route, reviews/notes
- **"Save to trip"** converts external POI to a trip Pin. Saved pins appear on TripTik strip.
- **"Navigate"** deep link via iOS share sheet (user picks Google Maps, Waze, Apple Maps, etc.)
- **Post-MVP:** "Add as waypoint" (re-routes through Google Routes API)

### Mobile App
- **Mode-aware screens:** Trip's `tripMode` determines which tab set loads
  - Destination tabs: Map | Expenses | Settle | Members
  - Road trip tabs: Route (map + strip) | Corridor (POI search) | Fuel | Expenses
- **Corridor search UI:** Horizontal filter chips (fuel, water, campsite, overnight, grocery...) + scrollable POI list sorted by distance along route. Map shows filtered results.

### Expense Model (Solo Road Trip)
- **Fuel logs are first-class**, separate from general expenses. Track odometer, gallons, price, station, calculate MPG.
- **Fuel log ↔ receipt link:** Gas station receipts from OCR prompt: "Log as fuel fill-up?" Pre-fills fuel log from receipt data.
- **Standard expenses:** Same system as destination mode, but auto-assign all OCR items to you (skip claiming flow).
- **Trip cost summary:** Total fuel cost, cost per mile, total non-fuel expenses, daily burn rate.

### Offline Support
- **Pre-fetch active corridor:** Cache POIs for current + next 2 segments on-device when connected.
- **Queue offline writes:** Fuel logs and expense entries sync when connectivity returns.
- **Route polyline already local** — map renders offline.
- **Full offline mode** (map tiles, entire corridor) deferred to post-MVP.

### Location Permissions
- **Destination mode:** "When In Use" (map coordination)
- **Road trip mode:** Progressive upgrade to "Always" on first driving mode activation
- **Apple justification:** "Sortie tracks your trip progress and alerts you when approaching predicted fuel and overnight stops, even while using another navigation app."

### Notifications
- **Fuel alert:** "Fuel zone in 30 miles — 3 stations ahead"
- **Overnight alert:** "1 hour until sunset — overnight zone in 25 miles"
- **Saved POI approaching:** "🏔️ Snoqualmie Pass in 15 miles"

### Road Trip Sharing
- **Read-only share link** (post-MVP): UUID-based URL, view route/POIs/strip in browser, no account needed
- **Trip owner** is the only one who can modify, log fuel, add expenses

### Road Trip Lifecycle
- **planning** → route entered, segments auto-split, reviewing the plan
- **en_route** → trip started, driving mode available, GPS tracking active
- **paused** → side trip / extended stop (deviation from route)
- **completed** → arrived at final destination

### Road Trip Dashboard (Web)
```
┌─────────────────────────────────────────────────────┐
│ SORTIE — Seattle → Des Moines          Day 2 of 5   │
├──────────────┬──────────────────────────────────────┤
│  TRIPTIK     │           MAP                        │
│  STRIP       │    (route with gradient,             │
│              │     corridor, POI markers,           │
│  Day 2       │     overnight zones)                 │
│  Missoula →  │                                      │
│  Billings    │                                      │
│              │                                      │
│  ⛽ mi 520   │                                      │
│  🏔️ mi 580   │                                      │
│  ⛽ mi 700   │                                      │
│  🌅 mi 820   │                                      │
│              │                                      │
├──────────────┼──────────────────────────────────────┤
│  FUEL LOG    │  TRIP STATS                          │
│  Last fill:  │  Total: 820/1,800 mi (46%)           │
│  12.4 gal    │  Fuel: $156.30 ($0.19/mi)            │
│  $3.89/gal   │  Avg MPG: 14.8 (est: 15.0)           │
│  14.2 MPG    │  Days remaining: 3                   │
└──────────────┴──────────────────────────────────────┘
```

### Trip Creation Flow (Road Trip)
1. **Create trip** — name, dates, select "Road Trip" mode
2. **Set vehicle** — pick existing van profile or create one
3. **Plan route** — origin + destination + optional waypoints → Google Routes polyline
4. **Auto-split** — suncalc + 12hr rules → proposed day-by-day breakdown
5. **Review & adjust** — drag segment boundaries, add/remove waypoints
6. **Corridor loads** — POIs populate along the finalized route

Steps 3-6 happen on a single "Route Planning" screen.

## Schema Additions

```sql
-- Trip mode (new column on existing table)
ALTER TABLE trips ADD tripMode varchar(20) DEFAULT 'destination';
-- Values: 'destination' | 'roadtrip'

-- Road trip status values added to tripStatus enum:
-- 'en_route', 'paused'

-- Van profile (per workspace — same van across trips)
CREATE TABLE vanProfiles (
  id uuid PRIMARY KEY,
  workspaceId uuid REFERENCES workspace(id),
  userId uuid REFERENCES users(id),
  name varchar(100),              -- "The Sprinter"
  vehicleType varchar(50),        -- "sprinter" | "transit" | "promaster" | "skoolie" | "other"
  year int, make varchar(100), model varchar(100),
  fuelType varchar(20),           -- "gas" | "diesel" | "e85"
  mpgEstimate numeric,            -- 15.0
  tankGallons numeric,            -- 24.5
  heightInches int,               -- for clearance warnings
  lengthFeet int,                 -- for parking
  createdAt timestamptz, updatedAt timestamptz
);

-- Extended segment fields for road trips
ALTER TABLE tripSegments ADD:
  originName varchar(200),
  originLat numeric, originLng numeric,
  routePolyline text,             -- Google encoded polyline (segment sub-polyline)
  fullRoutePolyline text,         -- Full trip route (on first segment or trip record)
  distanceMiles numeric,
  durationMinutes int,
  vanProfileId uuid REFERENCES vanProfiles(id);

-- Fuel logs (first-class, separate from general expenses)
CREATE TABLE fuelLogs (
  id uuid PRIMARY KEY,
  tripId uuid REFERENCES trips(id),
  segmentId uuid REFERENCES tripSegments(id),
  userId uuid REFERENCES users(id),
  vanProfileId uuid REFERENCES vanProfiles(id),
  odometerMiles numeric,
  gallons numeric,
  pricePerGallon numeric,
  totalCents int,
  fuelType varchar(20),
  stationName varchar(200),
  stationLat numeric, stationLng numeric,
  isCostco boolean DEFAULT false,
  loggedAt timestamptz,
  expenseId uuid REFERENCES expenses(id),  -- links to receipt if uploaded
  notes text,
  createdAt timestamptz
);

-- Imported POIs (bulk data with PostGIS geography)
CREATE TABLE imported_pois (
  id uuid PRIMARY KEY,
  source varchar(50),             -- "ioverlander"
  externalId varchar(200),
  name varchar(300),
  category varchar(100),          -- mapped to van life amenity taxonomy
  location geography(Point, 4326),
  data jsonb,                     -- raw source data
  importedAt timestamptz,
  UNIQUE (source, externalId)
);
CREATE INDEX imported_pois_location_idx ON imported_pois USING GIST(location);

-- POI cache (API results from Google Places, NPS, etc.)
CREATE TABLE poiCache (
  id uuid PRIMARY KEY,
  source varchar(50),             -- "google_places" | "nps" | "recreation_gov" | "nrel"
  externalId varchar(200),
  name varchar(300),
  category varchar(100),
  location geography(Point, 4326),
  data jsonb,
  fetchedAt timestamptz,
  expiresAt timestamptz,
  UNIQUE (source, externalId)
);
CREATE INDEX poi_cache_location_idx ON poiCache USING GIST(location);

-- GPS track points (lightweight breadcrumbs)
CREATE TABLE gpsTrackPoints (
  id uuid PRIMARY KEY,
  tripId uuid REFERENCES trips(id),
  segmentId uuid REFERENCES tripSegments(id),
  lat numeric,
  lng numeric,
  speed numeric,                  -- mph at time of recording
  recordedAt timestamptz
);
CREATE INDEX gps_track_trip_idx ON gpsTrackPoints(tripId, recordedAt);

-- New pin types: 'fuel', 'water', 'campsite', 'dump_station', 'rest_area', 'scenic',
--                'shower', 'grocery', 'propane', 'laundry'
-- New expense categories: 'fuel', 'camping'
```

## iOverlander Import Pipeline

One-time Node script in `packages/db/scripts/import-ioverlander.ts`:

1. **Download** US JSON dump from iOverlander
2. **Transform** — map iOverlander categories to van life amenity taxonomy:
   - "Water" → water
   - "Dump Station" → dump_station
   - "Wild Camping" / "Informal Campsite" → campsite
   - "Propane" → propane
   - "Showers" → shower
   - etc.
3. **Load** — bulk insert into `imported_pois` with `ST_MakePoint(lng, lat)::geography`
4. **Index** — spatial index created by schema (above)

~15,000-20,000 US POIs. Run manually before the trip. Re-run to refresh.

## MVP Scope (Before June 5)

**Must have (core 13 — usable for Seattle → Des Moines):**
1. `tripMode: "roadtrip"` on trips table + mode-aware UI routing
2. Van profile (per-workspace): MPG, tank size, fuel type, name
3. Route planning: origin + destination + waypoints → Google Routes polyline
4. Segment auto-split: 12hr/sunset rules using `suncalc`
5. Route rendering: rainbow gradient polyline on Google Maps
6. Corridor search: PostGIS `ST_DWithin` against imported POIs
7. iOverlander US bulk import (one-time script)
8. POI interaction: info card → save to trip → navigate (share sheet)
9. Fuel log: odometer, gallons, price, station, MPG calculation
10. Fuel zone predictions: simple range math, Costco preference badge
11. Overnight zone: 30mi radius near sunset endpoint, show options
12. TripTik strip: vertical timeline with cumulative mile markers + time estimates
13. Road trip dashboard: strip + map + stats layout

**Stretch goals (items 14-18):**
14. Side trip detection: off-route prompt → pause/resume
15. Driving mode: auto-detect + manual override, glanceable stats
16. GPS breadcrumbs: 1 point / 5 min while driving
17. Solo expense flow: auto-assign OCR items, fuel log linking
18. Pre-fetch active corridor for offline use

**Post-MVP (summer iteration):**
- CarPlay integration (requires Apple entitlement approval)
- Real-time gas prices (Google Places `fuelOptions`)
- Elevation-aware fuel prediction
- Smart fuel optimization (price + proximity + clustering)
- NPS + Recreation.gov + NREL integrations
- Full offline mode with map tile caching
- Route deviation → add as waypoint (re-route)
- POI dedup across sources
- Photo journal / trip log
- Trip cost estimation before departure
- Weather along route
- Read-only share link for passengers

## Timeline

```
May 20-27:  Phase A production launch (deploy, R2, Gemini, email, rebrand)
May 27-Jun 4: Road Trip MVP (schema, route, corridor, fuel log, strip view)
Jun 5-10:    Seattle → Des Moines (dogfood road trip mode)
Jun 10-15:   Omaha family reunion (dogfood group trip mode)
Jun 15+:     Summer iteration on both modes
```
