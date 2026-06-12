# Implementation Status

Updated 2026-06-12, commit `2408b3e` (branch `master`).

Known bugs and active implementation plans are tracked in `plans/README.md` at the repo root.

## What's Built

### Phase 0 — Template adoption + dashboard port ✅ COMPLETE
- create-gmacko-app template adopted at `f4f5cfc`
- Dashboard ported to `apps/nextjs/src/app/demo/` (visual parity)
- Docs scaffolding: LOCAL_DEV.md, COOKBOOK.md, ERROR_PLAYBOOK.md, TESTING.md, TEMPLATE_SNAPSHOT.md

### Phase 1 — Magic-link auth ✅ COMPLETE
- Magic link plugin wired via `extraPlugins` in `apps/nextjs/src/auth/server.ts`
- `magicLinkClient()` added to `apps/nextjs/src/auth/client.ts`
- `nextCookies()` kept last in plugin array
- Sign-in route: `apps/nextjs/src/app/sign-in/page.tsx` + magic-link form component
- Dev bypass: `/api/dev/auto-login` (creates session by email), `/api/dev/last-magic-link` (returns last URL for Playwright)
- E2E test: `apps/nextjs/e2e/sign-in.spec.ts`
- Unit test: `apps/nextjs/src/auth/dev-magic-link.test.ts`

### Phase 2 — Workspace guards + trip schema + trip routes ✅ COMPLETE (some gaps below)
- **Workspace infrastructure**:
  - `workspace`, `workspaceMembership`, `workspaceInviteAllowlist` tables
  - `applicationSettings.tenancyMode` (single-tenant | multi-tenant)
  - RLS policy builders in `packages/db/src/tenant.ts`
  - Workspace-scoped read/write predicates in `packages/db/src/rls.ts`
  - URL helpers: `apps/nextjs/src/lib/workspace.ts` (`/w/[workspaceSlug]/...`)
  - Workspace routes: `apps/nextjs/src/app/w/[workspaceSlug]/{page,settings}.tsx`
  - `WorkspaceSwitcher` component exists (`apps/nextjs/src/components/workspace/workspace-switcher.tsx`)
  - Tenant-aware tRPC context via `tenancy.mode` injection
- **Trip schema (fully migrated)**:
  - `trips` — id, workspaceId, status (planning/confirmed/active/completed), claimMode, tz, destination, timestamps
  - `tripSegments` — tripId, destination, dates, sortOrder, tz
  - `segmentMembers` — segmentId, userId (with unique constraint)
  - `tripMembers` — tripId, userId, role (organizer/member), unique constraint
  - `tripInvites` — tripId, email, token, expiresAt, unique(tripId, email)
  - Enums: `tripStatusEnum`, `tripClaimModeEnum`, `tripMemberRoleEnum`
  - Migrations: `packages/db/drizzle/0000_misty_wrecking_crew.sql` through `0006_tan_gorilla_man.sql`
- **Auth guards**: `packages/api/src/auth/guards.ts` with `workspaceProcedure()` and `tripProcedure()` middleware factories
- **Trip router**: `packages/api/src/router/trips.ts` (1,582 lines) — CRUD, member management, segment helpers, invite generation, share links, `acceptInvite`
- **Invite accept flow**: `/invite/[token]` and `/join/[token]` routes; `trips.acceptInvite` and `trips.joinByShareToken` mutations
- **Trip routes in `apps/nextjs/src/app/trips/`**:
  - `page.tsx` — trip list
  - `new/page.tsx` — create trip form
  - `[tripId]/page.tsx` — trip detail shell
  - `[tripId]/dashboard/page.tsx` — live trip command center
  - `[tripId]/settings/page.tsx` — trip settings (name, dates, destination, member management)
  - `[tripId]/chat/`, `[tripId]/expenses/`, `[tripId]/itinerary/`, `[tripId]/lodging/`, `[tripId]/map/`, `[tripId]/photos/`, `[tripId]/plan/`, `[tripId]/road-trip/`, `[tripId]/settle/`
- **Trip router tests**: `packages/api/src/router/__tests__/trips.test.ts`

### Phase 2P — Pre-trip planning ✅ COMPLETE
- `polls`, `pollOptions`, `pollVotes` — schema + `planningRouter` procedures (create poll, add option, vote)
- `proposals`, `proposalReactions` — schema + router (flight/lodging/car proposals with reactions)
- `groundTransportGroups`, `groundTransportMembers` — schema present
- `memberTransits` — schema present (AviationStack integration not yet wired)
- `roomAssignments` — schema present (UI not wired)
- Web: `apps/nextjs/src/app/trips/[tripId]/plan/` route
- Mobile: `apps/expo/src/app/trip/[tripId]/polls.tsx`

### Phase 3 — Expenses + Receipts + OCR ✅ IMPLEMENTED (OCR not wired)
- `packages/api/src/router/expenses.ts` (844 lines) — create/draft/finalize/delete, line items, claims, share calculation, group split
- `packages/api/src/router/fuel-logs.ts` (142 lines) — fuel fill-up logging with gas-split expense creation
- `packages/api/src/expenses/` — `settle.ts`, `shares.ts` + tests; store interfaces; `FuelLogStore`
- Realtime tap-to-claim via Pusher (`@sortey/realtime`)
- Line-item schema: `expenses`, `lineItems`, `lineItemClaims`, `expenseShares` in `packages/db/src/schema.ts`
- Web: `apps/nextjs/src/app/trips/[tripId]/expenses/`
- Mobile: `apps/expo/src/app/trip/[tripId]/expenses.tsx`, `new-expense.tsx`, `expense/[expenseId]/`
- **OCR pipeline**: extractors + reconciler + fixtures exist in `packages/api/src/ocr/` (Claude + Gemini providers, `reconcile.ts`, tests) — **not wired to any router**; no mutation calls the extractors

### Phase 4 — Settlement ✅ IMPLEMENTED (known bug being fixed)
- `packages/api/src/router/settlements.ts` (295 lines) — `summary`, `record`, `undo`
- Settlement algorithm: `packages/api/src/expenses/settle.ts` + unit tests
- Venmo deep-links; undo window; idempotency on `record`
- Web: `apps/nextjs/src/app/trips/[tripId]/settle/`
- Mobile: `apps/expo/src/app/trip/[tripId]/settle.tsx`
- **Known bug (plan 001, in progress)**: `settlements.summary` query for itemized expenses incorrectly references `lineItems` in a filter that was broken — the `itemIds` fix is tracked in `plans/001-fix-settlement-summary-claims-query.md`

### Phase 5 — Map + Itinerary ✅ IMPLEMENTED
- Routers: `pins`, `itinerary`, `corridor`, `route-planner` — all mounted in `packages/api/src/root.ts`
- `packages/api/src/router/pins.ts` — pin CRUD with edit-lock and segment scoping
- `packages/api/src/router/itinerary.ts` — itinerary entries and Gantt timeline data
- `packages/api/src/router/route-planner.ts` — auto-split into driving days (daylight hours, max 12 h)
- `packages/api/src/router/corridor.ts` — `searchImported` queries `importedPois` + `poiCache` tables with PostGIS bounding-box filter
- Google Maps integration (3-key split: browser/server/mobile — see memory/project-gcp-maps-keys.md)
- Web: `apps/nextjs/src/app/trips/[tripId]/map/`, `[tripId]/itinerary/`, `[tripId]/road-trip/`
- Mobile: `apps/expo/src/app/trip/[tripId]/map.tsx`, `itinerary.tsx`, `plan-route.tsx`
- Route gradient visualization: `apps/nextjs/src/components/road-trip/route-gradient-map.tsx`

### Phase 6 — Dashboard adaptation ✅ WIRED
- Live trip command-center dashboard at `apps/nextjs/src/app/trips/[tripId]/dashboard/page.tsx` — wired to live DB data
- `/demo` route (`apps/nextjs/src/app/demo/`) still present (legacy static demo, not yet deleted — tracked in plans backlog)
- Branches on `trip.status` to show planning vs. command-center view

### Phase 7 — Cloudflare deployment ✅ SCAFFOLDED
- `apps/nextjs/worker/index.ts` — Cloudflare Workers entry with image optimization
- `apps/nextjs/scripts/sync-vinext-wrangler.mjs` — Wrangler config generator
- `apps/nextjs/wrangler.jsonc` — Worker config
- `packages/db/src/runtime.ts` — request-scoped `DatabaseRuntime` for Workers
- `packages/db/src/client.ts` — runtime-aware DB client
- `.forgegraph.yaml` — ForgeGraph deploy metadata
- `docs/forgegraph/setup-assessment.md`

### Phase 8 — Expo mobile app ✅ IMPLEMENTED
- `apps/expo/src/app/trip/[tripId]/` screens: `index`, `map`, `itinerary`, `lodging`, `expenses`, `new-expense`, `expense/[expenseId]`, `settle`, `chat`, `polls`, `plan-route`, `members`, `profile`, `segments`, `photos`, `stats`
- **Driving Mode** (`apps/expo/src/app/trip/[tripId]/drive.tsx`) — day-of road dashboard with real road ETAs from trip segments; `apps/expo/src/components/trip/road-trip-detail.tsx`
- Push notifications: `push_token` table (`packages/db/src/schema.ts:83`), `notifications.registerPushToken`/`unregisterPushToken` procedures, `packages/api/src/notifications/send.ts` (Expo push API)
- Maestro smoke tests: `.maestro/01-app-launches.yaml`
- Native share-invite button; magic-link deep-link callback (`sortey://`)
- Fuel-log gas-split creates a group expense on the trip; member location sharing

### Realtime — Group chat + live locations ✅ COMPLETE
- `TripRoom` Durable Object (Cloudflare Workers) — one WS room per trip
- `packages/api/src/router/chat.ts` — send/history/soft-delete
- `trip_message` table in schema
- Web: `apps/nextjs/src/app/trips/[tripId]/chat/`
- Mobile: `apps/expo/src/app/trip/[tripId]/chat.tsx`
- Live member locations: `memberLocations` table; `locationRouter.updateLocation` broadcasts over Pusher; map screen shows real-time positions

### Van Profiles ✅ IMPLEMENTED
- `vanProfiles` table in schema (`packages/db/src/schema.ts:1182`)
- `packages/api/src/router/van-profiles.ts` — mounted in `appRouter`

### Design specs
- `docs/ai/CLAIM_SPEC.md` — tap-to-claim interaction spec
- `DESIGN.md` — Palantir command-center aesthetic; all UI decisions governed by it

## What's NOT Built Yet

### Phase 2 remaining gaps
- **Workspace auto-creation on first sign-in** — `onLogin` hook to provision a personal workspace for solo users not yet implemented
- **Workspace switcher not wired to nav** — `WorkspaceSwitcher` component exists but not rendered in the app shell
- **Trip-table RLS policies not enabled** — RLS policy builders exist in `packages/db/src/tenant.ts`; no `ENABLE ROW LEVEL SECURITY` or `CREATE POLICY` statements exist in the drizzle migrations; tracked in `plans/README.md` security backlog
- **`WORKSPACES_VISIBLE` flag-gating** — `@sortey/flags` infrastructure exists; workspace visibility flag not connected

### Phase 2P remaining gaps
- **"Lock it in" wizard** — planning → confirmed transition UI not built
- **AviationStack integration** — `memberTransits` schema present; AviationStack API not wired
- **Room assignments UI** — `roomAssignments` schema present; no UI to create/edit them

### Phase 3 gap
- **OCR-to-expense wiring** — `packages/api/src/ocr/` has Claude + Gemini extractors, reconciler, fixtures, and tests, but no router mutation calls the pipeline; the receipt-photo upload capture flow is unconnected

### Corridor POI data + UI
- `corridor.ts` router and PostGIS ADR exist; `searchImported` queries `importedPois`/`poiCache` tables
- **No data importer**: iOverlander / Recreation.gov importer mentioned in `docs/ai/ROAD_TRIP_PROPOSAL.md` not built
- **No UI surface**: corridor search not exposed in either app

### Road-trip vocabulary features (designed, unbuilt)
From `CONTEXT.md:41-61` — fully specified vocabulary, none yet implemented:
- **Predicted Stop** — algorithm-suggested refuel/rest waypoint
- **Route Gradient** — elevation-aware road type annotation (highway / scenic / dirt)
- **Side Trip** — branch off the main corridor (different from a trip segment)
- **Fuel Zone** — geographic region with fuel options (not a specific station)

### SMS invites
- `docs/ai/A2P_10DLC_REGISTRATION.md` describes the full registration package; 10DLC registration not submitted; Twilio not integrated
- Device-native share sheet (Expo `Share.share`) covers the near-term invite need

### `/demo` cleanup
- `apps/nextjs/src/app/demo/` — legacy static dashboard (~6,171-line `app-shell.tsx`); IMPLEMENTATION_PLAN Phase 6 calls for wiring live data then deleting it; live dashboard is now at `[tripId]/dashboard/`

## Build Status

```
pnpm turbo run build --filter='!@sortey/tanstack-start' --filter='!@sortey/expo' --filter='*'
# 22/22 packages pass, full turbo cache
```

Excluded: `@sortey/tanstack-start` (not used in v1), `@sortey/expo` (native build needs Xcode).

## Current Branch

`master` at commit `2408b3e`. This document was verified against the git history and file tree at that commit.

Active implementation work is tracked in `plans/README.md` (advisor plans index in the repo root, uncommitted to git).
