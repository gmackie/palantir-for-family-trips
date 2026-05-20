# Launch Plan — Sortie (Production by June 10, 2026)

Source: brainstorming session 2026-05-20. This plan gets Sortie live for a 30-person family reunion (Des Moines → Omaha, June 10-15).

## Architecture Decisions (2026-05-20)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Receipt storage** | Cloudflare R2 | Free on CF Workers (10GB, 10M reads/mo). Native binding. Replaces UploadThing (never wired up). |
| **Realtime** | SSE (Server-Sent Events) | Free, native to CF Workers. Replaces Pusher. 3s polling as fallback. |
| **Receipt OCR** | Gemini 2.5 Flash-Lite | Free tier: 1,000 req/day. Structured JSON output. Replaces Claude Sonnet (paid). |
| **App name** | Sortie | "A coordinated group mission." Palantir aesthetic. |

## Current State

The app is ~95% feature-complete. Schema, API routers, OCR pipeline, settlement algorithm, auth, and realtime claiming are all implemented. Both Next.js dashboard and Expo mobile app have functional screens.

**Critical blockers discovered during investigation:**
- `packages/config/src/integrations.ts` has **email, realtime, and storage all disabled**
- Storage package wraps UploadThing but is never called — receipts go to local disk
- Realtime package wraps Pusher — being replaced by SSE
- OCR uses Claude Sonnet — being replaced by Gemini Flash-Lite (free)
- App still branded "Gmacko" everywhere
- No production deployment has been run yet
- No trip data exists

## Phase A — Critical Path (Must complete before June 10)

### A1. Replace Storage: UploadThing → Cloudflare R2

**Current state:** `packages/storage/` wraps UploadThing but is unused. Receipt uploads in `apps/nextjs/src/lib/receipt-storage.ts` write to local disk (`.data/receipts/`).

**Steps:**
1. Create R2 bucket: `wrangler r2 bucket create sortie-receipts`
2. Add R2 binding to `apps/nextjs/wrangler.jsonc`:
   ```jsonc
   "r2_buckets": [{ "binding": "R2", "bucket_name": "sortie-receipts" }]
   ```
3. Rewrite `apps/nextjs/src/lib/receipt-storage.ts` to use the R2 binding:
   - `storeReceiptImage()` → `R2.put(key, bytes, { httpMetadata: { contentType } })`
   - `getReceiptImage()` → `R2.get(key)` with signed URL or direct read
   - Keep local disk fallback for `DEV_MODE=local`
4. Remove UploadThing dependency from `packages/storage/package.json`
5. Update `packages/config/src/integrations.ts`: storage provider → `"r2"`

**Files changed:**
- `apps/nextjs/wrangler.jsonc` — add R2 binding
- `apps/nextjs/src/lib/receipt-storage.ts` — rewrite for R2
- `apps/nextjs/src/app/api/receipts/upload/route.ts` — pass R2 binding from env
- `packages/config/src/integrations.ts` — enable storage, set provider to "r2"
- `packages/storage/package.json` — remove uploadthing dep

### A2. Replace OCR: Claude → Gemini 2.5 Flash-Lite

**Current state:** `packages/api/src/ocr/` has a clean `OCRProvider` interface. Claude extractor uses `messages.parse()` with Zod schema.

**Steps:**
1. Install `@google/generative-ai` in `packages/api`
2. Create `packages/api/src/ocr/gemini-extractor.ts`:
   - Implement `OCRProvider` interface
   - Use `generateContent()` with `responseMimeType: "application/json"` and `responseSchema`
   - Port the system prompt (adjust for Gemini's structured output format)
   - Model: `gemini-2.5-flash-lite`
3. Update `packages/api/src/ocr/index.ts` resolver:
   - Default provider → `GeminiReceiptExtractor`
   - `OCR_PROVIDER=claude` → Claude extractor (paid fallback)
   - `OCR_PROVIDER=fixture` → Mock provider (dev)
4. Reconciliation + PII scrubbing remain unchanged (provider-agnostic)

**Secrets:** `GOOGLE_AI_API_KEY` (free from ai.google.dev)

**Files changed:**
- `packages/api/src/ocr/gemini-extractor.ts` — new file
- `packages/api/src/ocr/index.ts` — update resolver
- `packages/api/package.json` — add @google/generative-ai

### A3. Replace Realtime: Pusher → SSE

**Current state:** `packages/realtime/` wraps Pusher (server + client). Expenses router calls `triggerEvent()`. Client hook subscribes to channels. Fallback: 3s polling.

**Steps:**
1. Create SSE endpoint: `apps/nextjs/src/app/api/sse/expenses/[expenseId]/route.ts`
   - GET handler returns a `ReadableStream` with `text/event-stream` content type
   - On connection: subscribe to an in-process event emitter (or KV-based) for the expense
   - On claim/unclaim: push SSE event to all connected clients
   - **CF Workers limitation:** Workers have a 30-second CPU limit but streaming responses can persist. Use `waitUntil()` for cleanup.
2. Replace `triggerEvent()` calls in `packages/api/src/router/expenses.ts`:
   - Instead of Pusher broadcast, write to a lightweight notification mechanism
   - Option A: CF Durable Object as pub/sub hub per expense
   - Option B: Write event to KV/D1, SSE endpoint polls KV on interval
   - **Simplest for launch:** Write claim events to a KV key (`expense:${id}:version`), SSE endpoint polls KV every 1s and pushes to client when version changes
3. Update client hook `apps/nextjs/src/lib/use-expense-realtime.ts`:
   - Replace Pusher subscription with `EventSource` pointing at SSE endpoint
   - Keep 3s polling as fallback when SSE disconnects
4. Remove Pusher dependencies from `packages/realtime/`

**Alternative (simpler for launch):** Since polling already works, we can ship with polling-only and add SSE in a fast follow. The 3s refresh is fine for 30 people at dinner.

**Files changed:**
- `apps/nextjs/src/app/api/sse/expenses/[expenseId]/route.ts` — new SSE endpoint
- `packages/api/src/router/expenses.ts` — replace triggerEvent calls
- `apps/nextjs/src/lib/use-expense-realtime.ts` — replace Pusher with EventSource
- `packages/realtime/src/index.ts` — gut Pusher, add SSE helpers
- `packages/config/src/integrations.ts` — realtime provider → "sse"

### A4. Enable Email (Resend)

**File:** `packages/config/src/integrations.ts`

| Integration | Current | Target |
|-------------|---------|--------|
| `email.enabled` | `false` | `true` |
| `email.provider` | `"none"` | `"resend"` |

**Secret:** `RESEND_API_KEY` from resend.com

### A5. Rebrand to Sortie

**Files to update:**

1. `apps/nextjs/src/app/page.tsx` — "Trip Command Center" → "Sortie"
2. `apps/nextjs/src/app/sign-in/page.tsx` — "Trip Command Center" → "Sortie"
3. `apps/nextjs/src/app/sign-in/_components/magic-link-form.tsx` — branding refs
4. `apps/expo/app.config.ts` — "Gmacko" → "Sortie", bundle IDs, slug, scheme
5. `apps/expo/eas.json` — update if needed
6. Email templates — magic link subject: "Sign in to Sortie"

### A6. Deploy Next.js to Production

**Prerequisites:** A1-A5 complete, secrets configured

**Steps:**
1. Push schema to production DB: `pnpm db:push`
2. Deploy: `pnpm forge:deploy:production`
3. Verify `trip.gmac.io` renders Sortie landing page
4. Test magic link sign-in end-to-end

### A7. TestFlight Build

**Prerequisites:** A5 (rebrand), A6 (production API live)

**Steps:**
1. Set `PRODUCTION_API_URL` in EAS secrets to `https://trip.gmac.io`
2. `eas init` — register project, get real project ID
3. `eas build --platform ios --profile production`
4. `eas submit --platform ios --profile production`
5. Invite family via TestFlight

### A8. Seed the Trip

**Prerequisites:** A6 (production DB accessible)

**Data:**
- **Workspace:** "Mackie Family"
- **Trip:** "Family Reunion 2026" — Jun 10-15, `America/Chicago`, groupMode: true, claimMode: tap
- **Segments:** Des Moines (Jun 10), Omaha (Jun 11-14), Departure (Jun 15)
- **Pins:** Lake Manawa lake house, aunt's house, uncle's house
- **Organizer:** mackieg@gmacko.com

## Dependency Graph

```
A1 (R2 storage) ──┐
A2 (Gemini OCR) ──┤
A3 (SSE realtime)─┤── A6 (Deploy) ── A7 (TestFlight)
A4 (Email) ───────┤                └─ A8 (Seed trip)
A5 (Rebrand) ─────┘
```

A1-A5 are independent — can be done in parallel.
A6 requires all of A1-A5.
A7 and A8 require A6.

## Phase B — Road Trip MVP (May 27 - Jun 4)

Prerequisite: Phase A complete (production deployed, Sortie branded, email + OCR + storage live).

### B1. Schema Additions (single `db:push`)

Add all road trip schema in one push — everything is additive with safe defaults:
- `tripMode` enum column on `trips` (default 'destination')
- `tripStatus` values: 'en_route', 'paused'
- Segment route fields: `originName`, `originLat`, `originLng`, `routePolyline`, `distanceMiles`, `durationMinutes`
- New `pinType` values: fuel, water, campsite, dump_station, rest_area, scenic, shower, grocery, propane, laundry
- New `expenseCategory` values: fuel, camping
- New tables: `vanProfiles`, `fuelLogs`, `imported_pois` (with PostGIS geography), `poiCache` (with PostGIS geography), `gpsTrackPoints`
- Spatial indexes on `imported_pois` and `poiCache`

**Files:** `packages/db/src/schema.ts`

### B2. iOverlander Bulk Import

One-time Node script: download US JSON dump, transform categories to van life amenity taxonomy, bulk insert into `imported_pois` with `ST_MakePoint(lng, lat)::geography`.

**Files:** `packages/db/scripts/import-ioverlander.ts`

### B3. Google Routes Integration

Server-side route computation. New API key (`GOOGLE_ROUTES_API_KEY`) restricted to Routes API.
- `computeRoutes()` with origin, destination, optional intermediates
- Store encoded polyline + summary (distance, duration) on trip/segments
- Decode polyline for corridor sampling using `@googlemaps/polyline-codec`
- Auto-split segments using `suncalc` (12hr max / 1hr before sunset)

**Files:** `packages/api/src/routes/google-routes.ts`, `packages/api/src/routes/auto-split.ts`

### B4. Corridor Search (PostGIS)

Server-side corridor query: sample route polyline every ~10mi, query `ST_DWithin(location, sample_point, 48280)` (30mi in meters) against `imported_pois`.
- Return POIs grouped by category
- Verify Hyperdrive passes PostGIS types correctly (smoke test)

**Files:** `packages/api/src/router/corridor.ts`

### B5. Route Rendering (Map)

Client-side route visualization on Google Maps JS API:
- Rainbow gradient polyline (split into ~50-100 colored sub-segments)
- Subtle translucent corridor boundary (30mi buffer, toggleable)
- Custom SVG markers for fuel zones and overnight zone endpoints
- Overnight zone: translucent 30mi radius circle
- POI markers with typed icons

**Files:** `apps/nextjs/src/components/road-trip-map.tsx`

### B6. TripTik Strip View

Vertical timeline component:
- Cumulative mile markers from trip start
- Both distance and time estimates per stop
- Tappable items → info cards
- Day selector for segment navigation
- Desktop: side-by-side with map, linked highlighting

**Files:** `apps/nextjs/src/components/triptik-strip.tsx`

### B7. Van Profile

Per-workspace vehicle profile: name, MPG estimate, tank size, fuel type, dimensions.
- CRUD via tRPC router
- Referenced by fuel zone predictions and trip cost calculations

**Files:** `packages/api/src/router/van-profiles.ts`, `apps/nextjs/src/app/(dashboard)/settings/van-profile/`

### B8. Fuel Log

First-class fuel tracking:
- Log: odometer, gallons, price/gal, station name + lat/lng, Costco flag
- Auto-calculate: actual MPG since last fill, cost per mile
- Optional receipt link via OCR pipeline (gas station receipt → "Log as fuel fill-up?" prompt)
- Fuel zone predictions: simple range math (MPG × tank × threshold)

**Files:** `packages/api/src/router/fuel-logs.ts`, `apps/nextjs/src/components/fuel-log.tsx`

### B9. POI Interaction

Info card on tap → "Save to trip" (converts to Pin on TripTik strip) + "Navigate" (iOS share sheet deep link to Google Maps / Waze / Apple Maps).

**Files:** `apps/nextjs/src/components/poi-info-card.tsx`

### B10. Road Trip Dashboard

Desktop layout: TripTik strip (left) + map (right) + stats bar (bottom).
- Trip header: origin → destination, day X of Y
- Stats: total miles/%, fuel cost, avg MPG, days remaining
- Fuel log summary panel

**Files:** `apps/nextjs/src/app/(dashboard)/trips/[tripId]/road-trip/`

### B11. Mode-Aware Mobile Screens

Expo app renders different tab sets based on `tripMode`:
- Road trip tabs: Route (map + strip) | Corridor (filter chips + POI list) | Fuel | Expenses
- Destination tabs: Map | Expenses | Settle | Members (unchanged)

**Files:** `apps/expo/src/navigation/`, `apps/expo/src/screens/road-trip/`

### B12. Road Trip Creation Flow

1. Name, dates, select "Road Trip" mode
2. Pick/create van profile
3. Enter route (origin + destination + waypoints) → Google Routes
4. Auto-split → proposed segments
5. Review & adjust (drag segment boundaries)
6. Corridor loads automatically

**Files:** `apps/nextjs/src/app/(dashboard)/trips/new/road-trip/`

### B13. Trip Seeding (Seattle → Des Moines)

Seed script or manual creation:
- Trip: "Seattle → Des Moines", tripMode: roadtrip, ~June 5-10
- Van profile: "The Sprinter", gas, 15 MPG, 24.5 gal
- Route via Google Routes API
- Auto-split into ~5 segments

### B-stretch. Side Trip, Driving Mode, GPS Breadcrumbs, Offline

Items 14-18 from the MVP scope. Build if time allows before June 5.

## Phase C — Destination Trip Polish

### C1. Mobile Map Integration
### C2. Mobile Expense Flow Polish
### C3. Lodging Visual Flair
### C4. Landing Page Polish

## Secrets Inventory (Revised)

| Secret | Service | Where to get it |
|--------|---------|----------------|
| `BETTER_AUTH_SECRET` | Session signing | `openssl rand -base64 32` |
| `RESEND_API_KEY` | Email delivery | resend.com → API Keys |
| `GOOGLE_AI_API_KEY` | Receipt OCR (Gemini) | ai.google.dev → API Keys (free) |
| `GOOGLE_MAPS_API_KEY` | Maps | Already in wrangler.jsonc |

**Removed (no longer needed):**
- ~~ANTHROPIC_API_KEY~~ — replaced by Gemini
- ~~PUSHER_*~~ — replaced by SSE
- ~~UPLOADTHING_*~~ — replaced by R2

Total external service accounts needed: **2** (Resend, Google AI Studio). Down from 5.

## Verification Checklist

- [ ] `trip.gmac.io` is reachable and shows Sortie landing page
- [ ] Magic link email arrives (Resend, not console-logged)
- [ ] After sign-in, user sees "Family Reunion 2026" trip with 3 segments
- [ ] Receipt photo upload works (image stored in R2, Gemini extracts line items)
- [ ] Two users can claim different items on the same expense (SSE or polling)
- [ ] Settlement view shows correct "who owes whom"
- [ ] Expo app installs via TestFlight as "Sortie"
- [ ] Expo app: sign in, view trip, upload receipt, claim items
- [ ] Map shows pinned locations (web dashboard)
- [ ] Invite link works: new family member signs up and joins trip
