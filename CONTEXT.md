# Sortie — Trip Command Center

## Recorded journey vocabulary

- **Journey Stop** — an explicit record that the traveler reached a place. It
  has a stable client-generated ID, arrival time, type, note, optional photos,
  and a linked incoming route segment.
- **Planned Stop** — future itinerary intent. It does not become recorded
  progress merely because its planned date has passed.
- **Route Pending** — the stop is safely recorded, but its incoming road route
  could not yet be calculated. The route is retryable without duplicating the
  stop.
- **Waiting to Sync** — the stop command is persisted on the phone but has not
  yet been confirmed by the server.

Sortie is a trip coordination app with two modes: destination trips (group logistics at a location) and road trips (solo route planning and van life). Shares core infrastructure (expenses, OCR, auth, map) across both modes.

## Language

**Trip**:
A bounded travel event owned by a Workspace. Has a mode (destination or road trip) and optionally a group mode for shared expenses.
_Avoid_: Journey, vacation

**Trip Mode**:
The UI and data paradigm for a trip — either "destination" (area map, pins at a location) or "roadtrip" (route map, driving legs, corridor search). Orthogonal to Group Mode.
_Avoid_: Trip type

**Group Mode**:
Whether a trip has shared expenses split among members. Orthogonal to Trip Mode — a road trip can be solo or group, a destination trip can be solo or group.
_Avoid_: Multi-user mode

**Segment**:
A subdivision of a trip. In destination mode, a place you stay (e.g., "Omaha"), created manually. In road trip mode, a single driving day derived from the overall route — auto-split by driving time constraints, color-coded on the map. Moving one segment's endpoint cascades changes to all downstream segments.
_Avoid_: Leg (in destination context), stop

**Sortie**:
The app's name. A military term for a coordinated group mission.

## Relationships

- A **Trip** has one **Trip Mode** and one **Group Mode** setting, both set at creation and independently changeable
- A **Trip** contains one or more **Segments**
- In road trip mode, each **Segment** has an origin, destination, and route polyline
- In destination mode, each **Segment** has a destination area

**Corridor**:
The searchable area along a road trip route, typically within 30 miles of the polyline. All POI searches (fuel, overnight, amenities) are scoped to the corridor.
_Avoid_: Buffer zone, search area

**Van Life Amenity**:
A point of interest specific to vehicle-based travel. Categories: fuel, overnight, water, dump station, shower/gym, grocery, propane, laundry, rest area. Distinct from tourist POIs (restaurants, attractions, sightseeing).
_Avoid_: Service, facility

**Predicted Stop**:
An auto-placed pin along a road trip route based on constraints (fuel range, overnight before sunset, amenity needs). Recalculates when segment boundaries change. Shown as a suggestion, not a commitment.
_Avoid_: Waypoint (overloaded with Google Maps meaning)

**Driving Mode**:
A simplified, glanceable UI shown when the vehicle is in motion. Displays segment progress, ETA, next predicted stop, and fuel alerts. Not a navigator — Sortie is the trip companion while Google Maps/Waze handles turn-by-turn.
_Avoid_: Navigation mode, nav

**Stopped Mode**:
The full Sortie interface available when parked. Corridor search, TripTik strip, expense logging, segment editing. Default state when GPS shows low/no speed.

**Route Gradient**:
A color gradient applied to the road trip route polyline that encodes hours-from-now. Near segments are warm (bright), far segments are cool (dim). Predicted fuel stops and overnight endpoints are rendered as markers on the gradient, giving a glanceable sense of "when and where am I stopping."

**Side Trip**:
A deviation from the planned route. When the user leaves the route polyline (>2mi for a non-POI stop), Sortie prompts: "Side trip?" The user can pause the trip to explore freely. A deviation marker is placed on the timeline at the exit point. While paused, GPS tracks position but Sortie stops route guidance, corridor updates, and rerouting. Resume picks up from the pause point (default) or recalculates from the current GPS position.
_Avoid_: Detour (implies wrong turn), reroute (implies navigator behavior)

**Fuel Zone**:
A predicted area along the route where the vehicle will need fuel, based on MPG × tank size × threshold (remaining range < 80mi). Rendered as a custom SVG marker on the route gradient. Shows nearby gas stations with Costco stations badged/prioritized.
_Avoid_: Gas stop, fuel stop (these imply a specific station — a Fuel Zone is an area with options)

**Overnight Zone**:
A 30-mile radius highlighted area near the predicted sunset endpoint for a driving day. Shows all overnight options (campgrounds, BLM/USFS, free camping from iOverlander). Rendered as a subtle translucent area on the map. The user picks from the options; Sortie does not auto-select.
_Avoid_: Camp spot, overnight stop (implies a single location)

**TripTik Strip**:
A schematic timeline view of the route. Vertical on mobile (primary planning view), horizontal + map side-by-side on desktop. Shows cumulative mile markers from trip start and estimated arrival times. Items are tappable: saved POIs, fuel zones, overnight zones, segment boundaries. Named after the AAA TripTik. For road-trip planning, TripTik also edits **Trip Days** (intent, overnight, hero).
_Avoid_: Timeline (overloaded), itinerary (implies scheduled activities)

**Trip Day**:
One calendar day on a road trip — the primary planning unit. Has a **Day Intent**, optional overnight, optional **Hero Effort**, time blocks, and cut-if-behind notes. Distinct from a **Segment** (drive geometry). See `docs/plans/2026-07-09-itinerary-planner.md`.
_Avoid_: Leg, itinerary day (destination-mode phrasing)

**Day Intent**:
How a Trip Day is used: `play` (stay and do things), `drive` (cover miles with optional stops), `position` (stage near an anchor), `event` (fixed commitment like a festival), `recovery` (light day / hotel reset).
_Avoid_: Day type, activity mode

**Anchor**:
A fixed commitment on a date (conference, hotel reservation, must-see window). Constrains replan: days between anchors are flexible; anchors are not. Stored as `trip_anchor`; paced via miles/day to the next one.
_Avoid_: Hard stop (overloaded with driving), deadline alone

**Hero Effort**:
At most one featured activity on a Trip Day (a hike, swim, park visit). Keeps days from stacking three full efforts.
_Avoid_: Activity, attraction (too generic)

**Replan**:
Regenerate Trip Days from the current position (or a from-date) until the next Anchor, packing must-visits and play days. Draft first, then apply. Does not replace turn-by-turn navigation.
_Avoid_: Reroute (navigator), reschedule (calendar-only)

**Trip Co-Pilot**:
A tool-using planning participant (on-device and/or server) that argues options with costs (hours, nights, anchor risk) and never invents miles or POIs. In multi-party mode it facilitates; it does not self-commit plan changes.
_Avoid_: AI itinerary generator, chatbot (too vague)

**Planning Session**:
A bounded conversation (solo with co-pilot, or party of trip members + co-pilot) that produces structured Plan Options, stances, and an optional Decision/Commit into Trip Days. Distinct from free-form trip chat.
_Avoid_: Group brainstorm, thread (overloaded with chat)

**Amenity Scan**:
Long-term van-planning view of corridor POIs (iOverlander etc.) near each Trip Day overnight: sleep, dump, water, fuel, parking, tolls — plus warnings when gaps exist.
_Avoid_: POI dump, place search (too generic)

**Overnight Assign**:
Picking a concrete sleep POI for a Trip Day (wild camping, campground, overnight parking). Auto-assign fills nights from ranked nearby POIs after plan build or on demand; hotels are left alone.
_Avoid_: Lodging booking (we don't reserve)

**Fuel Log**:
A first-class record of a fuel fill-up, separate from general expenses. Tracks odometer, gallons, price per gallon, station name/location, and calculates actual MPG since last fill. Can optionally link to a receipt via the OCR pipeline. Distinct from a standard expense entry.
_Avoid_: Gas expense (fuel logs are not expenses — they feed the MPG/range model)

**GPS Breadcrumbs**:
Lightweight position recording during driving mode — one point every 5 minutes. Stored as `(lat, lng, speed, timestamp)`. Enables post-trip review, actual vs. predicted timing comparison, and deviation history. Not a continuous track; not used for navigation.
_Avoid_: Track log, GPS trace (implies continuous high-frequency recording)

**Location Permission Tiers**:
Destination mode requests "When In Use" — enough for map coordination. Road trip mode prompts upgrade to "Always" on first driving mode activation — required for background breadcrumbs, driving detection, and side trip alerts while another navigation app is in foreground.

## Flagged ambiguities

- "trip mode" vs "group mode" — resolved: these are orthogonal axes. Trip Mode controls map/routing paradigm. Group Mode controls expense splitting.
- CarPlay category — resolved: apply under **Fueling** entitlement for CPPointOfInterestTemplate (map with pins). Driving Task as fallback.
