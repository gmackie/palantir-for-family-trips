# Implementation Status

Last synced: 2026-06-12 — updated to reflect all shipped phases (expenses,
settlement, map/pins, chat, lodging, planning, road-trip routers).

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

### Phase 2 — Workspace guards + trip schema + trip routes ✅ COMPLETE
- **Workspace infrastructure (from upstream)**:
  - `workspace`, `workspaceMembership`, `workspaceInviteAllowlist` tables
  - `applicationSettings.tenancyMode` (single-tenant | multi-tenant)
  - RLS policy builders in `packages/db/src/tenant.ts`
  - Workspace-scoped read/write predicates in `packages/db/src/rls.ts`
  - URL helpers: `apps/nextjs/src/lib/workspace.ts` (`/w/[workspaceSlug]/...`)
  - Workspace routes: `apps/nextjs/src/app/w/[workspaceSlug]/{page,settings}.tsx`
  - Tenant-aware tRPC context via `tenancy.mode` injection
- **Trip schema**:
  - `trips` — id, workspaceId, status (planning/confirmed/active/completed), claimMode, tz, destination, timestamps
  - `tripSegments` — tripId, destination, dates, sortOrder, tz
  - `segmentMembers` — segmentId, userId (with unique constraint)
  - `tripMembers` — tripId, userId, role (organizer/member), unique constraint
  - `tripInvites` — tripId, email, token, expiresAt, unique(tripId, email)
  - Enums: `tripStatusEnum`, `tripClaimModeEnum`, `tripMemberRoleEnum`
  - Migrations 0000–0006 in `packages/db/drizzle/`
- **Auth guards**: `packages/api/src/auth/guards.ts` with `workspaceProcedure()` and `tripProcedure()` middleware factories
- **Trip router**: `packages/api/src/router/trips.ts` — create, list, get, update, member + segment helpers
- **Trip routes in `apps/nextjs/src/app/trips/`**: list, new, detail, settings, destination-picker, forms + tests
- **Trip router tests**: `packages/api/src/router/__tests__/trips.test.ts`

### Phase 2P — Pre-trip planning ✅ SHIPPED
- **Planning router** (`packages/api/src/router/planning.ts`): `createPoll`, `addPollOption`, `vote`, `closePoll`, `listPolls`, `getPollResults`, `createProposal`, `reactToProposal`, `updateProposalStatus`, `listProposals`, `confirmTrip`
- **Lodging router** (`packages/api/src/router/lodging.ts`): `createLodging`, `updateLodging`, `listForSegment`, `setGuests`, `deleteLodging`, `createTransit`, `updateTransit`, `listTransitsForSegment`, `createTransportGroup`, `joinTransportGroup`, `leaveTransportGroup`, `listTransportGroups`
- Polls (`polls`, `pollOptions`, `pollVotes`), proposals (`proposals`, `proposalReactions`), lodging, guest assignments, room transport groups, member transits, and "Lock it in" (`confirmTrip`) are all implemented at the router level

### Phase 2.5 — Design gate
- ✅ `docs/ai/CLAIM_SPEC.md` exists
- ❌ Palantir-on-Mobile section in DESIGN.md
- ❌ WCAG AA + 44px floor declaration

### Phase 3 — Expenses + Receipts + OCR ✅ SHIPPED
- **Expenses router** (`packages/api/src/router/expenses.ts`): `create`, `list`, `get`, `updateDraft`, `finalize`, `delete`, `addLineItem`, `addLineItems`, `removeLineItem`, `claimLineItem`, `unclaimLineItem`, `assignLineItem`, `attachReceiptImage`
- **OCR pipeline** (`packages/api/src/ocr/`): `gemini-extractor.ts`, `claude-extractor.ts`, `mock-provider.ts`, `reconcile.ts`, `schema.ts`
- **Storage**: R2 binding active (`apps/nextjs/wrangler.jsonc`), storage provider set to `"r2"` in `packages/config/src/integrations.ts`
- **Realtime**: SSE provider active (`provider: "sse"`), `enabled: true`

### Phase 4 — Settlement ✅ SHIPPED
- **Settlements router** (`packages/api/src/router/settlements.ts`): `summary`, `record`, `undo`, `history`
- Settlement claims bug fixed (commit `9c014c6`, "fix(api): load settlement claims by lineItemId"); settlement test coverage exists

### Phase 5 — Map + Itinerary + Transit ✅ SHIPPED
- **Pins router** (`packages/api/src/router/pins.ts`): `list`, `create`, `update`, `delete`, `setAttendees`, `acquireEditLock`, `releaseEditLock`, `listForTimeline`
- **Itinerary router** (`packages/api/src/router/itinerary.ts`): `list`, `create`, `delete`
- Pin edit lock (optimistic concurrency) implemented

### Phase 2/Chat — In-app group chat ✅ SHIPPED
- Durable Objects + WebSockets realtime chat (multiple commits: `6573e5e`, `188d855`, `0aa7854`, `abf35a4`, `2954f70`)
- Chat router: `packages/api/src/router/chat.ts`
- Web: trip chat panel + nav entry; Mobile: trip chat screen
- Design polish: 5 UI states, 44px touch targets, tabular timestamps, send-failure tap-to-retry

### Road Trip Mode — Partially shipped (see below)

**Shipped** (`packages/api/src/router/`):
- `route-planner.ts` — route planning
- `corridor.ts` — corridor management
- `fuel-logs.ts` — fuel log entries
- `van-profiles.ts` — van/vehicle profiles
- `location.ts` — location services

**Designed but unbuilt**:
- **Predicted Stops** — schema column `gpsTrackPoints` exists in `packages/db/src/schema.ts:1288` but no router reads or writes it; Predicted Stop logic (see `CONTEXT.md`, `docs/ai/ROAD_TRIP_PROPOSAL.md`) is unbuilt
- **Driving Mode** — described in design docs, no source code implementation
- **GPS breadcrumbs** — `gpsTrackPoints` table is defined in schema; no router exposes it

### Phase 7 — Cloudflare deployment ✅ SCAFFOLDED
- `apps/nextjs/worker/index.ts` — Cloudflare Workers entry with image optimization
- `apps/nextjs/scripts/sync-vinext-wrangler.mjs` — Wrangler config generator
- `apps/nextjs/wrangler.jsonc` — Worker config with R2 binding
- `packages/db/src/runtime.ts` — request-scoped `DatabaseRuntime` for Workers
- `packages/db/src/client.ts` — runtime-aware DB client
- `.forgegraph.yaml` — ForgeGraph deploy metadata
- `docs/forgegraph/setup-assessment.md`

### Phase 8 — Expo mobile app ✅ PARTIALLY SHIPPED
- Mobile trip chat screen shipped
- Maestro smoke tests: `apps/expo/.maestro/01-app-launches.yaml` + flows (auth sign-in/sign-out, navigation, posts CRUD)
- Receipt capture, planning votes, push notifications: not yet shipped

### Design specs
- `docs/ai/CLAIM_SPEC.md` (205 lines) — tap-to-claim interaction spec

## Known Gaps

### Trip RLS policies (implemented in code, but DORMANT — not enforcing)
> **SECURITY NOTE (verified 2026-06-12):** DB-level tenant isolation is **not
> active**. The app-layer tRPC guard chain (`protectedProcedure →
> workspaceProcedure → tripProcedure`, tested in
> `packages/api/src/auth/__tests__/guards.test.ts`) is the **sole** tenancy
> enforcement today. Do not assume the database is protecting you.
- The policy set is fully implemented (`packages/db/src/rls.ts`,
  `buildWorkspaceRlsStatements` / `applyWorkspaceRls`, runnable via `pnpm rls`),
  but it is **dormant on two counts**:
  1. **Never applied.** No CI/migration/deploy workflow runs `pnpm rls`
     (`grep -rin rls .github/workflows` → none), and the committed Drizzle
     migrations contain zero `CREATE POLICY`.
  2. **GUCs never set.** The policies read
     `current_setting('app.user_id'|'app.workspace_id')`, but
     `getDatabaseSessionSettings` (`packages/db/src/tenant.ts`) is unused in
     production and `ctx.db` is the plain pooled client — nothing runs
     `set_config`/`SET LOCAL` per request. Naively enabling the policies would
     `FORCE ROW LEVEL SECURITY` with empty GUCs and deny every row.
- Activation is captured as `plans/014-activate-dormant-rls.md` (NEEDS DECISION;
  large, high-risk, app-breaking-if-wrong — not auto-executed).

### Rate limiting ✅ SHIPPED (chat.send + share-link join)
- A Durable Object rate limiter (`apps/nextjs/worker/rate-limiter.ts`, fixed
  window, fail-open) is exposed to procedures as `ctx.rateLimit` via the
  `ratelimit-runtime.ts` seam. Applied to `chat.send` (30/60s per user+trip)
  and the share-link join (10/60s per user). The `TODO(ratelimit)` markers are
  gone. Remaining un-limited surface (e.g. the WS upgrade) can reuse the same
  seam.

### Phase 2 UX gaps (backend done, frontend incomplete)
- **Workspace auto-creation on first sign-in** — `onLogin` hook that provisions a personal workspace for solo users
- **Trip invite accept flow** — `/invite/[token]` route + `acceptInvite` mutation
- **Workspace switcher UI** — routes exist but nav dropdown component not built
- **Flag-gated workspace visibility** — `WORKSPACES_VISIBLE` via `@sortey/flags`

### Phase 6 — Dashboard adaptation (unimplemented)
Wire the `/demo` dashboard to live DB data, branch on `trip.status` to show planning vs. command-center view. Delete `/demo`.

### Phase 8 gaps — Expo mobile app
- Receipt capture on phone
- Planning votes on mobile
- Push notifications

## Build Status

```
pnpm turbo run build --filter='!@sortey/tanstack-start' --filter='!@sortey/expo' --filter='*'
# 22/22 packages pass, full turbo cache
```

_As of an earlier date — not re-verified on 2026-06-12. Re-run to confirm currency._

Excluded: `@sortey/tanstack-start` (not used in v1), `@sortey/expo` (native build needs Xcode).

## Branch

This document is branch-agnostic. The default branch is `master`.
