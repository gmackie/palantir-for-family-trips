# Implementation Plan — Group Trip Command Center

Source of truth: `docs/ai/INITIAL_PROPOSAL.md`. This plan breaks the product into phased, verifiable tasks with concrete file paths so a fresh engineer (or Claude) can pick up any phase without context.

## Template Ground Truth

The sibling directory `../create-gmacko-app` is the template. Observed facts from direct file inspection:

**Tooling**
- Package manager: **pnpm 10.32.1**, Node 24
- Workspace: `pnpm-workspace.yaml` + **Turbo**
- Lint/format: **Biome + oxlint**
- Pre-commit: `lefthook.yml`
- Next.js: **16.2.1**, **React 19**
- Tailwind config lives in a workspace package: **`@gmacko/tailwind-config`**

**Data**
- ORM: **Drizzle 0.45 + postgres.js 3.4** + `drizzle-zod` for inferred schemas
- DB package `@gmacko/db` has `src/schema.ts`, `src/auth-schema.ts` (generated), `src/client.ts`, `src/seed.ts`, `__tests__/`, `drizzle.config.ts`, `vitest.config.ts`
- Schema uses the functional `pgTable("name", (t) => ({...}))` style with `drizzle-zod`'s `createInsertSchema`
- Scripts: `pnpm db:generate|migrate|push|check|seed|studio`, `pnpm auth:generate`

**Auth (critical discovery)**
- `@gmacko/auth` exports an `initAuth({...})` factory that takes `extraPlugins`
- Currently wired for **Discord OAuth** + optional Apple + `@better-auth/expo` + `oAuthProxy`
- **Magic link is NOT enabled.** It must be added via `extraPlugins` when `initAuth` is called from `apps/nextjs/src/auth/server.ts` (preferred — no fork), or by editing `@gmacko/auth`. Prefer the former.
- Auth consumers in the Next.js app live at `apps/nextjs/src/auth/client.ts` and `apps/nextjs/src/auth/server.ts`
- Route handler is already mounted at `apps/nextjs/src/app/api/auth/[...all]/`

**Existing multi-tenant model (critical discovery)**
- The template already has a **Workspace** concept with `workspaceRoleEnum = ['owner','admin','member']`, plus billing enums attached to workspaces (`workspaceSubscriptionStatusEnum`, `billingIntervalEnum`, `billingProviderEnum`, `billingLimitPeriodEnum`, `usageAggregationEnum`)
- This forces an architectural decision in Phase 2: **is a Trip a Workspace, does a Trip live inside a Workspace, or are Trips independent?** See "Architectural Decision: Trip vs. Workspace" below.
- Example domain table present: `Post` (with `CreatePostSchema`) and `userPreferences`

**UI**
- `@gmacko/ui` structure: **flat files in `packages/ui/src/`**, one component per file: `button.tsx`, `button.stories.tsx`, `input.tsx`, `dropdown-menu.tsx`, `field.tsx`, `label.tsx`, `separator.tsx`, `theme.tsx`, `toast.tsx`
- `index.ts` barrel + per-component subpath exports in `package.json` (`./button`, `./input`, etc.)
- **Shadcn is configured** — `packages/ui/components.json` exists; add primitives via `pnpm -F @gmacko/ui ui-add`
- Icon library: `@radix-ui/react-icons` + `radix-ui` primitives; `class-variance-authority` + `tailwind-merge` for variants; `sonner` for toasts

**Storybook (confirmed present)**
- Storybook runs **inside `apps/nextjs`**, not `packages/ui`. Scripts: `pnpm -F @gmacko/nextjs storybook` (dev on 6006) and `storybook:build`.
- Addons: `@storybook/addon-a11y`, `@storybook/addon-docs`, `@storybook/nextjs-vite`
- **Story convention** (from `button.stories.tsx`): plain object `meta` with `title: "UI/<Name>"`, `component`, `tags: ["autodocs"]`, default `args`. Named exports are variants — `export const Primary = {}`, `export const Outline = { args: { variant: "outline" } }`. No explicit `Meta<typeof X>` / `StoryObj<typeof X>` typing.
- Stories live **next to the component** (flat, not in a `stories/` folder)

**Next.js app**
- Routes under `apps/nextjs/src/app/` (note: `src/app/`, not root `app/`)
- Route-private components use the `_components/` convention (e.g., `src/app/settings/_components/`, `src/app/admin/_components/`)
- Existing routes: `/`, `/settings`, `/admin` (+ `/admin/users`), `/pricing`, `/contact`, `/privacy`, `/changelog`, `/faq`, `/terms`, `/api/auth/[...all]`, `/api/trpc/[trpc]`, `/api/health/ready`, `/api/health/live`
- **tRPC is the router pattern**: `src/trpc/` client setup, route handler at `src/app/api/trpc/[trpc]/`, backed by `@gmacko/api`
- Form library: **TanStack Form** (`@tanstack/react-form`)
- Data fetching: **TanStack Query** (`@tanstack/react-query`) + `@trpc/tanstack-react-query`
- Monitoring: **Sentry** is pre-configured (`sentry.client.config.ts`, `sentry.edge.config.ts`, `sentry.server.config.ts`, `@sentry/nextjs`)
- i18n: **next-intl** pre-wired (`src/i18n/`)
- Env: `@t3-oss/env-nextjs` with `src/env.ts`
- Middleware: `src/middleware.ts` exists
- E2E: **Playwright** configured (`playwright.config.ts`, `e2e/`) — scripts: `pnpm -F @gmacko/nextjs e2e|e2e:ui|e2e:headed`

**Other packages in the template**
- `@gmacko/api` (tRPC routers), `@gmacko/validators`, `@gmacko/storage`, `@gmacko/realtime`, `@gmacko/notifications`, `@gmacko/email`, `@gmacko/analytics`, `@gmacko/flags`, `@gmacko/i18n`, `@gmacko/logging`, `@gmacko/monitoring`, `@gmacko/config`, `@gmacko/payments`, `@gmacko/billing`, `@gmacko/purchases`, `@gmacko/settings`, `@gmacko/operator-core`, `@gmacko/mcp-server`, `@gmacko/trpc-cli`, `@gmacko/trpc-client`

**Apps**
- `apps/nextjs` — command-center dashboard (desktop/tablet), planning, settlement overview
- `apps/expo` — mobile receipt capture, line-item claiming, itinerary review on-the-go
- `apps/tanstack-start` — not used in v1
- **Both Next.js AND Expo ship in v1.** Different form factors for different jobs, shared tRPC backend.

**Deploy**
- **Forge CLI** is the first-class deploy path: `pnpm forge:init`, `forge:diff`, `forge:apply`, `forge:deploy:staging`, `forge:deploy:production`

## Architectural Decision: Trip vs. Workspace

The template ships a multi-tenant **Workspace** model with roles and billing. We must decide what a Trip is relative to a Workspace before Phase 2.

**Option A — Trip = Workspace**. A trip IS a workspace. Members are workspace members. Reuses the existing roles/billing plumbing. Downside: workspaces carry billing state a trip doesn't need; "family" and "this trip" collapse into the same entity; ending a trip = archiving a workspace (awkward if the same family takes multiple trips).

**Option B — Trip ⊂ Workspace**. A Workspace represents a group of people who travel together repeatedly (a family, a friend group). A Trip is a child entity within a Workspace with its own members (subset of workspace members). Cleaner mental model; matches how people actually plan. Downside: more tables, more auth wiring (workspace-level AND trip-level guards).

**Option C — Trip is independent**. Trips stand on their own; ignore workspaces entirely. Simplest schema; reuses none of the template's multi-tenant work. Downside: walks away from working infrastructure and forces us to rebuild member-management UX.

**DECIDED: Option B** (confirmed after /autoplan review). A Workspace is the long-lived social unit (family or friend group); a Trip is a bounded event with its own invite list that defaults to all workspace members but can be a subset. This matches the user's mental model: "workspaces have many trips."

**Required guard scaffolding (Eng review finding E-1, CRITICAL):** Option B only works if authorization is enforced via a tRPC middleware chain, NOT helper functions. Helpers are opt-in and a single forgotten call = cross-trip data breach. Phase 2.0 must land `protectedProcedure → workspaceProcedure(wsId) → tripProcedure(tripId)` in `packages/api/src/auth/guards.ts` before any trip router code. Additionally: auto-create a personal workspace on first sign-in so solo users never see the workspace surface, gated behind `@gmacko/flags`.

## Guiding Constraints

- **Use the template as-is**. Do not fork it, do not relocate its packages, do not replace its conventions (Biome vs Prettier, Drizzle vs Prisma, pnpm vs bun). Any deviation must be called out as a conscious override with a reason.
- **Shared React components live in `@gmacko/ui`** (`packages/ui`) with their stories next to them. App-specific wiring lives in `apps/nextjs` (web) and `apps/expo` (mobile).
- **Server routers and server-only logic live in `@gmacko/api`**. Both `apps/nextjs` and `apps/expo` consume the same tRPC API. Database schema extensions live in `@gmacko/db`.
- **Trip auth is enforced via tRPC middleware chain** (`protectedProcedure → workspaceProcedure → tripProcedure`), NOT helper functions. This is non-negotiable per Eng review E-1.
- **Visual parity first**: the existing Palantir dashboard must look and behave identically after Phase 0. No redesigns until the migration is green.
- **Schema migrations are forward-only** via `drizzle-kit generate` / `migrate`. Every migration that touches seed-relevant tables updates `packages/db/src/seed.ts` in the same commit.
- **Every phase ends with a verification section** — a list of commands the reviewer runs to confirm the phase is done.
- **Every phase is a single PR** unless explicitly split. Phase titles map 1:1 to PR titles.

## Phase Dependency Graph

```
Phase 0 (Migration + Docs Scaffolding)
    │
    ├──> Phase 1 (Magic-Link Auth)
    │        │
    │        ├──> Phase 2 (Workspace Guards + Trips + Members + Lodging + Arrivals)
    │        │        │
    │        │        ├──> Phase 2P (Pre-Trip Planning: polls, proposals, room assignments, ground transport)
    │        │        │
    │        │        ├──> Phase 2.5 (Claim Interaction Spec + Palantir-on-Mobile Spec) [DESIGN GATE]
    │        │        │        │
    │        │        │        ├──> Phase 3 (Expenses + Receipts + OCR + Realtime Claiming)
    │        │        │        │        │
    │        │        │        │        └──> Phase 4 (Settlement + Venmo deep-links)
    │        │        │        │
    │        │        │        └──> Phase 5 (Map + Itinerary + Transit)
    │        │        │
    │        │        └──> Phase 6 (Dashboard Adaptation — planning view + intra-city command center)
    │        │
    │        └──> Phase 8 (Expo mobile app — receipt capture, claim, itinerary, planning votes)
    │
    └──> Phase 7 (ForgeGraph deploy — both apps)
```

**Trip lifecycle**: Planning → Confirmed → Active → Completed. A trip starts in `planning` status where polls, proposals, and logistics coordination happen. Once dates, destination, and lodging are locked, the organizer transitions to `confirmed` which locks in segments and opens expense tracking. `active` is set automatically when `startDate` arrives. `completed` when `endDate` passes.

Phase 2P (pre-trip planning) can land in parallel with Phase 2.5 since they don't share code. Phase 6's dashboard adapts to show the planning view when `status = 'planning'` and the command-center view when `status = 'active'`. Phase 8 (Expo) includes voting/reactions on proposals from mobile.

---

## Phase 0 — Adopt create-gmacko-app Template + Port Dashboard

**Goal**: replace the Vite SPA with the create-gmacko-app template in-place, port the existing dashboard components into `@gmacko/ui` and `apps/nextjs`, keep visual parity. No new features.

### Tasks

0.1 **Seed the repo with the template (atomic commit sequence — A14)**
This must be done as separate, verifiable commits. Not one giant commit.

**Commit 1: "chore: adopt create-gmacko-app template"**
- Snapshot files to preserve in a temp dir outside the repo: `DESIGN.md`, `README.md`, `LICENSE`, `CLAUDE.md`, `docs/` (screenshots), `src/*.jsx`, `src/*.js`, `src/index.css`, `tripData.js`
- `rsync -a --exclude='.git' --exclude='node_modules' --exclude='.turbo' --exclude='dist' --exclude='.next' ../create-gmacko-app/ ./`
- Commit immediately. `pnpm install && pnpm doctor && pnpm turbo run build` must pass on this commit alone before proceeding.
- Record the upstream SHA: `git -C ../create-gmacko-app rev-parse HEAD > docs/ai/TEMPLATE_SNAPSHOT_SHA.txt`

**Commit 2: "chore: restore project-specific files"**
- Restore preserved files: `DESIGN.md` (ours overrides template's), our `README.md` (merged with template's quickstart), our `LICENSE`, our `docs/` screenshots under `docs/screenshots/`, `docs/ai/` (proposal + plan + review)

**Commit 3: "chore: delete Vite leftovers"**
- Remove `index.html`, `vite.config.js`, `postcss.config.js`, and the top-level `src/` once its contents are ported in 0.3

**Subsequent commits**: one per ported component (0.3)

0.2 **Install and validate the template**
- `pnpm install` at the repo root
- `pnpm doctor` (template provides this)
- `pnpm format:check`
- `pnpm turbo run typecheck`
- `pnpm turbo run build`
All four must pass against the untouched template before porting any dashboard code. If any fail, stop and fix — do not move on.

0.3 **Port dashboard components into `@gmacko/ui`** (flat files, matching template convention)

Each becomes a flat file in `packages/ui/src/`, with a co-located story. **No folders per component** — match the template.

- `command-map.tsx` + `command-map.stories.tsx` ← `src/CommandMap.jsx`
- `inspector-rail.tsx` + `inspector-rail.stories.tsx` ← `src/InspectorRail.jsx`
- `activity-board.tsx` + `activity-board.stories.tsx` ← extracted from `App.jsx`
- `meals-planner.tsx` + `meals-planner.stories.tsx` ← extracted from `App.jsx`
- `mission-launch.tsx` + `mission-launch.stories.tsx` ← extracted from `App.jsx`
- `weather-widget.tsx` + `weather-widget.stories.tsx` ← `src/weather.js` split: pure format helpers stay inline, the view accepts already-fetched data as a prop
- `trip.ts` (types only, no story) ← `src/tripModel.js`

**Rules per component**:
- Convert JSX → TSX with explicit prop types. All components are presentational — no data fetching, no `localStorage`.
- Story file matches the template's convention literally: `const meta = { title: "Dashboard/<Name>", component, tags: ["autodocs"], args: {...} }; export default meta; export const Default = {};` plus variant exports where relevant. Do NOT import `Meta` / `StoryObj` types — the template uses plain objects.
- Add an entry to `packages/ui/src/index.ts` barrel
- Add per-component subpath exports to `packages/ui/package.json` (`"./command-map": "./src/command-map.tsx"`, etc.) matching the existing pattern for `button`, `input`, etc.
- Fixtures live in a single file: `packages/ui/src/__fixtures__/trip.ts` (matches the `__tests__` convention the template uses in `packages/db/src/`)

**Shadcn primitives**: if any dashboard component needs a primitive that `@gmacko/ui` doesn't already export (`select`, `tabs`, `dialog`, `tooltip`, `badge`, etc.), add them via `pnpm -F @gmacko/ui ui-add <name>` rather than hand-writing them. Do not duplicate Radix primitives.

0.4 **Design tokens**
- `DESIGN.md` stays unchanged — it's the source of truth.
- Token values (fonts, Palantir-style colors, spacing) go into `packages/tailwind-config` (the workspace package the template uses for shared Tailwind config). Read it first, add tokens without touching template defaults.
- Any dashboard-specific CSS from the old `src/index.css` goes into `apps/nextjs/src/app/globals.css` (or the template's equivalent — inspect first), NOT into `packages/ui`.

0.5 **Wire the dashboard into `apps/nextjs`** (using `src/app/` layout)
- Inspect `apps/nextjs/src/app/layout.tsx` and the existing `_components/` patterns first. Do not remove or rename template routes (`/settings`, `/admin`, `/pricing`, etc.).
- Add `apps/nextjs/src/app/demo/page.tsx` — unauthenticated, composes the ported `@gmacko/ui` dashboard components with fixture data from `apps/nextjs/src/app/demo/_components/trip-fixture.ts` (ported from `src/tripData.js`).
- Add `apps/nextjs/src/app/demo/_components/` for demo-only wiring if needed (e.g., a client-side persistence hook).
- Port `src/usePersistedTripState.js` to `apps/nextjs/src/app/demo/_components/use-persisted-trip-state.ts`. Stays client-side (`localStorage`) — no DB hookup until Phase 6 folds it into the authenticated trip view.
- Port `src/publishConfig.js` to `apps/nextjs/src/app/demo/_components/publish-config.ts`.
- The `/demo` route is unauthenticated by design so reviewers can confirm parity without signing in. Phase 6 deletes it.

0.6 **Delete the old Vite app**
- Remove the original `src/` once its contents are fully ported. Remove `index.html`, `vite.config.js`, `postcss.config.js`.
- Remove old root-level `package.json` entries that referenced Vite (the template's root `package.json` already replaced it in 0.1).
- Update `README.md` with the create-gmacko-app quickstart (pnpm install, pnpm dev, forge commands).

0.7 **CI**
- The template ships CI config — use whatever is already in `.github/` or `.gitea/` under the template. Do NOT introduce new workflow files in this phase. If the template has no CI workflows for `apps/nextjs` specifically, that is a Phase 7 problem.

0.8 **Extend `scripts/doctor.sh` (A21)**
- Add checks for all env vars the trip app needs: `BETTER_AUTH_SECRET`, `ANTHROPIC_API_KEY`, `GOOGLE_MAPS_API_KEY`, `STORAGE_DRIVER`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`. These can be marked optional (warn, don't fail) since not all are needed until later phases.

0.9 **Docs scaffolding (A22)**
Create the following files as stubs (table of contents only, content filled by later phases):
- `docs/ai/TEMPLATE_SNAPSHOT.md` — records upstream SHA, lists what was inherited vs. added
- `docs/ai/LOCAL_DEV.md` — exact clone-to-running sequence (Node 24, corepack, docker, env, db:migrate, dev:next)
- `docs/ai/COOKBOOK.md` — 5 recipes: adding a tRPC router, adding a Drizzle table (functional pgTable syntax), adding a shadcn primitive, writing a Storybook story, using the `tripProcedure` guard composition
- `docs/ai/ERROR_PLAYBOOK.md` — failure class × user-visible toast copy × log shape × recoverability
- `docs/ai/TESTING.md` — Vitest unit (single spec, watch), Playwright e2e (single spec, headed, trace), Claude API mocking via `MockOCRProvider`
- Update `CLAUDE.md` to reference all five docs

0.A **Unified `DEV_MODE=local` toggle (A23)**
- When `DEV_MODE=local` is set in `.env`:
  - Email: console log transport (regardless of `@gmacko/email` provider)
  - Storage: local disk at `.data/receipts/`
  - OCR: `OCR_PROVIDER=fixture` reading canned JSON from `packages/api/src/ocr/__fixtures__/*.json` keyed by image hash (no Claude API calls, no cost)
- Document in `docs/ai/LOCAL_DEV.md`

### Verification (Phase 0)

- `pnpm install` succeeds
- `pnpm doctor` reports no errors
- `pnpm format:check` clean (Biome)
- `pnpm turbo run typecheck` passes across all workspaces
- `pnpm turbo run build` builds `@gmacko/ui` and `@gmacko/nextjs`
- `pnpm -F @gmacko/nextjs storybook` starts Storybook on :6006 and shows all 6 ported dashboard stories under "Dashboard/..." alongside the existing "UI/Button" etc.
- `pnpm dev:next` serves the app on localhost and `/demo` renders the ported dashboard with visual density matching `docs/screenshots/dashboard-overview.png`
- **Visual regression snapshot gate (A15)**: take a Playwright screenshot of `/demo` and commit it as `e2e/__screenshots__/demo-baseline.png`. Phase 6 uses this for comparison.
- The old `src/`, `index.html`, `vite.config.js`, `postcss.config.js` are gone
- `DESIGN.md` is unchanged from pre-migration
- `pnpm -F @gmacko/nextjs e2e` still passes whatever Playwright tests the template ships with (we haven't broken the template's golden paths)
- `docs/ai/LOCAL_DEV.md`, `COOKBOOK.md`, `ERROR_PLAYBOOK.md`, `TESTING.md`, `TEMPLATE_SNAPSHOT.md` exist as stubs
- `CLAUDE.md` references the new docs

### Out of scope for Phase 0

- Any new tables in `@gmacko/db` (template's schema ships as-is)
- Any new routes under authenticated paths
- Map/expense/group features — all Phase 2+
- Magic link auth (Phase 1)

---

## Phase 1 — Enable Magic-Link Auth

**Goal**: add Better Auth's magic-link plugin via `extraPlugins` (no fork of `@gmacko/auth`), wire delivery through `@gmacko/email`, and keep all template routes working. Schema changes are minimal — just whatever Better Auth's magic-link plugin requires on the verifications table (which `auth-schema.ts` already has).

**Out of scope**: adding any new domain tables. `trips` lives in Phase 2 because the Trip-vs-Workspace decision must be committed before we touch the schema.

### Investigate Before Coding (mandatory, record in PR)

- `apps/nextjs/src/auth/server.ts` — how is `initAuth` called today? Where does the Discord secret come from?
- `apps/nextjs/src/env.ts` — what env vars does the app already require?
- `packages/email/src/index.ts` — what's the public API for sending an email? Does it have a dev-mode log transport, or do we need to add one?
- `packages/notifications/src/index.ts` — does this wrap `@gmacko/email`, or is it a different channel (push, in-app)? Use whichever is right for transactional email.
- `docker-compose.yml` — confirm Postgres service exists and note the port.
- `packages/db/src/auth-schema.ts` — confirm `verification` table exists (Better Auth magic link uses it directly; no new tables should be needed).

### Tasks

1.1 **Local Postgres + env**
- `docker compose up -d postgres` (exact service name from `docker-compose.yml`)
- `cp .env.example .env`, fill `DATABASE_URL`, `BETTER_AUTH_SECRET`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` (template requires these for its existing auth setup — use dummy values locally if Discord OAuth isn't being tested this phase)
- `pnpm doctor` — resolve anything it flags

1.2 **Add magic-link plugin in `apps/nextjs/src/auth/server.ts`** (A3, A4)
- Import `magicLink` from `better-auth/plugins`
- **CRITICAL: `nextCookies()` must remain LAST in the extraPlugins array** (Better Auth requirement for Server Actions cookie capture). The existing code has `extraPlugins: [nextCookies()]`. Correct shape after adding magic link: `extraPlugins: [magicLink({ sendMagicLink: async ({ email, url }) => { ... } }), nextCookies()]`
- **Also add `magicLinkClient()` to `apps/nextjs/src/auth/client.ts`** — without this, `authClient.signIn.magicLink` is `undefined` at runtime
- `sendMagicLink` implementation:
  - Import the email sender from `@gmacko/email`
  - In dev (detected via `env.NODE_ENV === "development"`): log the URL to the console with a visible banner (`console.log("\n\n🔗 MAGIC LINK for <email>:\n" + url + "\n\n")`). Do this regardless of whether `@gmacko/email` has its own log transport, because we want the link visible in `pnpm dev:next` output.
  - In non-dev: call `@gmacko/email`'s send function with a minimal HTML template (subject `"Sign in to Trip Command Center"`, one-button link)
- If `@gmacko/email` requires a transport that isn't configured yet, guard the non-dev branch with a TODO referencing Phase 7 and fail loudly rather than silently swallowing

1.3 **Regenerate and migrate (if needed)**
- Run `pnpm auth:generate` — the magic link plugin should not add new tables (it reuses `verification`), but running the generator confirms `packages/db/src/auth-schema.ts` is still accurate
- `pnpm db:generate` and `pnpm db:migrate` — should be a no-op or produce an empty migration

1.4 **Sign-in UX**
- Inspect the template's existing sign-in surface first. If the template already has a sign-in route that handles OAuth, add magic link as an additional option on the same page rather than creating a parallel route.
- If the template has no magic-link UI:
  - Add `apps/nextjs/src/app/sign-in/page.tsx` (or extend an existing one) with a `@tanstack/react-form` form: email input + submit button + "check your email" confirmation state. Use `authClient.signIn.magicLink({ email })` from `apps/nextjs/src/auth/client.ts` (add the magic-link client method if it's not already exported).
  - Magic-link callback is handled by the existing `api/auth/[...all]` route — no new verify page needed unless Better Auth's docs say otherwise for this plugin version.
- Redirect destination after successful sign-in: the existing `/` or `/settings` — do NOT create a new authenticated home in this phase.

1.5 **Keep the legacy `/demo` route working**
- Added in Phase 0. Confirm it still renders and is unauthenticated. No edits expected.

### Verification (Phase 1)

- `pnpm db:migrate` is a no-op or applies a trivially empty migration
- `pnpm dev:next` → open `/sign-in` → enter email → see the magic link in the dev console → click it → land on the post-sign-in destination as an authenticated session
- `pnpm -F @gmacko/nextjs e2e` passes (the template's existing e2e tests must not regress)
- `/demo` still renders the legacy dashboard without auth
- Running `pnpm auth:generate && pnpm db:generate` produces no schema diff — confirms we didn't accidentally fork the auth schema

---

## Phase 2 — Workspace Guards + Trips + Members + Group Mode

**Goal**: build the workspace→trip auth middleware chain (E-1), add trip CRUD with invites, and add a destination picker that doesn't depend on Google Maps JS (D-1 phase-ordering fix).

### Tasks

2.0 **Workspace guards (A7, CRITICAL — must land before any trip router)**
- `packages/api/src/auth/guards.ts`:
  - `workspaceProcedure(wsId)` — tRPC middleware that reads `ctx.userId`, verifies workspace membership, injects `ctx.workspaceId` and `ctx.workspaceRole`
  - `tripProcedure(tripId)` — tRPC middleware (child of `workspaceProcedure`) that verifies trip membership within the workspace, injects `ctx.tripId` and `ctx.tripRole`
  - Every trip router below MUST use `tripProcedure`, not a helper function. This is enforced by having no exported helper function — the only path to a trip-scoped context is the middleware chain.
- Auto-create a **personal workspace** on first sign-in (Better Auth `onLogin` hook or tRPC middleware). Gate the workspace switcher UI behind `@gmacko/flags` (`WORKSPACES_VISIBLE`) so solo users never see it.
- Workspace switcher UX (simple for now): dropdown in the nav showing workspace name + members, with a "Create workspace" action.

2.1 **Schema additions in `packages/db/src/schema/`**

`trips.ts`:
```ts
trips: id (uuid, pk, default random),
  workspaceId (fk → workspace.id, not null),
  name (text, not null),
  createdByUserId (fk → users.id, not null),
  status ('planning' | 'confirmed' | 'active' | 'completed'),  // trip lifecycle
  groupMode (boolean, not null, default false),
  claimMode (text, not null, default 'organizer'),  // 'organizer' | 'tap'
  destinationName (text nullable),  // nullable during planning phase — may not be decided yet
  destinationLat (numeric nullable), destinationLng (numeric nullable),
  defaultZoom (int, default 13), startDate (date nullable), endDate (date nullable),  // nullable during planning
  timezone (text, not null, default 'UTC'),  // A30: trip-local timezone
  createdAt, updatedAt

// ═══════════════════════════════════════════════════════
// PRE-TRIP PLANNING (status = 'planning')
// Collaborative decision-making before anything is booked
// ═══════════════════════════════════════════════════════

// Polls: date availability, location preferences, any yes/no/rank question
polls: id (uuid, pk, default random),
  tripId (fk → trips.id, not null),
  createdByUserId (fk → users.id, not null),
  title (text, not null),               // "Which weekends work?" / "Where should we go?"
  pollType ('date_range' | 'single_choice' | 'multi_choice' | 'ranked'),
  status ('open' | 'closed'),
  closesAt (timestamp nullable),        // auto-close deadline
  createdAt, updatedAt

// Poll options: the choices people vote on
pollOptions: id (uuid, pk, default random),
  pollId (fk → polls.id, not null),
  label (text, not null),               // "Mar 14-21" / "Milan" / "This Airbnb on Via Dante"
  description (text nullable),
  url (text nullable),                  // link to an Airbnb listing, flight search, etc.
  sortOrder (int, not null),
  createdAt

// Poll votes: each member's response per option
pollVotes: id (uuid, pk, default random),
  pollOptionId (fk → pollOptions.id, not null),
  userId (fk → users.id, not null),
  response ('yes' | 'no' | 'maybe' | 'prefer'),  // for date/single/multi
  rank (int nullable),                             // for ranked polls
  note (text nullable),                            // "I can only do the second weekend if I move my Tuesday meeting"
  createdAt, updatedAt
  unique (pollOptionId, userId)

// Proposals: shared flight options, lodging options, car rentals, activity ideas
// that members can browse, react to, and discuss before booking
proposals: id (uuid, pk, default random),
  tripId (fk → trips.id, not null),
  segmentId (fk → tripSegments.id, nullable),      // null if the segment isn't decided yet
  createdByUserId (fk → users.id, not null),
  proposalType ('flight' | 'lodging' | 'car_rental' | 'activity' | 'other'),
  title (text, not null),                           // "United JFK→MXP $412 RT" / "Rosa's Apartment on Airbnb"
  description (text nullable),
  url (text nullable),                              // booking link
  priceCents (int nullable),
  currency (text, default 'USD'),
  priceNote (text nullable),                        // "per person" / "per night" / "total for 4 nights"
  imageUrl (text nullable),                         // pulled from link parsing
  status ('proposed' | 'selected' | 'booked' | 'rejected'),
  bookedByUserId (fk → users.id, nullable),         // who actually booked it
  createdAt, updatedAt

// Proposal reactions: thumbs up/down + comments on proposals
proposalReactions: id (uuid, pk, default random),
  proposalId (fk → proposals.id, not null),
  userId (fk → users.id, not null),
  reaction ('up' | 'down' | 'interested' | 'booked'),  // "booked" = "I bought this flight"
  note (text nullable),                                  // "This one has a 6-hour layover though"
  createdAt, updatedAt
  unique (proposalId, userId)

// Room assignments: who's staying with whom (decided during planning, refined later)
roomAssignments: id (uuid, pk, default random),
  lodgingId (fk → lodgings.id, not null),
  roomLabel (text, not null),           // "Master bedroom" / "Room 1" / "Pullout couch"
  sortOrder (int, not null),
  createdAt

roomOccupants: id, roomAssignmentId (fk), userId (fk → users.id)
  unique (roomAssignmentId, userId)

// Ground transport groups: airport → lodging coordination
groundTransportGroups: id (uuid, pk, default random),
  segmentId (fk → tripSegments.id, not null),
  createdByUserId (fk → users.id, not null),
  transportType ('rental_car' | 'taxi' | 'rideshare' | 'shuttle' | 'public_transit'),
  label (text, not null),               // "Airport pickup group 1 (arriving ~3pm)"
  fromDescription (text nullable),      // "MXP Terminal 1"
  toDescription (text nullable),        // "Airbnb on Via Dante"
  scheduledAt (timestamp nullable),
  costCents (int nullable),
  currency (text, default 'USD'),
  notes (text nullable),
  createdAt, updatedAt

groundTransportMembers: id, groundTransportGroupId (fk), userId (fk → users.id)
  unique (groundTransportGroupId, userId)

// ═══════════════════════════════════════════════════════
// CONFIRMED TRIP (status = 'confirmed' | 'active')
// ═══════════════════════════════════════════════════════

// Multi-stop trips: a trip can have multiple segments (e.g., Milan → Florence → Rome)
// A single-destination trip has zero segments; the trip itself is the segment.
// When segments exist, each has its own destination, dates, and member subset.
tripSegments: id (uuid, pk, default random),
  tripId (fk → trips.id, not null),
  name (text, not null),  // e.g., "Milan", "Florence", "Rome"
  destinationName (text), destinationLat (numeric), destinationLng (numeric),
  defaultZoom (int, default 13),
  startDate (date, not null), endDate (date, not null),
  timezone (text, not null, default 'UTC'),
  sortOrder (int, not null),
  createdAt, updatedAt

// Per-segment membership: who's there for which leg
// (a subset of tripMembers — e.g., Alice + Bob for Milan, Bob + Carol for Florence)
segmentMembers: id, segmentId (fk → tripSegments.id), userId (fk → users.id)
  unique (segmentId, userId)

// Lodging: Airbnb, hotel, VRBO reservations per segment
// Integrates with booking platforms where APIs exist; falls back to email parsing / manual entry
lodgings: id (uuid, pk, default random),
  segmentId (fk → tripSegments.id, not null),
  createdByUserId (fk → users.id, not null),
  provider ('airbnb' | 'vrbo' | 'hotel' | 'hostel' | 'other'),
  propertyName (text not null),          // "Rosa's Apartment" / "Grand Hotel Milan"
  address (text nullable),
  lat (numeric nullable), lng (numeric nullable),  // geocoded from address, becomes the lodging pin
  checkInAt (timestamp not null),
  checkOutAt (timestamp not null),
  checkInInstructions (text nullable),   // door code, key pickup, etc.
  confirmationNumber (text nullable),
  bookingUrl (text nullable),            // deep link back to the booking
  nightlyRateCents (int nullable),
  totalCostCents (int nullable),
  currency (text, not null, default 'USD'),
  hostName (text nullable),
  hostPhone (text nullable),
  notes (text nullable),
  sourceType ('manual' | 'email_parsed' | 'api_imported' | 'link_parsed'),
  sourceRaw (text nullable),             // raw email/link text for re-parsing if needed
  createdAt, updatedAt

// Which members are staying at this lodging (subset of segment members)
lodgingGuests: id, lodgingId (fk → lodgings.id), userId (fk → users.id)
  unique (lodgingId, userId)

// Arrivals & departures: members provide flight/train info per segment
// Enables real-time ETA tracking on the command-center dashboard
memberTransits: id (uuid, pk, default random),
  segmentId (fk → tripSegments.id, not null),
  userId (fk → users.id, not null),
  direction ('arrival' | 'departure'),
  transitType ('flight' | 'train' | 'bus' | 'car' | 'other'),
  carrier (text nullable),        // e.g., "United", "Trenitalia", "FlixBus"
  transitNumber (text nullable),  // e.g., "UA 123", "FR 9632"
  departureStation (text nullable),
  arrivalStation (text nullable),
  scheduledAt (timestamp not null),       // planned arrival/departure time
  estimatedAt (timestamp nullable),       // live ETA from tracking API (updated periodically)
  actualAt (timestamp nullable),          // confirmed actual time
  trackingStatus ('scheduled' | 'en_route' | 'delayed' | 'arrived' | 'cancelled'),
  notes (text nullable),
  createdAt, updatedAt
```

**Every trip has at least one segment.** A single-destination Milan trip has one segment ("Milan"). A two-week Europe trip has three: Milan (days 1-4, everyone) → Florence (days 5-7, just Alice and Bob) → Rome (days 8-14, Bob and Carol join). No special-casing for "zero segments" — the model is uniform. Creating a trip auto-creates one segment with the trip's destination and date range. The segment switcher hides when there's only one segment (nothing to switch), but the data model is always segments all the way down. This means `segmentId` on expenses and pins is NOT nullable — every expense and pin belongs to a segment.

`members.ts`:
```ts
tripMembers: id, tripId (fk), userId (fk), role ('organizer' | 'member'), displayName, colorHex, venmoHandle (text nullable), joinedAt
  unique (tripId, userId)

tripInvites: id, tripId (fk), email (citext), token (text unique, ≥128 bits via crypto.randomBytes(16).toString('base64url')), invitedByUserId, expiresAt, acceptedAt (nullable)
```

2.2 **Destination picker (A24, phase-ordering fix)**
- `packages/ui/src/destination-picker.tsx` + story — text input with server-side geocoding (Google Geocoding API, or a free alternative like Nominatim/MapTiler geocode for Phase 2 only). Returns `{ name, lat, lng }`. No Google Maps JS dependency.
- Saves `destinationName`, `destinationLat`, `destinationLng` to the trip. Phase 5's map component reads these as its default center.

2.3 **API routers in `packages/api/src/routers/`** (all scoped via `tripProcedure`)
- `trips.ts`: `create`, `list` (trips in the user's workspace), `get`, `update` (organizer only), `setGroupMode`, `setClaimMode`
- `members.ts`: `listForTrip`, `updateSelf` (displayName, color, venmoHandle), `removeMember` (organizer only)
- `invites.ts`: `create` (organizer only — takes email, generates invite token, emails via `@gmacko/email`), `accept` (token — also auto-provisions workspace membership in a transaction), `listPending` (organizer only)

2.4 **Lodging management**
- `packages/api/src/routers/lodgings.ts` (scoped via `tripProcedure`): `create`, `update`, `delete`, `listForSegment`, `assignGuests`
- **Four input methods**, in order of integration depth:

  **a) Manual entry** — always available. Form for property name, address, check-in/out, confirmation number, cost. Geocodes the address to place a lodging pin on the map automatically.

  **b) Link parsing** — paste an Airbnb/VRBO/Booking.com listing URL. Server-side fetch + Claude vision/extraction to pull property name, address, photos, nightly rate, check-in/out rules. Works because listing pages are public. This is the cheapest integration with the highest ROI.

  **c) Email forwarding/paste** — forward confirmation email to a trip-specific address (`trip-abc123@inbound.<domain>`) or paste the email body. Claude extracts all fields including confirmation number, total cost, host info, check-in instructions. Similar to TripIt's model but with LLM parsing instead of regex.

  **d) API import** — where available:
  - **Hotels**: no unified API. Major chains (Marriott, Hilton, IHG) have loyalty APIs but they're partner-only. For v1, hotel reservations come via email/link parsing or manual entry.
  - **Airbnb**: no public API (killed in 2023). Listing pages are scrapeable for property details, but reservation details (confirmation, total, host phone) require email parsing. For v1: link parsing for property info + email paste for reservation details.
  - **VRBO/Booking.com**: Expedia Rapid API exists but is affiliate/partner-only. Same approach as Airbnb: link parse + email paste.
  - **Google Hotels**: potential v1.1 integration via SerpAPI or similar for price comparison data.

  **Realistic v1 strategy**: manual entry + link parsing + email paste, all powered by Claude extraction. No booking platform API keys needed. API import becomes v1.1 if/when partner access is available.

- When a lodging is created, auto-create a **lodging pin** on the map at the geocoded address. The pin links back to the lodging detail.
- Lodging cost auto-creates a **draft expense** with `category: 'lodging'` that can be split among `lodgingGuests`.

2.4-ui **Lodging UI in `packages/ui/src/`**
- `lodging-card.tsx` + story — property name, provider badge (Airbnb/VRBO/hotel icon), dates, address, nightly rate, guest avatars, check-in countdown. Tap to see full details.
- `lodging-detail.tsx` + story — all fields including check-in instructions (door code etc.), host contact, booking link, map preview. Important: check-in instructions should be prominent and accessible offline-ready (they're needed at the door).
- `lodging-input-form.tsx` + story — tabbed: Manual / Paste Link / Paste Email. Link and email tabs show a single text input + "Extract" button that triggers Claude parsing. Results pre-fill the form for review before saving.
- `lodging-guest-picker.tsx` + story — select which segment members are staying here (default: all segment members).

2.5 **Arrival/departure tracking**
- `packages/api/src/routers/member-transits.ts` (scoped via `tripProcedure`): `create`, `update`, `delete`, `listForSegment`
- Members enter their flight/train number (e.g., "UA 123", "FR 9632") and scheduled time. The system stores `carrier`, `transitNumber`, `departureStation`, `arrivalStation`, `scheduledAt`.
- **Live tracking (v1 scope: best-effort)**: a periodic server job (or on-demand refresh) queries a flight/train status API to update `estimatedAt` and `trackingStatus`. Candidate APIs:
  - Flights: [AviationStack](https://aviationstack.com/) free tier (500 requests/month) or [FlightAware AeroAPI](https://flightaware.com/aeroapi/)
  - Trains: harder — European trains have no unified API. For v1, manual update by the member is the fallback; automated tracking deferred to v1.1 when we can evaluate [Trainline API](https://www.thetrainline.com/) or scraping individual operators.
- When `estimatedAt` diverges from `scheduledAt` by > 30 min, the dashboard surfaces a delay alert.

2.5-transit **UI for arrivals/departures in `packages/ui/src/`**
- `member-transit-card.tsx` + story — shows carrier logo/icon, transit number, route (JFK → MXP), scheduled vs. estimated time, status badge (on time / delayed / en route / arrived). Monospace time display per DESIGN.md.
- `arrivals-board.tsx` + story — airport-style arrivals/departures board for the segment. Shows all members' transits sorted by time, with live status. This is the Palantir command-center money shot — real-time transit data rendered in the dashboard aesthetic.
- `transit-input-form.tsx` + story — form for entering flight/train details. Auto-detects carrier from the transit number format (e.g., "UA" → United Airlines, "FR" → Trenitalia Frecciarossa). Fields: type (flight/train/bus/car), number, departure/arrival stations, scheduled time.

2.6 **UI components in `packages/ui/src/`** (flat files, not folders)
- `trip-card.tsx` + story — summary card (name, dates, member avatars, group-mode badge)
- `trip-list.tsx` + story — grid of trip cards with a "Create trip" CTA
- `group-mode-toggle.tsx` + story — switch with description; disabled for non-organizers
- `member-chip.tsx` + story — avatar + name + color
- `invite-dialog.tsx` + story — email input list + send button + sent state
- `member-roster.tsx` + story — vertical list of member-chips
- `destination-picker.tsx` + story (from 2.2)

Every component gets stories for Default + Empty + Loading states (A27 states matrix).

2.5 **Routes in `apps/nextjs/src/app/`**
- `trips/page.tsx` — trip list (replaces placeholder from Phase 1)
- `trips/new/page.tsx` — create trip form with destination picker
- `trips/[tripId]/page.tsx` — trip dashboard shell (branches on `groupMode`)
- `trips/[tripId]/settings/page.tsx` — name, dates, destination, group mode toggle, claim mode toggle, invite dialog, member roster, venmo handle, leave trip

2.6 **Invite acceptance flow**
- Invite link: `https://<host>/invite/<token>`
- `apps/nextjs/src/app/invite/[token]/page.tsx` — if unauthenticated, triggers magic link sign-in with the invite email prefilled; on success, accepts invite (which auto-provisions workspace membership in a transaction) and redirects to the trip dashboard.

2.3 **UI components in `packages/ui/src/`**
- `trip-card/` — summary card (name, dates, member avatars, group-mode badge)
- `trip-list/` — grid of trip cards with a "Create trip" CTA
- `group-mode-toggle/` — switch with a short description; disabled unless the caller is the organizer
- `member-chip/` — avatar + name + color
- `invite-dialog/` — email input list + send button + sent state
- `member-roster/` — vertical list of `member-chip` components

Every component gets a story with at least Default + Empty + Loading states.

2.4 **Routes in `apps/nextjs/src/app/`**
- `app/app/page.tsx` — trip list (replaces the placeholder from Phase 1)
- `app/app/trips/new/page.tsx` — create trip form
- `app/app/trips/[tripId]/page.tsx` — trip dashboard shell (renders legacy dashboard if `groupMode === false`, else group-mode dashboard placeholder)
- `app/app/trips/[tripId]/settings/page.tsx` — name, dates, destination, group mode toggle, claim mode toggle, invite dialog, member roster, leave trip

2.5 **Invite acceptance flow**
- Invite link format: `https://<host>/invite/<token>`
- `apps/nextjs/app/invite/[token]/page.tsx` — if unauthenticated, triggers magic link sign-in with the invite email prefilled; on success, accepts the invite and redirects to the trip dashboard.

### Verification (Phase 2)

- A user can create a trip with a destination (geocoded text search), invite two email addresses, and both recipients can join via the invite link and see the trip in their trip list
- Invite acceptance auto-provisions workspace membership in a single transaction
- Organizer can flip group mode on/off; the toggle is hidden for non-organizers
- Only trip members can load the trip dashboard — a non-member gets a 403 (enforced by `tripProcedure` middleware, NOT a helper)
- `pnpm -F @gmacko/api test` passes — tests cover: create trip, workspace-scoped listing, membership guard (positive + negative), group-mode toggle authorization, invite token generation (≥128 bits entropy), invite acceptance + workspace auto-provision

---

## Phase 2P — Pre-Trip Planning

**Goal**: collaborative decision-making before anything is booked. Polls for dates and destinations, shared flight/lodging/car proposals with voting, room assignments, and airport-to-lodging ground transport coordination. The trip dashboard in `planning` status shows this instead of the itinerary/expense views.

### Trip Lifecycle

A trip has a `status` field that gates which features are available:

| Status | Trigger | What's available | What's locked |
|---|---|---|---|
| `planning` | Trip created | Polls, proposals, reactions, room assignments, ground transport groups, member invites | Expenses, settlement, pins (can't plan activities before dates/destination are decided) |
| `confirmed` | Organizer clicks "Lock it in" | Everything from planning + segments finalized, lodging booked, expenses/pins now open | Poll creation (polls auto-close) |
| `active` | `startDate` arrives (auto) | Full command-center dashboard, expense capture, claiming, itinerary | Adding new segments |
| `completed` | `endDate` passes (auto) | Settlement, trip summary/recap, expense finalization | New expenses (grace period: 7 days after `endDate` for stragglers) |

**Transition from planning → confirmed**: organizer reviews all polls (checks winning options), confirms destination + dates (populates `destinationName`, `startDate`, `endDate`), creates segments, and hits "Lock it in." This auto-creates the first segment from the trip's destination/dates. Proposals marked `selected` auto-convert to lodgings or `memberTransits`.

### Tasks

2P.1 **Polls routers** (scoped via `tripProcedure`)
- `packages/api/src/routers/polls.ts`: `create`, `addOption`, `vote`, `updateVote`, `close`, `listForTrip`, `getResults`
- Results endpoint returns: per-option vote counts, per-option voter list, winning option(s) by count or average rank
- Poll types:
  - `date_range`: options are date ranges, responses are yes/no/maybe. Renders as a When2Meet-style availability grid.
  - `single_choice`: pick one (e.g., "Which city?"). Shows ranked bar chart of votes.
  - `multi_choice`: pick many (e.g., "Which activities interest you?"). Shows vote counts.
  - `ranked`: rank all options (e.g., "Rank these 3 Airbnbs"). Shows average rank.

2P.2 **Proposals routers** (scoped via `tripProcedure`)
- `packages/api/src/routers/proposals.ts`: `create`, `update`, `react`, `listForTrip`, `markSelected`, `markBooked`, `markRejected`
- When creating a proposal with a URL: server-side fetch + Claude extraction to auto-fill title, price, image, description (same pattern as lodging link parsing)
- `markBooked` sets `bookedByUserId` and optionally auto-creates:
  - Flight proposal → `memberTransit` record
  - Lodging proposal → `lodging` record
  - Car rental proposal → `groundTransportGroup`

2P.3 **Room assignments routers**
- `packages/api/src/routers/rooms.ts`: `createRoom`, `assignOccupant`, `removeOccupant`, `listForLodging`
- Shows how many beds/spots are available per lodging (manual count), who's assigned where, who's unassigned

2P.4 **Ground transport coordination routers**
- `packages/api/src/routers/ground-transport.ts`: `createGroup`, `joinGroup`, `leaveGroup`, `listForSegment`
- Smart grouping suggestion: when members' `memberTransits` arrivals are within 2 hours of each other, suggest "Group ride from airport?" with those members pre-selected

2P.5 **Planning dashboard UI in `packages/ui/src/`**
- `date-poll.tsx` + story — When2Meet-style grid: dates on X axis, members on Y, cells are yes (green) / maybe (yellow) / no (red). Shows overlap heat-map highlighting dates that work for everyone.
- `poll-card.tsx` + story — summary card for any poll: title, type badge, vote count, status, winning option preview
- `poll-results.tsx` + story — bar chart (single/multi choice), rank table (ranked), availability grid (date range)
- `proposal-card.tsx` + story — rich card with image (from link parsing), title, price, price-note, provider badge, URL link-out, reaction counts (thumbs up/down/interested/booked), member who proposed it
- `proposal-feed.tsx` + story — filterable feed of all proposals grouped by type (flights / lodging / cars / activities). Shows "X of Y members interested" progress bar.
- `room-assignment-board.tsx` + story — lodging card at top, rooms below as columns/cards, member chips draggable between rooms. Unassigned members highlighted. Room count vs. guest count shown.
- `ground-transport-card.tsx` + story — "Airport pickup group" card showing members, arrival times, transport type, from/to, cost split preview
- `transport-suggestion.tsx` + story — auto-generated card: "Alice (lands 14:30) and Bob (lands 15:15) — share a ride from MXP?" with one-tap group creation
- `planning-dashboard.tsx` + story — the top-level planning view composed of: active polls (prioritized), recent proposals, lodging status, room assignments, arrival timeline, ground transport groups. This replaces the itinerary/expense dashboard when `trip.status === 'planning'`.
- `lock-it-in-wizard.tsx` + story — multi-step confirmation: review winning poll results → confirm destination + dates → create segments → convert selected proposals to bookings → transition to `confirmed`. Shows what will be locked and what will auto-convert.

2P.6 **Planning routes in `apps/nextjs/src/app/trips/[tripId]/`**
- `plan/page.tsx` — the planning dashboard (renders when `trip.status === 'planning'`)
- `plan/polls/page.tsx` — all polls with create button
- `plan/polls/[pollId]/page.tsx` — poll detail with voting interface
- `plan/proposals/page.tsx` — proposal feed with filters
- `plan/rooms/page.tsx` — room assignment board
- `plan/transport/page.tsx` — ground transport groups + suggestions
- `plan/lock-in/page.tsx` — the "lock it in" wizard

2P.7 **Realtime for planning**
- `@gmacko/realtime` Pusher channel per trip: `private-trip-${tripId}`
- Events: `poll:voted`, `proposal:created`, `proposal:reacted`, `room:assigned`, `transport:joined`
- All planning views subscribe and invalidate TanStack Query on events — so when someone votes or reacts, everyone sees it live

### Verification (Phase 2P)

- An organizer can create a date poll, 3 members vote, and the overlap grid correctly highlights winning dates
- A member can paste an Airbnb URL as a lodging proposal; Claude extracts title, image, price; other members react with thumbs up/down
- A member can paste a flight search URL; Claude extracts flight details and price
- Room assignments show unassigned members highlighted; drag-and-drop (or tap) assigns them
- Ground transport auto-suggests grouping when two arrivals are within 2 hours
- "Lock it in" wizard converts winning dates → trip dates, winning lodging → lodging record, booked flights → memberTransits, and transitions trip to `confirmed`
- After confirmation, the trip dashboard switches from planning view to itinerary/expense view
- `pnpm -F @gmacko/api test` passes for poll voting logic (date overlap, ranked winner, tied results), proposal auto-conversion, and trip lifecycle transitions

---

## Phase 2.5 — Design Gate (BLOCKING)

**Goal**: produce the two design specs that the Design review identified as blockers for Phase 3.

### Tasks

2.5a **Write `docs/ai/CLAIM_SPEC.md` (A25)**
A 1-2 page interaction spec covering:
- Mental model: tap-to-claim is per-expense default (from trip settings), not a global mode
- Tap mode: row with name + price left, claimants' color chips right, 44px full-row tap affordance, show claimants live. Double-claim auto-shares (cooperation, not conflict). Optimistic UI with reconciliation via `@gmacko/realtime` Pusher.
- Organizer mode: popover button showing member chips; tap to toggle
- Pass-the-phone: top bar "Claiming as: [me v]" lets you switch the acting user without signing out (one device shared at a restaurant table)
- Unclaimed items resolution: after finalize (or grace period), organizer gets "Resolve unclaimed" — split among all or assign to payer
- Polling cadence fallback: 3s when expense detail is foregrounded, paused when hidden (`document.visibilityState`)

2.5b **Add "Palantir on Mobile" section to `DESIGN.md` (A26, A28)**
- Minimum touch target: 44px (achieved by padding around content). Desktop-only surfaces can use dense layout.
- Mobile base type: 15px Inter, 14px Geist Mono tabular
- Mobile chrome: keep `#0A0C10` bg, sharp radii, all-caps labels. Collapse multi-column layouts and side rails.
- Receipt capture: full-bleed camera mode, chrome collapses to a single top status bar
- WCAG AA floor declared for all surfaces
- Route × form-factor table with breakpoints: 0–767 phone, 768–1279 tablet, 1280+ desktop
- Declare which routes are phone-primary (expense/new, expense detail, claim) vs desktop-primary (map, timeline, settlement overview)

### Verification (Phase 2.5)

- `docs/ai/CLAIM_SPEC.md` exists and covers all 6 topics above
- `DESIGN.md` has a "Palantir on Mobile" section with breakpoints, touch targets, and route × form-factor table
- Phase 3 may begin

---

## Phase 3 — Expenses, Receipts, OCR, Realtime Claiming

**Goal**: members can upload receipts, have line items extracted automatically, assign items with live updates via Pusher, and see individual totals. Currency is stored per expense.

**Prerequisite**: Phase 2.5 (CLAIM_SPEC.md + Palantir-on-Mobile) must be complete.

### Investigate Before Coding (mandatory, A5)

Read `packages/storage/src/index.ts` first. The template ships `@gmacko/storage` with UploadThing. Decide: extend `@gmacko/storage` with an S3 backend for ForgeGraph (preferred), or adopt UploadThing. Do NOT build a parallel `packages/api/src/storage/`.

Read `packages/realtime/src/index.ts`. The template ships `@gmacko/realtime` with Pusher broadcast primitives. Use it for tap-to-claim live updates (A6).

### Tasks

3.1 **Schema additions in `packages/db/src/schema/`**

`expenses.ts`:
```ts
expenses: id, tripId (fk), segmentId (fk → tripSegments.id, not null),
  payerUserId (fk), merchant, occurredAt (timestamp),
  category (text, not null, default 'general'),  // 'meal' | 'transit' | 'lodging' | 'activity' | 'drinks' | 'tickets' | 'general'
  subtotalCents (int), taxCents (int), tipCents (int), totalCents (int),
  currency (text, not null, default 'USD'),  // A8: stored per expense
  notes (text nullable), ocrConfidence (real nullable), status ('draft' | 'finalized'),
  createdAt, updatedAt
```

**Transit as a tracked expense category**: metro tickets, bus passes, train fares, ride-shares — all captured as expenses with `category: 'transit'`. Can be split across riders (e.g., a group day pass) or assigned to one person (a solo taxi). Connects to the directions panel: when you plan a transit route between pins, the UI can prompt "Log this as a transit expense?" with the route details pre-filled.

`receipts.ts`:
```ts
receiptImages: id, expenseId (fk), storageKey, mimeType, sizeBytes, uploadedByUserId, createdAt
  // Storage: private bucket, signed-URL access only, 90-day retention after trip end (A16)
```

`line-items.ts`:
```ts
lineItems: id, expenseId (fk), name, quantity (numeric), unitPriceCents, lineTotalCents, sortOrder
lineItemClaims: id, lineItemId (fk), userId (fk), createdAt
  unique (lineItemId, userId)
```

3.2 **Object storage (A5)**
- Extend `@gmacko/storage` with an S3-compatible backend (for ForgeGraph-managed bucket). Do NOT create a parallel `packages/api/src/storage/`.
- In `DEV_MODE=local`: write to `.data/receipts/` (local disk)
- Receipt image ACLs: private bucket, served via signed URLs scoped to trip membership
- Retention policy: raw images deleted 90 days after trip `endDate`; extracted fields permanent (A16)
- `apps/nextjs/src/app/api/receipts/upload/route.ts` — accepts multipart image, stores via `@gmacko/storage`, returns the storage key. Per-user rate limit: 5 uploads/minute (A17 defense against abuse).

3.3 **OCR pipeline (A17, A18, A19)**
- `packages/api/src/ocr/receipt-extractor.ts` — function `extractReceipt(imageBytes: Buffer): Promise<ReceiptExtraction>`:
  - Calls Claude Sonnet 4.6 vision with a prompt-cached system prompt defining the extraction JSON schema (merchant, occurredAt, subtotal, tax, tip, total, **currency**, lineItems[])
  - Validates response with zod. **Reconciliation check (A17)**: reject if `subtotal + tax + tip != total ± $0.02` (defends against prompt injection from adversarial receipt images)
  - **Post-extraction PII strip (A18)**: remove card-digit-like patterns (4-digit groups), loyalty numbers from extracted text
  - **Currency detection (A8)**: if extracted currency is not USD, surface a warning on the draft ("This receipt appears to be in {currency}. Settlement only works within a single currency."). Do NOT silently convert.
  - Confidence score: reconciliation-pass = high; else low
  - Fallback: call fails or confidence < 0.6 → return partially-filled draft
- `packages/api/src/ocr/mock-provider.ts` (A19) — `MockOCRProvider` reading `packages/api/src/ocr/__fixtures__/*.json` keyed by image hash. Active when `OCR_PROVIDER=fixture` (or `DEV_MODE=local`). Live OCR only behind `RUN_LIVE_OCR=1`.
- `packages/api/src/ocr/codex-fallback.ts` — alternative impl using Codex, selectable via `OCR_PROVIDER` env var.
- OCR runtime: run synchronously in a dedicated Node API route with `maxDuration: 60` (not inside tRPC). Return a poll token; client polls for completion. NOT queued via Inngest (no new infra in v1).

3.4 **Expense routers in `packages/api/src/routers/expenses.ts`** (scoped via `tripProcedure`)
- `create` — **server defaults `payerUserId` to `ctx.userId`** (A: no client-supplied payer spoofing). Organizer can override.
- `list` (per trip)
- `get` (by id)
- `updateDraft` — edit OCR-extracted fields before finalizing
- `finalize` — lock the totals and open for claiming. **Refuse if any line items have mixed currencies vs. the trip's settlement currency (A8).**
- `addLineItem`, `updateLineItem`, `removeLineItem`
- `claimLineItem(lineItemId)` — adds `ctx.userId` to `lineItemClaims`; **triggers `@gmacko/realtime` Pusher event on channel `private-expense-${expenseId}` → `line-item:claimed` (A6)**
- `unclaimLineItem(lineItemId)` — same realtime event → `line-item:unclaimed`
- `assignLineItem(lineItemId, userIds[])` — organizer-assigns mode

3.5 **Share calculation**
- `packages/api/src/calc/expense-shares.ts` — pure function `computeShares(expense): Map<userId, cents>`:
  1. For each line item with N claimants, each claimant's subtotal share += `lineTotalCents / N` (integer division; last claimant gets remainder).
  2. `taxShare = round(userSubtotalShare / totalSubtotal * totalTaxCents)`; `tipShare` same. **Rounding residuals go to the payer and are shown in the UI** ("You absorb $0.03 rounding").
  3. Return a map of userId → total cents owed for this expense.
- **Settlement refuses to mix currencies**: all expenses in a settlement must share the same currency (A8).
- **Segment-scoped settlement**: `summary` can be called with an optional `segmentId` filter to compute "what do we owe for Milan?" Only expenses + members belonging to that segment are included. Whole-trip settlement (all segments) is the default.
- Unit tests: single-payer solo, shared (2 people), all-shared, uneven splits, zero-tax zero-tip, rounding edge cases, **rounding-residual-goes-to-payer assertion**, **currency-mismatch rejection**.

3.6 **UI in `packages/ui/src/`** (flat files per template convention)
- `receipt-upload.tsx` + story — drag-drop + camera capture button + upload progress + **OCR-pending skeleton** (progressively reveals merchant → totals → line items)
- `expense-draft-editor.tsx` + story — form for merchant/date/subtotal/tax/tip/total/currency with validation and OCR-confidence banner. **Currency mismatch warning if non-USD (A8)**
- `line-item-row.tsx` + story — row with name, qty, price, claimants (color chips), 44px tap affordance (tap mode) OR assign popover (organizer mode) per CLAIM_SPEC.md
- `expense-card.tsx` + story — summary with merchant, total, payer, your-share
- `claim-mode-switcher.tsx` + story — organizer-only control

Every component gets stories for: Default, Empty, Loading, Error, **OCR-pending** (A27 states matrix).

3.7 **Realtime tap-to-claim (A6)**
- Client subscribes to `private-expense-${expenseId}` via `@gmacko/realtime`'s Pusher client
- On `line-item:claimed` / `unclaimed` events: invalidate the relevant TanStack Query
- **Fallback**: if `integrations.realtime.enabled === false`, poll every 3s while expense detail is foregrounded; pause when `document.visibilityState === 'hidden'`

3.8 **Routes in `apps/nextjs/src/app/trips/[tripId]/`**
- `expenses/page.tsx` — list of expenses + floating "New expense" CTA
- `expenses/new/page.tsx` — upload receipt or start from scratch
- `expenses/[expenseId]/page.tsx` — detail view with editable draft, line items, and claim UI per CLAIM_SPEC.md

### Verification (Phase 3)

- A user can upload a receipt photo, have it OCR-extracted (or fixture-extracted in `DEV_MODE=local`), edit the draft, finalize it, and see line items
- In tap mode: two members on different devices each claim their own items with live Pusher updates; `computeShares` returns the correct cents split
- In organizer mode: the organizer assigns items without other members needing to act
- Tax/tip are prorated correctly; rounding residuals go to the payer and are visible in the UI
- Currency mismatch warning appears for non-USD receipts
- **Multi-user Playwright spec (A20)**: `apps/nextjs/e2e/tap-to-claim.spec.ts` uses `browser.newContext()` for user B, both claim items, asserts realtime sync
- `pnpm -F @gmacko/api test` passes with at least 10 expense/share cases including currency mismatch + rounding

---

## Phase 4 — Settlement

**Goal**: "who owes whom" summary with transaction minimization and a one-tap settle action.

### Tasks

4.1 **Schema additions**
`settlements.ts`:
```ts
settlements: id, tripId (fk), fromUserId (fk), toUserId (fk), amountCents, settledAt, note
```

4.1 **Schema additions**
`settlements.ts`:
```ts
settlements: id, tripId (fk), fromUserId (fk), toUserId (fk), amountCents,
  idempotencyKey (text, unique),  // A10: prevents double-debit race
  settledAt, note, undoneAt (timestamp nullable)  // A29: 24h undo
```

4.2 **Settlement algorithm (A9)**
- `packages/api/src/calc/settle.ts` — `minimizeTransactions(balances: Map<userId, cents>): Transaction[]`:
  - Compute each member's net balance by summing expense shares (from Phase 3) minus amounts they paid.
  - **Deterministic sort**: sort balances by `(amount DESC, userId ASC)` — stable tiebreaker so two tabs render the same suggestions (A9).
  - Run the classic greedy matching: pick largest creditor and largest debtor, create a transaction for the smaller absolute value, repeat.
  - Recorded (non-undone) settlements subtract from live balances before the algorithm runs.
  - **Memoize** result server-side per `(tripId, balances-hash)` so concurrent requests see identical suggestions.
- Unit tests cover 2-person, 3-person, 4-person, pre-existing settlements, **tied-balance determinism**, and **idempotent record**.

4.3 **Routers** (scoped via `tripProcedure`)
- `packages/api/src/routers/settlements.ts`:
  - `summary(tripId)` — returns `{ balances, suggestedTransactions }`
  - `record(fromUserId, toUserId, amountCents, note, idempotencyKey)` — writes a settlement. **Dedupes on `(tripId, fromUserId, toUserId, amountCents, idempotencyKey)` (A10).**
  - `undo(settlementId)` — sets `undoneAt` if within 24 hours (A29). Recalculates balances.

4.4 **UI** (flat files in `packages/ui/src/`)
- `balance-summary.tsx` + story — per-member card with net balance, red/green semantic colors
- `settlement-flow.tsx` + story — list of suggested transactions, each with a "Mark paid" button **+ Venmo deep-link** (`venmo://paycharge?txn=pay&recipients=${venmoHandle}&amount=${dollars}&note=Trip`) if the member has a `venmoHandle` set (A29)
- `settlement-history.tsx` + story — list of recorded settlements with **24h undo** window (A29)
- `all-settled-celebration.tsx` + story — "Everyone's square!" final state with a visual celebration (Design review: the emotional peak deserves more than a table with a button)

4.5 **Route**
- `apps/nextjs/src/app/trips/[tripId]/settle/page.tsx`

### Verification (Phase 4)

- For 4 members and 6 expenses, `minimizeTransactions` returns no more than `N-1` transactions
- **Determinism**: calling `summary` twice with identical balances returns the same transaction list
- Marking a suggested transaction as paid shifts balances; concurrent double-submit of the same `idempotencyKey` produces only one settlement row
- Undo within 24h works; undo after 24h is rejected
- Venmo deep-link renders when member has a `venmoHandle`
- Unit tests pass for all scenarios above

---

## Phase 5 — Map + Itinerary

**Goal**: shared editable area map and Gantt-style timeline with per-activity attendees.

### Tasks

5.1 **Schema**
`pins.ts`:
```ts
pins: id, tripId (fk), segmentId (fk → tripSegments.id, not null),
  type (enum: lodging/activity/meal/transit/drinks/tickets/custom),
  title, lat, lng, startsAt (timestamp nullable), endsAt (timestamp nullable),
  notes, createdByUserId, createdAt, updatedAt, editLockedByUserId (nullable), editLockedUntil (nullable)

pinAttendees: id, pinId (fk), userId (fk)
  unique (pinId, userId)
```

5.2 **Routers** (scoped via `tripProcedure`) — `packages/api/src/routers/pins.ts`: `list`, `create`, `update`, `delete`, `setAttendees`, `acquireEditLock`, `releaseEditLock`.

**Edit lock (A11)**: 15-second lock granted by `acquireEditLock`. Client sends a heartbeat mutation every 10s to renew. `acquireEditLock` checks `editLockedUntil < now()` and steals the lock if stale — no reaper cron needed. `releaseEditLock` checks `editLockedByUserId === ctx.userId`. Best-effort release on `beforeunload` via `navigator.sendBeacon` calling a lightweight release endpoint.

5.3 **Google Maps integration**
- **Google Maps API key**: restrict by HTTP referer in GCP console. Do NOT "sign with the user's session" — that's meaningless since the key goes to the browser. Proxy via `apps/nextjs/src/app/api/maps/config/route.ts` that returns the key only to authenticated sessions (A13).
- `packages/ui/src/area-map.tsx` + story — Google Maps wrapper, renders pins, click-to-add, change events
- `packages/ui/src/pin-marker.tsx` + story — custom marker per pin type
- `packages/ui/src/pin-editor.tsx` + story — side panel (desktop) / bottom sheet (mobile per Palantir-on-Mobile spec) for editing pin (title, time, type, attendees)
- `packages/ui/src/directions-panel.tsx` + story — routing between two selected pins with **public transit as the default mode** (borrowed from tulip's transit integration — the most useful feature for intra-city trips). Shows transit lines, walk segments, departure times, and estimated duration. Driving/walking as secondary modes. **Cache shared per `(tripId, pinAId, pinBId, mode)` with 24h TTL (A12)** — the route is identical for all members.
- `packages/ui/src/transit-routes.tsx` + story — renders transit line polylines on the map between pins (similar to tulip's `TransitRoute` model). Shows line names, colors, and stop counts. Cached per pin pair via Google Maps Directions API transit mode.
- `packages/ui/src/transit-expense-prompt.tsx` + story — when viewing a transit route, prompts "Log as transit expense?" with route details (from → to, estimated cost if available, transit type) pre-filled into the expense form. One tap to create an expense from a planned route.
- `packages/ui/src/segment-switcher.tsx` + story — horizontal pill tabs (e.g., "Milan | Florence | Rome") with date ranges and member count. Hides when there's only one segment. Switching segments recenters the map and filters pins/expenses to that segment.

5.4 **Itinerary timeline**
- `packages/ui/src/itinerary-timeline.tsx` + story — Gantt layout with one row per trip day and overlapping pin bars; borrowed visual ideas from tulip's timeline. **All times rendered in trip-local timezone (A30)**.
- `packages/ui/src/gap-detector.tsx` + story — highlights time windows > 2h with no planned activity during waking hours

5.5 **Routes**
- `apps/nextjs/src/app/trips/[tripId]/map/page.tsx` — split view: map on the left, itinerary timeline on the right
- `apps/nextjs/src/app/trips/[tripId]/itinerary/page.tsx` — full-width timeline

### Verification (Phase 5)

- Users can drop pins on the map, edit them, see them on the timeline, and have attendees show up as colored chips
- Two users editing the same pin: second user's `acquireEditLock` fails while the first holds the lock; after 15s (or explicit release), the second user's edit goes through
- Directions between two pins render transit polylines on the map (line names, colors, walk segments) and a step list in the side panel; public transit is the default mode; cache key is shared per `(tripId, pinA, pinB, mode)`
- Gap detector highlights a 4-hour empty window in a seeded trip
- Times display in the trip's timezone, not the browser's local timezone

---

## Phase 6 — Dashboard Adaptation for Intercity Trips

**Goal**: adapt the existing Palantir-style dashboard for the "we're all in Milan, what are we doing today" use case. The caravan/cross-country command map becomes a neighborhood-level area map showing the Airbnb, restaurants, museums, bars, and **public transit routes between them** (borrowed from tulip's transit integration — the most useful feature for intra-city trips). The activity board pulls from planned pins (museum tickets at 2pm, drinks at 7pm). The meals planner pulls from meal-type pins (lunch here, dinner there). The mission-launch view becomes a trip-kickoff with **the arrivals board** (airport-style real-time status of who's landing when, flight delays, ETAs) and group readiness status. This is the Palantir command-center aesthetic at its best — real data, real-time, dense and useful.

### Tasks

- `apps/nextjs/src/app/trips/[tripId]/page.tsx` branches on `trip.status` AND `trip.groupMode`:
  - `status === 'planning'` → renders the **planning dashboard** (`planning-dashboard.tsx`): active polls, proposal feed, lodging options, room assignments, arrival timeline, ground transport groups. The Palantir aesthetic applied to pre-trip coordination — dense, real-time, status-rich.
  - `status === 'confirmed' | 'active'` + `groupMode === true` → renders the **group command center** built in Phases 2-5: area map, itinerary, expenses, arrivals board, transit routes
  - `status === 'confirmed' | 'active'` + `groupMode === false` → renders the **adapted family dashboard**: `CommandMap` (centered on `trip.destinationLat/Lng` at `trip.defaultZoom`), `InspectorRail` (reading trip pins + members from DB), activity board (from `activity` pins), meals planner (from `meal` pins), mission launch (trip-kickoff with arrivals board + lodging + group status)
  - `status === 'completed'` → renders the **trip recap**: settlement summary, expense totals per category, photo highlights (v1.1), per-segment breakdown
- Wire dashboard components to live DB data via tRPC instead of `localStorage` / fixture data
- Delete the temporary `/demo` route from Phase 0
- Add a visual regression test: Playwright screenshot of the adapted dashboard compared against the Phase 0 baseline `e2e/__screenshots__/demo-baseline.png` (A15)

### Verification (Phase 6)

- A trip in `planning` status shows the planning dashboard (polls, proposals, rooms, transport)
- Transitioning to `confirmed` swaps to the command-center view
- Creating a trip with `groupMode: false` + `confirmed` status shows the adapted family dashboard
- The `CommandMap` is centered on the trip's destination, not cross-country
- Flipping group mode on in settings swaps to the group dashboard without data loss
- Visual regression snapshot is within tolerance of the Phase 0 baseline (layout + density match; content differences are expected)
- The `/demo` route is deleted

---

## Phase 7 — ForgeGraph Deploy (both apps)

**Goal**: `apps/nextjs` deploys to ForgeGraph with Postgres, object storage, and all required secrets. Expo binary distribution is set up for TestFlight.

### Tasks

- Write `forge.yml` declaring: Next.js app, Postgres addon, object storage bucket (S3-compatible), env var manifest
- Wire Gitea Actions CI to build the container, push to Harbor, and trigger a ForgeGraph deploy on push to `main`
- Document the secret rotation procedure for `ANTHROPIC_API_KEY`, `GOOGLE_MAPS_API_KEY`, `BETTER_AUTH_SECRET`, object storage keys, `PUSHER_*` (for realtime)
- Commit to email transport: Resend (already the template's choice per `@gmacko/email`). Configure domain verification and DMARC alignment.
- Stand up a staging environment and run a full smoke test (sign up → create trip → upload receipt → claim items → settle)

### Verification (Phase 7)

- Staging URL is reachable and all smoke-test steps pass
- Rollback via `forge app rollback` works
- Logs stream via `forge app logs`
- Magic link emails are delivered (not just console-logged) on staging

---

## Phase 8 — Expo Mobile App

**Goal**: ship `apps/expo` for on-the-fly receipt capture, line-item claiming, and itinerary review. Shares the tRPC backend with `apps/nextjs`.

### Tasks

8.1 **Planning on mobile**
- Vote on polls (date grid tap, single/multi select, drag-to-rank)
- React to proposals (swipe right = interested, swipe left = pass, tap = details)
- Browse lodging/flight proposals with images
- Push notifications for new polls and proposals (`@gmacko/notifications`)

8.2 **Auth**
- Better Auth's `@better-auth/expo` plugin is already in `@gmacko/auth`. Wire the Expo auth client to use magic link (same `extraPlugins` pattern).
- Secure token storage via `expo-secure-store`.

8.3 **Receipt capture (mobile-optimized)**
- Full-bleed camera view using `expo-camera` for receipt photo
- Upload to the same `@gmacko/storage` endpoint as web
- OCR result appears as a push notification or in-app when ready

8.4 **Line-item claiming**
- Same tRPC endpoints as web
- Realtime updates via `@gmacko/realtime` Pusher client
- 44px touch targets per Palantir-on-Mobile spec
- Pass-the-phone "Claiming as: [me v]" switcher per CLAIM_SPEC.md

8.5 **Itinerary review**
- Read-only list of today's pins with times in trip-local timezone
- Tap a pin to open directions in native Maps app

8.5 **Distribution**
- EAS Build for TestFlight (iOS) and internal distribution (Android)
- OTA updates via `expo-updates` for non-native changes

### Verification (Phase 8)

- Expo app builds for iOS simulator and Android emulator
- Full flow: sign in via magic link → see trips → open a trip → capture receipt → claim items → see settlement
- Realtime claim updates visible between web and mobile simultaneously
- TestFlight build uploaded (iOS)

---

## Risks and Mitigations

| Risk | Phase | Mitigation |
|---|---|---|
| Next.js migration breaks visual parity | 0 | Playwright screenshot baseline at Phase 0; visual regression in Phase 6 (A15) |
| Cross-trip/workspace auth bleed | 2 | tRPC middleware chain enforces authorization; no helper functions (A7, E-1) |
| OCR hallucinates totals | 3 | Reconciliation check ($0.02 tolerance); low confidence forces manual edit; structured output blocks prompt injection (A17) |
| Receipt PII exposure | 3 | Private bucket, signed URLs, strip card digits, 90-day retention (A16, A18) |
| Currency mixing corrupts settlement | 3-4 | Currency stored per expense; settlement refuses mixed currencies (A8) |
| Concurrent pin edits | 5 | 15s edit lock + 10s heartbeat + beforeunload beacon (A11) |
| Google Maps cost | 5 | Shared directions cache per (tripId, pinA, pinB, mode) with 24h TTL; lazy-load Maps JS (A12) |
| Settlement double-debit race | 4 | Idempotency key on `settlements.record` (A10) |
| Non-deterministic settlement suggestions | 4 | Stable tiebreaker `(amount DESC, userId ASC)` + memoize per balances-hash (A9) |
| OCR burns money in dev | 3 | `DEV_MODE=local` → `MockOCRProvider` reading fixture JSON (A19, A23) |
| ForgeGraph deploy surprises | 7 | Phase 7 is its own PR; stage before prod |
| Magic link deliverability | 1 | Dev: console log; prod: Resend with domain verification (confirmed in Phase 7) |
| Expo app store review delays | 8 | Phase 8 is after core web features ship; EAS Build + TestFlight for early testing |
| Flight tracking API cost/reliability | 2 | AviationStack free tier (500 req/mo) for v1; manual fallback for trains; upgrade to paid tier if usage warrants |
| Train tracking has no unified API | 2 | v1: member manually updates status. v1.1: evaluate Trainline API or per-operator scraping |
| Airbnb/VRBO have no public reservation API | 2 | v1: link parsing (listing pages are public) + email paste (Claude extracts confirmation details). No API keys needed. Partner access evaluated for v1.1 |
| Lodging link parsing breaks on page redesign | 2 | Claude vision extraction is more resilient than regex/CSS selectors; degrade gracefully to manual entry if extraction confidence < 0.6 |

## Test Strategy Summary

- **Unit (Vitest)**: share calculator (8+ cases), settlement minimizer (determinism + idempotency), OCR schema validation (+ fixture provider), invite token entropy, workspace/trip auth guards (positive + negative), currency mismatch rejection
- **Integration (Playwright)**: full trip lifecycle (`apps/nextjs/e2e/group-trip-lifecycle.spec.ts`): create workspace → create trip → invite → accept → upload receipt → claim → settle
- **Multi-user (Playwright)**: tap-to-claim with two browser contexts (`apps/nextjs/e2e/tap-to-claim.spec.ts`) (A20)
- **Component**: every shared component has Storybook stories with 5 states (Default, Empty, Loading, Error, domain-specific); `@storybook/test-runner` in CI
- **Visual regression**: Phase 0 baseline screenshot; Phase 6 comparison
- **Claude API mocking**: `MockOCRProvider` in unit/integration tests; live OCR behind `RUN_LIVE_OCR=1` (A19)
- **Magic link automation**: Playwright spec intercepts dev console log or hits `/api/dev/last-magic-link` (dev-only) for headless sign-in

## Resolved by Template Inspection

Closed out by direct file reads of `../create-gmacko-app`:

- **Package manager**: pnpm 10.32.1
- **Node**: 24
- **ORM**: Drizzle 0.45 + postgres.js 3.4 + drizzle-zod, functional `pgTable` style
- **Auth**: Better Auth via `@gmacko/auth` `initAuth()` factory; currently wired for Discord OAuth + Expo + oAuthProxy. Magic link is NOT enabled and is added via `extraPlugins` in `apps/nextjs/src/auth/server.ts`.
- **Lint/format**: Biome + oxlint + lefthook pre-commit
- **Next.js**: 16.2.1, React 19
- **Forms**: TanStack Form (`@tanstack/react-form`)
- **Data fetching**: TanStack Query + tRPC (`@trpc/tanstack-react-query`); `@gmacko/api` holds tRPC routers
- **UI package**: `@gmacko/ui` uses flat files, co-located stories, shadcn via `ui-add`, Radix primitives, sonner for toasts, class-variance-authority for variants
- **Storybook**: lives in `apps/nextjs`, ports 6006, uses `@storybook/nextjs-vite` + addon-a11y + addon-docs. Convention: plain object `meta`, `title: "UI/<Name>"`, named-export variants, no typed `Meta<>` imports.
- **Tailwind config**: workspace package `@gmacko/tailwind-config`
- **E2E**: Playwright in `apps/nextjs/e2e/`, scripts `pnpm -F @gmacko/nextjs e2e|e2e:ui|e2e:headed`
- **Unit tests**: Vitest visible in `packages/db` (`vitest.config.ts`)
- **Monitoring**: Sentry pre-configured (client, server, edge configs)
- **i18n**: next-intl
- **Env**: `@t3-oss/env-nextjs`
- **Deploy**: Forge CLI (`pnpm forge:deploy:staging|production`), pre-wired
- **Storage package**: `@gmacko/storage` exists
- **Email package**: `@gmacko/email` exists; `@gmacko/notifications` exists separately — confirm which one handles transactional in Phase 1 investigation
- **Realtime package**: `@gmacko/realtime` exists — candidate for Phase 3 tap-to-claim live updates
- **Multi-tenant model**: template already ships a Workspace concept with roles and billing — forces the Trip vs. Workspace decision (see Architectural Decision above)

## Resolved by /autoplan Review

These were open questions, now closed:

1. **Trip vs. Workspace**: **Option B confirmed** by user. Workspace = long-lived group, Trip = child. Guards via tRPC middleware chain (E-1). Auto-create personal workspace on first sign-in.
2. **Realtime for tap-to-claim**: **Use `@gmacko/realtime` (Pusher) from day one** (A6). 3s polling as fallback when realtime disabled.
3. **Email provider**: **Resend** (already the template's choice). Domain verification in Phase 7. Dev console log in Phase 1.
4. **Edit lock duration**: **15s + 10s heartbeat** (A11). Not 30s static.
5. **Apps scope**: **Both Next.js AND Expo ship in v1**. Confirmed by user. Next.js = dashboard. Expo = mobile capture + claiming. Phase 8 added.
6. **Template sync**: **Track upstream SHA** in `docs/ai/TEMPLATE_SNAPSHOT.md` (A22). Documented in Phase 0.9.
7. **Auth guard pattern**: **tRPC middleware chain, not helper functions** (A7). Non-negotiable.
8. **Currency handling**: **Store per expense, refuse mixing in settlement** (A8).
9. **Settlement determinism**: **Stable sort + memoize** (A9). Idempotency key on record (A10).

## Remaining Open Questions

1. **Discord OAuth env vars**: keep behind unused env vars for v1 or disable? Lean: keep, revisit if confusing.
2. **OCR confidence threshold**: 0.6 is a guess — tune with real receipts in Phase 3.
3. **Sentry in dev**: confirm it's gated off to avoid noise during Phase 0.
4. **`@gmacko/email` vs. `@gmacko/notifications`**: Phase 1 investigation decides which delivers magic-link emails.
5. **`apps/tanstack-start`**: not used in v1. Delete or leave? Lean: leave alone.

## Next Step

Implementation begins with Phase 0. Run `pnpm -F @gmacko/nextjs storybook` after porting to confirm visual parity before proceeding to Phase 1.
