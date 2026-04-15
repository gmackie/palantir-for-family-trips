# Implementation Status

Updated after merging the other agent's Phase 1–2 work and the upstream RBAC/RLS sync.

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

### Phase 2 — Workspace guards + trip schema + trip routes ✅ SCAFFOLDED
- **Workspace infrastructure (from upstream)**:
  - `workspace`, `workspaceMembership`, `workspaceInviteAllowlist` tables
  - `applicationSettings.tenancyMode` (single-tenant | multi-tenant)
  - RLS policy builders in `packages/db/src/tenant.ts`
  - Workspace-scoped read/write predicates in `packages/db/src/rls.ts`
  - URL helpers: `apps/nextjs/src/lib/workspace.ts` (`/w/[workspaceSlug]/...`)
  - Workspace routes: `apps/nextjs/src/app/w/[workspaceSlug]/{page,settings}.tsx`
  - Tenant-aware tRPC context via `tenancy.mode` injection
- **Trip schema (from other agent)**:
  - `trips` — id, workspaceId, status (planning/confirmed/active/completed), claimMode, tz, destination, timestamps
  - `tripSegments` — tripId, destination, dates, sortOrder, tz
  - `segmentMembers` — segmentId, userId (with unique constraint)
  - `tripMembers` — tripId, userId, role (organizer/member), unique constraint
  - `tripInvites` — tripId, email, token, expiresAt, unique(tripId, email)
  - Enums: `tripStatusEnum`, `tripClaimModeEnum`, `tripMemberRoleEnum`
- **Auth guards**: `packages/api/src/auth/guards.ts` with `workspaceProcedure()` and `tripProcedure()` middleware factories
- **Trip router**: `packages/api/src/router/trips.ts` (528 lines) — create, list, get, update, member + segment helpers
- **Trip routes in `apps/nextjs/src/app/trips/`**:
  - `page.tsx` — trip list
  - `new/page.tsx` — create trip form
  - `[tripId]/page.tsx` — trip detail shell
  - `[tripId]/settings/page.tsx` — trip settings (name, dates, destination, member management)
  - `_components/destination-picker.tsx` — text-based destination picker
  - `_lib/create-trip-form.ts` + test
  - `_lib/trip-settings-form.ts` + test
- **Trip router tests**: `packages/api/src/router/__tests__/trips.test.ts` (491 lines)

### Phase 7 — Cloudflare deployment ✅ SCAFFOLDED
- `apps/nextjs/worker/index.ts` — Cloudflare Workers entry with image optimization
- `apps/nextjs/scripts/sync-vinext-wrangler.mjs` — Wrangler config generator
- `apps/nextjs/wrangler.jsonc` — Worker config
- `packages/db/src/runtime.ts` — request-scoped `DatabaseRuntime` for Workers
- `packages/db/src/client.ts` — runtime-aware DB client
- `.forgegraph.yaml` — ForgeGraph deploy metadata
- `docs/forgegraph/setup-assessment.md`

### Design specs
- `docs/ai/CLAIM_SPEC.md` (205 lines) — tap-to-claim interaction spec

## What's NOT Built Yet

### Phase 2 gaps (to finish before Phase 3)
- **Workspace auto-creation on first sign-in** — still need the Better Auth `onLogin` hook that provisions a personal workspace for solo users
- **Trip invite accept flow** — `/invite/[token]` route + `acceptInvite` mutation
- **Auto-create workspace membership on invite accept** — transactional
- **Workspace switcher UI** — exists in routes but needs the nav dropdown component
- **Flag-gated workspace visibility** — `WORKSPACES_VISIBLE` via `@gmacko/flags`
- **Trip RLS policies** — trips/tripMembers/tripSegments/etc. need RLS enabled with workspace-scoped predicates using `packages/db/src/tenant.ts` helpers
- **Drizzle migration for trip tables** — schema is defined but migration file doesn't exist yet (`packages/db/drizzle/0000_misty_wrecking_crew.sql` only has workspace tables)
- **Seed data** for trips

### Phase 2P — Pre-trip planning (fully unimplemented)
- Polls (`polls`, `pollOptions`, `pollVotes` schema + routers + UI)
- Proposals (`proposals`, `proposalReactions` — flight/lodging/car with URL parsing)
- Room assignments (`roomAssignments`, `roomOccupants`)
- Ground transport groups (`groundTransportGroups`, `groundTransportMembers`)
- "Lock it in" wizard (planning → confirmed transition)
- Arrival/departure tracking (`memberTransits` — AviationStack integration)
- Lodging integration (`lodgings`, `lodgingGuests` — 4 input methods)

### Phase 2.5 — Design gate (partially done)
- ✅ `docs/ai/CLAIM_SPEC.md` exists
- ❌ Palantir-on-Mobile section in DESIGN.md
- ❌ WCAG AA + 44px floor declaration

### Phase 3 — Expenses + Receipts + OCR (unimplemented)
All of it: expenses schema, receipts, OCR pipeline, MockOCRProvider, realtime claiming via Pusher, share calculation, line-item UI, etc.

### Phase 4 — Settlement (unimplemented)
Settlement algorithm, Venmo deep-links, undo window, idempotency.

### Phase 5 — Map + Itinerary + Transit (unimplemented)
Pins schema, Google Maps integration, pin edit lock, directions cache, transit routing, Gantt timeline, gap detector.

### Phase 6 — Dashboard adaptation (unimplemented)
Wire the `/demo` dashboard to live DB data, branch on `trip.status` to show planning vs. command-center view. Delete `/demo`.

### Phase 8 — Expo mobile app (unimplemented)
Receipt capture, claim on phone, itinerary review, planning votes, push notifications.

## Build Status

```
pnpm turbo run build --filter='!@gmacko/tanstack-start' --filter='!@gmacko/expo' --filter='*'
# 22/22 packages pass, full turbo cache
```

Excluded: `@gmacko/tanstack-start` (not used in v1), `@gmacko/expo` (native build needs Xcode).

## Current Branch

`migrate/template` — 11 commits ahead of `master`. Not yet PR'd.
