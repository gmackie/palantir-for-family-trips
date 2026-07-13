# Implementation Status

## Journey logging — implementation complete, deployment proof pending

- First-class `journey_stop` persistence separates recorded progress from
  planned route segments.
- Trip-scoped API supports list/log/update/move/delete/retry and reverse
  geocoding; creation is transactional and idempotent.
- Expo supports GPS/search capture, stop types, arrival date, notes, photos,
  `Camp here`, persisted offline queueing, and a recorded-only timeline.
- Next.js supports the same recorded-only capture and management lifecycle.
- Migration: `packages/db/drizzle/0011_journey_stops.sql`.
- Remaining: integrate concurrent itinerary/OTA work, deploy via ForgeGraph,
  and capture production browser plus physical-device proof.

Updated 2026-07-13. Ordered remaining work: `docs/ai/FEATURE_BACKLOG.md`.

Advisor plans 001–006 are all MERGED (see `plans/README.md`).

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
- **Trip router**: `packages/api/src/router/trips.ts` — CRUD, member management, segment helpers, invite generation, share links, `acceptInvite`
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
- **"Lock it in" wizard** — planning → confirmed transition UI at `apps/nextjs/src/app/trips/[tripId]/plan/lock-in/page.tsx`; backed by `planning.confirmTrip` at `packages/api/src/router/planning.ts:517`

### Phase 3 — Expenses + Receipts + OCR ✅ IMPLEMENTED (OCR not wired)
- `packages/api/src/router/expenses.ts` (844 lines) — create/draft/finalize/delete, line items, claims, share calculation, group split
- `packages/api/src/router/fuel-logs.ts` (142 lines) — fuel fill-up logging with gas-split expense creation
- `packages/api/src/expenses/` — `settle.ts`, `shares.ts` + tests; store interfaces; `FuelLogStore`
- Realtime tap-to-claim via Pusher (`@sortey/realtime`)
- Line-item schema: `expenses`, `lineItems`, `lineItemClaims`, `expenseShares` in `packages/db/src/schema.ts`
- Web: `apps/nextjs/src/app/trips/[tripId]/expenses/`
- Mobile: `apps/expo/src/app/trip/[tripId]/expenses.tsx`, `new-expense.tsx`, `expense/[expenseId]/`
- **OCR pipeline ✅ WIRED**: extractors + reconciler + fixtures in `packages/api/src/ocr/` (Claude + Gemini, `reconcile.ts`, tests). Receipt extraction is now wired via **`expenses.extractFromReceipt`** (fail-safe, bounded; returns reconciled fields + ocr provenance for form pre-fill) with a "Scan receipt" affordance on the new-expense form. The vision extractor was generalized (`extract-structured.ts`) during the ferry feature; `ferries.extractFromImage` was the first consumer, receipts the second.

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
- Google Maps integration (3-key split: browser/server/mobile)
- Web: `apps/nextjs/src/app/trips/[tripId]/map/`, `[tripId]/itinerary/`, `[tripId]/road-trip/`
- Mobile: `apps/expo/src/app/trip/[tripId]/map.tsx`, `itinerary.tsx`, `plan-route.tsx`
- Route gradient visualization: `apps/nextjs/src/components/road-trip/route-gradient-map.tsx` (partially built — web map component exists; not yet in mobile Driving Mode)

### Ferry legs — first-class road-trip crossings ✅ COMPLETE
- `ferry_crossing` table + `ferry` added to `transitTypeEnum` (`packages/db/src/schema.ts`); migration `0007_tired_wallop.sql`
- `packages/api/src/router/ferries.ts` — `create`/`update`/`delete`/`listForTrip`/`extractFromImage`, all under `tripProcedure`; cross-trip `afterSegmentId` validated; fare spawns a splittable draft `transit` expense via shared `packages/api/src/expenses/transport-draft.ts`
- OCR: ferry-booking extraction (`ferryBookingSchema` + generalized `extract-structured.ts`) — OCR's first write-path consumer; `extractFromImage` is fail-safe (returns `{ ok: false }`, never throws) and bounded
- Route planner: `applyFerryGating` attaches `{ leaveBy, nonDrivableMinutes }` to the leg ending at a ferry terminal; crossing time never counts against the 12 h driving budget (`packages/api/src/router/ferry-eta.ts`, `route-planner.ts`)
- UI: `@sortey/ui` `ferry-leg-card` + `ferry-input-form` (Manual / Scan-ticket tabs); web "Ferries" tab on the road-trip dashboard; read-only ferry card in mobile Driving Mode (`apps/expo/.../ferry-drive-card.tsx`)
- Tests: 19 router tests + OCR/leave-by/planner unit tests; full suite 261 green
- Design + plan: `docs/plans/2026-06-21-ferry-leg-ocr-design.md`, `docs/plans/2026-06-21-ferry-leg-ocr.md`

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

### Mobile deploy + Preflight status — 2026-06-27
- Production web is deployed and healthy at `https://sortey.app` via ForgeGraph deploy `2b79fed3-1c09-43fd-938f-8acda19d43f9`; `/api/health` returns healthy.
- Expo is on SDK 56 / React Native 0.85 with EAS `development-device` profiles for iOS and Android.
- Preflight iOS simulator proof passed: workflow `pfw_cb8cfcc0-61f8-4c3e-9b9c-905c8a12c4c5`, Maestro JUnit `.preflight/maestro/pfjob_7208a38a-4f17-4bad-a3fc-3df7ffa94161/junit.xml`, `tests=1`, `failures=0`.
- Preflight Android emulator proof passed: workflow `pfw_ffce5206-bac4-486b-b919-4406cd008389`, app-open job `pfjob_8ead2345-0f96-4b46-aa14-6cff0de55165`, Maestro job `pfjob_91c716cf-a276-42ec-af25-c315ad141e1d`, `tests=1`, `failures=0`.
- Android EAS development-device build is queued/running: build `71566a55-16e8-45d5-8b62-01dd411493c9`, profile `development-device`, channel `development`, distribution `internal`, Expo project `@gmacko/sortie`.
- Android build caveat: the submitted build uses Git commit `1c3c087d` because the active JJ working-copy commit has not been exported to Git.
- iOS EAS development-device build is blocked by Apple credentials/provisioning: the main app profile needs the iPad UDID added, and the `SorteyShare` extension needs credentials for `com.gmacko.sortey.dev.share-extension`.
- Physical-device proof is not yet complete: `adb devices -l` currently shows only the emulator, and local iPhone/iPad devices are offline in `xcrun xctrace list devices`.

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

### Remaining product gaps (see `docs/ai/FEATURE_BACKLOG.md` for the ordered list)

**Still open**
- Offline map tiles; apply dual-candidate choice into planRoute write path
- DriftPort full predictive service + work-window finder
- Full mechanical split of `trips.ts` router file (domain helpers already modular)
- App Store **manual ASC**: upload screenshots, privacy form, TestFlight, submit for review
- SMS invites deferred (device share sheet is the near-term path)

**Recently closed (2026-07-13 campaign)**
- Mobile room board + flight refresh; `workspacesVisible`; `/demo` removed
- Formal side-trip pause/resume; hour-aware replanDraft; predicted stops list
- Offline: fuel + expense/pin outboxes, trip pack, query persist, NetInfo sync banner
- Dual-candidate routes (`routePlanner.listCandidates` + Plan Route UI)
- Trip/workspace RLS migration `0012_trip_workspace_rls.sql`
- App Store checklist + draft inventory

## Build Status

Latest focused mobile verification (2026-06-27):

```
pnpm --filter @sortey/expo typecheck
pnpm --filter @sortey/expo check:app-store
bash -n scripts/dev-mobile.sh
```

All three pass. For the broader web/package gate, re-verify with:

```
pnpm turbo run build --filter='!@sortey/tanstack-start' --filter='!@sortey/expo' --filter='*'
```

Excluded: `@sortey/tanstack-start` (not used in v1), `@sortey/expo` (native build needs Xcode).

## Current Branch

`master` with active JJ working-copy commit `wnmyulyn` on top of Git commit `1c3c087d`.

Active implementation work is tracked in `plans/README.md` (advisor plans index in the repo root, uncommitted to git).
