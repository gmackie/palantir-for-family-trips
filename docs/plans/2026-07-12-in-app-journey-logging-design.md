# In-App Journey Logging Design

## Goal

Make Sortey the canonical record of the current trip. Travelers must be able to
capture chronological stops and check-ins from the Expo app or production web
app without relying on agent sessions or direct database changes. Mobile is the
primary capture surface; web is the primary review and correction surface.

## Product model

A journey stop is the user-facing unit of recorded progress. It contains a
stable client-generated identifier, coordinates, a human-readable place name,
stop type, arrival time, optional note, and optional photos. Stop types cover
camp, rest, fuel, water, dump, scenic, town, and custom.

The backend derives the route segment from the previous recorded stop,
including distance, duration, and map polyline. Users do not manually manage
segments. Recorded stops remain distinct from planned itinerary stops: planning
describes future intent, while Journey records what happened.

## Shared backend

A trip-scoped `journey` router owns listing, logging, updating, reordering, and
deleting recorded stops. It also exposes reverse geocoding. A shared routing
helper serves both itinerary planning and journey logging so the two features
cannot calculate legs differently.

Writes are transactional and idempotent. Logging creates the journey stop,
incoming route segment, mapped pin, and photo associations as one operation.
Moving a stop recalculates its incoming and outgoing legs. Deleting a stop
removes its pin and heals the route between neighboring stops. Reordering
updates stable ordering and recalculates affected legs.

Routing failure does not discard the travel record. The stop saves with its
coordinates and a visible `route pending` state that can be retried later.
Client-generated identifiers make retries safe and prevent duplicate stops.

Existing `tripSegments` and `pins` remain the route and map representations. A
journey-stop identity supplies a durable editing target and separates recorded
progress from planned itinerary data.

## Mobile experience

The active trip screen and Driving Mode expose a prominent, thumb-reachable
`Log stop` action. The form starts with the current GPS location and a
reverse-geocoded place name. The traveler can search for another place or enter
one manually, choose a stop type, adjust the arrival time, add a note, attach
photos, and save.

Location permission or reverse-geocoding failure never blocks logging. Place
search remains available, and raw coordinates can be saved with a manually
entered name. A `Camp here` shortcut makes the most common action a confirmation
and save.

The mobile journey timeline shows arrival time, type, place, distance from the
previous stop, note, route status, and photo thumbnails. A selected stop can be
renamed, re-dated, moved, reordered with explicit earlier/later controls, or
deleted. The latest recorded stop becomes the active trip's current progress
point.

## Web experience

The road-trip dashboard gains a Journey tab backed by the same API. It supports
the same capture flow plus a wider chronological timeline, map selection,
photo management, and reordering. Planned and recorded stops are visually
distinct. The dashboard shows the last recorded location and time alongside the
next planned destination so missing progress is visible.

## Reliability

The first production slice provides honest online behavior: saves are visibly
pending, failures remain retryable, and no failed mutation appears successful.
After the online workflow is proven, a persisted Expo outbox will survive app
termination and replay mutations idempotently when connectivity returns.

Sortey will not perform implicit background tracking in this slice. Journey
progress changes only through explicit traveler actions.

## Verification

- Unit tests cover ordering, stop-type mapping, adjacent-leg repair, and route
  retry behavior.
- Router tests cover trip authorization, idempotency, transactions, routing
  failure, updates, reordering, and deletion.
- Mobile tests cover GPS success, permission denial, place search, pending save,
  edit, reorder, and delete behavior.
- Web tests cover creation, editing, reordering, and planned-versus-recorded
  presentation.
- API, Expo, and Next.js typechecks must pass.
- The production web workflow must be proven visibly against the real trip.
- Mobile must pass simulator proof and, when credentials and hardware permit,
  a physical-device build and workflow proof.

## Delivery order

1. Establish the journey data contract and shared routing helper.
2. Implement and test trip-scoped journey mutations.
3. Ship mobile capture and timeline as the primary workflow.
4. Ship web capture and management using the same contract.
5. Prove the production web and mobile workflows.
6. Add the durable offline outbox as the immediate hardening slice.
