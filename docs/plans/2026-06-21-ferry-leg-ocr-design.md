# Ferry as a First-Class Road-Trip Leg (+ OCR-assisted entry)

**Date:** 2026-06-21
**Status:** Design approved, ready for implementation plan
**Motivation:** Real-trip dogfood — a Seattle → Olympic-Peninsula drive to Toorcamp includes a Washington State Ferries crossing. Today the app has no ferry concept: `transitTypeEnum` is `flight | train | bus | car | other`, and the road-trip planner (`route-planner.ts`) only knows how to split driving into daylight legs. A ferry is a scheduled thing you must catch, a non-drivable leg, and a splittable ticket cost — none of which the model captures.

This feature also wires up the OCR pipeline for the first time on a write path. The extractors in `packages/api/src/ocr/` exist and are tested, but `reconcileReceipt` is only used in a non-writing recheck (`packages/api/src/expenses/ocr-recheck.ts`). Adding ferry-booking extraction gives OCR its first real entry point; the receipt path can reuse the same plumbing afterward.

## Decision: ferry is primarily a **route leg** (Option A)

Considered three homes:
- **(A) Route leg in the road-trip planner** — chosen. Matches the literal trip (drive → boat → drive), and it's where the ETA math matters ("leave by X to make the Y boat").
- **(B) A `memberTransit`** — per-member, detached from the driving route. Rejected as the *primary* home; we still add `ferry` to `transitTypeEnum` so per-member "made the boat" tracking is available later, but it is **not built in v1**.
- **(C) Its own trip segment** — heavyweight; segments are places you stay, a crossing is not.

## Data model

New table `ferryCrossings`, trip-scoped, guarded by `tripProcedure`:

```
ferryCrossings
  id                    uuid pk
  tripId                uuid fk -> trips.id (not null, cascade)
  createdByUserId       text fk -> user.id (not null)
  operator              text            -- "WA State Ferries — Edmonds/Kingston"
  departureTerminal     text
  arrivalTerminal       text
  scheduledDepartureAt  timestamptz (nullable -- leg still saves without it)
  durationMinutes       int             -- crossing time
  arrivalCutoffMinutes  int default 30  -- be-in-line-by buffer (WSF ~30, more in summer)
  vehicleReservation    bool default false
  confirmationNumber    text nullable
  fareCents             int nullable
  currency              text default 'USD'
  fareNote              text nullable   -- "car + 2 passengers"
  afterSegmentId        uuid fk -> tripSegments.id (nullable) -- position in the route
  source                'manual' | 'ocr'
  sourceRaw             text nullable   -- raw OCR text / pasted confirmation
  ocrProvider           text nullable
  ocrConfidence         numeric nullable
  expenseId             uuid fk -> expenses.id (nullable) -- draft expense spawned from the fare
  createdAt, updatedAt
```

Plus: add `ferry` to `transitTypeEnum` in `packages/db/src/schema.ts`.

### Explicitly out of scope (YAGNI)
- Auto-detecting ferries from the Google Routes API — manual + OCR entry only.
- A `ferryPassengers` roster — the fare's **draft expense** handles the split.
- Live WSF schedule / delay tracking.

## Money: reuse the expense machinery

The ferry fare auto-creates a **draft expense** (category `transport`) splittable among trip members, via the existing expenses code path. No parallel money code. `ferryCrossings.expenseId` links the two; deleting the crossing soft-handles the draft per existing expense rules. Mixed-currency rules already enforced by settlement are unchanged.

## OCR path (first write-path wiring)

- Add `ferryBookingSchema` in `packages/api/src/ocr/schema.ts`: `operator`, `departureTerminal`, `arrivalTerminal`, `departureAt` (ISO), `confirmationNumber`, `fareCents`, `currency`, `vehicleReservation`, `passengerNote`.
- Generalize the Claude/Gemini extractors so a provider can run with a **ferry prompt + schema** instead of only the receipt one. The receipt path stays byte-for-byte unchanged; the schema/prompt becomes a parameter.
- New mutation `ferries.extractFromImage` (PDF is rasterized to an image first): returns parsed fields to **pre-fill the form for review** before save. Never writes directly from OCR; never blocks on failure (empty extraction + "enter manually").

## Route-planner ETA gating (the useful bit)

The ferry is a hard time constraint on the road-trip timeline. Given `scheduledDepartureAt`, `arrivalCutoffMinutes`, and the drive time to `departureTerminal`, compute **"leave by X to make the Y boat."** The day-split logic treats the crossing as non-drivable time (`durationMinutes + arrivalCutoffMinutes`) rather than counting it against the 12-daylight-hour driving budget. Pure arithmetic over the entered leg — no extra Google round-trip.

## UI

- `@sortey/ui`: `ferry-leg-card.tsx` + story, `ferry-input-form.tsx` + story (Manual / Scan-ticket tabs). Monospace times per `DESIGN.md`.
- Web: surfaced on the road-trip route view (`apps/nextjs/src/app/trips/[tripId]/road-trip/`).
- Mobile: read-only ferry card in Driving Mode (`apps/expo/src/app/trip/[tripId]/drive.tsx`) showing next boat + "leave by." Entry is web-first for v1.

## Error handling
- OCR failure → partial/empty extraction, surface "couldn't read — enter manually," never block save.
- Missing `scheduledDepartureAt` → leg saves; ETA gating simply omitted for that leg.
- Fare currency follows existing expense currency rules; settlement already refuses mixed currencies.

## Testing
- Ferry fixture (WSF-style confirmation) in `packages/api/src/ocr/__fixtures__/`; extraction test via `MockOCRProvider`.
- Unit: fare → draft expense creation; "leave-by" computation with a ferry constraint; `ferries` router membership guard (positive + negative); `ferryBookingSchema` parse.

## Router surface (`packages/api/src/router/ferries.ts`, `tripProcedure`)
- `create`, `update`, `delete`, `listForTrip`
- `extractFromImage` (OCR pre-fill)
- `create`/`update` optionally spawn/refresh the linked draft expense
