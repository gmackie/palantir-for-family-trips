# Porting an app from PostHog to Dataflare

Reference migration: CREA-15 (create-gmacko-app). The template's
`@sortey/analytics` now runs product analytics **and** feature flags on
Dataflare (observe.gmac.io, or the app's own). PostHog is gone: no
`posthog-js` / `posthog-react-native` / `posthog-node`, no provider, no
`*POSTHOG*` env vars, no `*.posthog.com` CSP host and no `integrations.posthog`.

Apps generated before CREA-13 have the PostHog-only package, so port the
whole set below, not only the files CREA-15 changed. Paths are relative to the
app root. **Copy** means take the file from create-gmacko-app `main`
unchanged, then rename `@sortey/` to the app's scope. **Change** means edit
the app's own file as described.

## 1. The package (`packages/analytics`): copy all of it

| File | What it is |
| --- | --- |
| `packages/analytics/package.json` | deps: `@sortey/config`, `dataflare-web` (0.8.4). No PostHog, no `expo-constants`. Exports `.`, `./events`, `./facade`, `./flags`, `./web`, `./native` |
| `packages/analytics/src/index.ts` | barrel |
| `packages/analytics/src/events.ts` | the typed event catalog (`ClientEvents`, `ServerEvent`, PII-safe types). **Add your app's event names here** (see 6) |
| `packages/analytics/src/facade.ts` | `createAnalytics`: one path to every sink, PII scrub, `captureEvent` |
| `packages/analytics/src/flags.ts` | `/f` client + value mapping (`"on"` → `true`, variant → string, off/holdout → default) |
| `packages/analytics/src/properties.ts` | value types (`AnalyticsProperties`, `FeatureFlagValue`, ...) |
| `packages/analytics/src/web/index.tsx` | browser API (below) |
| `packages/analytics/src/web/dataflare.ts` | `dataflare-web` SDK wiring, kill switch, persistence |
| `packages/analytics/src/native/index.tsx` | native API over the app's `dataflare-native.ts` |
| `packages/analytics/src/__tests__/*.test.ts` | keep them; they are the contract |

Then `pnpm install` so `posthog-*` drop out of `pnpm-lock.yaml`, and remove
`posthog-js` from the `catalog:` in `pnpm-workspace.yaml`.

### API, old → new

Same names where they existed; only the PostHog-specific ones are gone.

| Before (PostHog) | After (Dataflare) |
| --- | --- |
| `PostHogProvider`, `initPostHogWeb`, `posthog`, `cspSafeDefaults`, `cspNonceScriptHook`, `isPostHogEnabled` | removed. `initAnalytics()` in `apps/web/src/client.tsx` (via `~/lib/analytics`) starts the SDK; no React provider is needed |
| `trackEvent(name, props)` with any name | `trackEvent` is typed against the catalog. For names you have not catalogued yet use `captureEvent(name, props)` (same scrubbing), then move them into `events.ts` |
| `identifyUser(id, props)` / `resetUser()` | same (props are person properties, scrubbed of PII); prefer `syncUser(id \| null)` from the session |
| `isFeatureEnabled(key, default)`, `getFeatureFlag(key, default)`, `onFeatureFlags(cb)`, `reloadFeatureFlags()` | same names, Dataflare `/f`. `onFeatureFlags` now returns an unsubscribe function |
| `useFeatureFlagEnabled` / `useFeatureFlagVariantKey` (posthog-js/react) | `useFeatureFlagEnabled(key)` / `useFeatureFlag(key)` from `@sortey/analytics/web` |
| `getFeatureFlagPayload(key)` | still exported; returns `undefined` until `dataflare-web` 0.9 is published (payloads gap) |
| `getExperiment`, `trackExperimentExposure` | same; Dataflare records `$exposure` when the variant is read |
| `PostHogNativeProvider`, `initPostHogNative`, `posthogClient`, `isPostHogNativeEnabled` | removed. `initDataflareNative({ client, host, project, enabled })` once in `apps/expo/src/lib/analytics.ts` |
| `trackEventNative`, `identifyUserNative`, `resetUserNative`, `isFeatureEnabledNative`, `getFeatureFlagNative`, `getFeatureFlagPayloadNative`, `reloadFeatureFlagsNative`, `getExperimentNative`, `trackExperimentExposureNative` | same names and signatures, on Dataflare (`onFeatureFlagsNative` is new) |

## 2. Config: change

- `packages/config/src/integrations.ts`: delete the `posthog` key and
  `isPostHogEnabled`; make sure `dataflare: true` and `isDataflareEnabled` exist
  (copy them from the template).
- `packages/config/src/__tests__/integrations.test.ts`: copy.
- `gmacko.integrations.json`: replace `"posthog": true` with `"dataflare": true`.

## 3. Web app (`apps/web`)

| File | Action |
| --- | --- |
| `src/lib/analytics.ts` | **copy**: the one door (`initAnalytics`, `trackEvent`, `captureEvent`, `identifyUser`, `resetUser`, `syncUser`, `isFeatureEnabled`, `getFeatureFlag`, `useFeatureFlag`, `setAnalyticsConsent`). Import analytics only from here |
| `src/client.tsx` | **change**: `import { initAnalytics } from "~/lib/analytics";` and call `initAnalytics();` before `hydrateRoot` |
| `src/providers.tsx` | **change**: delete `PostHogProvider` and its `VITE_POSTHOG_*` reads; keep or add `AnalyticsIdentity` (calls `syncUser` with the session user id) |
| `src/env.ts` | **change**: delete `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST`; add `VITE_DATAFLARE_HOST`, `VITE_DATAFLARE_PROJECT` (optional strings), `VITE_DATAFLARE` (`"on" \| "off"`, default `"on"`, the kill switch), `VITE_DATAFLARE_PERSISTENCE` (`"cookieless" \| "localStorage"`, default `"cookieless"`) |
| `src/server/config.ts` | **change**: drop `posthogHost` and the `https://us.i.posthog.com` fallback from `connectSrc`; keep `originOf(client.dataflareHost)` |
| `src/server/runtime.ts` | **change**: drop `posthogHost: clientEnv.VITE_POSTHOG_HOST` |
| `src/server/headers.ts` | **change**: nothing functional; `script-src` stays `'self' 'nonce-…'` (the SDK is bundled, see 7) |
| `src/server/__tests__/headers.test.ts` | **copy** (asserts no PostHog origin) |
| `src/server/dataflare/{capture,proxy}.ts`, `src/server/worker.ts`, `src/server/bindings.d.ts` | **copy** if you want server events (`user_signed_up`, `subscription_activated`) or the same-origin `/_glass` proxy; optional |
| `README.md` env table | update the Dataflare row, remove the PostHog row |

Call sites: `posthog.capture(...)` → `trackEvent`/`captureEvent`;
`posthog.identify(user.id)` → `identifyUser(user.id)` (opaque id only, never an
email); `posthog.reset()` → `resetUser()`; `posthog.isFeatureEnabled(k)` →
`isFeatureEnabled(k)`; `useFeatureFlagEnabled(k)` from `posthog-js/react` →
`useFeatureFlagEnabled(k)` from `~/lib/analytics`'s package.

## 4. Expo app (`apps/expo`)

| File | Action |
| --- | --- |
| `src/lib/dataflare-native.ts` | **copy** unchanged from glass-analytics `packages/native/src/dataflare-native.ts` (DATFLR-14), if the app does not have it |
| `src/lib/analytics-core.ts`, `src/lib/analytics-core.test.ts` | **copy** |
| `src/lib/analytics.ts` | **copy**: builds the client, calls `initDataflareNative`, exports `analytics` |
| `src/components/analytics-tracker.tsx` + its use in `src/app/_layout.tsx` | **copy** if missing (screen views, flush on background) |
| `src/providers.tsx` | **change**: delete the `PostHogNativeProvider` import and wrapper (the `analytics.posthog-native.*` marker regions) |
| `src/config/env.ts` | **change**: delete `posthogKey`/`posthogHost` and `getPosthogKeyForEnvironment`; `getDataflareEnv()` returns `{ project, host, killSwitch }` from `EXPO_PUBLIC_DATAFLARE_PROJECT`, `EXPO_PUBLIC_DATAFLARE_HOST`, `EXPO_PUBLIC_DATAFLARE` |
| `src/config/env-validation.ts`, `src/config/env.test.ts` | **copy** (no PostHog key requirement) |
| `app.config.ts` | **change**: delete `POSTHOG_KEY`/`POSTHOG_HOST` and their `extra` entries |
| `preflight/build-profiles.json` | **change**: delete `POSTHOG_KEY`/`POSTHOG_HOST`; set `EXPO_PUBLIC_DATAFLARE_PROJECT` to the app's observe project id in each lane |
| `scripts/check-observability.mjs` | **copy** (no PostHog gate) |
| `package.json` | **change**: remove `posthog-react-native` if listed directly |

The template ships `EXPO_PUBLIC_DATAFLARE_PROJECT: ""`, so its Expo app
reports nothing. An app turns mobile analytics on by setting its own project id.

## 5. Repo files: change

- `.env.example`: delete the PostHog blocks; copy the template's Dataflare
  blocks (web + mobile).
- `turbo.json` `globalEnv`: drop `VITE_POSTHOG_*`; add `VITE_DATAFLARE`,
  `VITE_DATAFLARE_PERSISTENCE` (keep `VITE_DATAFLARE_HOST`/`_PROJECT`).
- CI workflows (`.forgejo/workflows/*.yml`): drop `*POSTHOG*` env and
  `vars.PREVIEW_POSTHOG_KEY`.
- `scripts/provision.sh`, `scripts/doctor.sh`, docs (`AGENTS.md`, `README.md`,
  `docs/RUNBOOK.md`, ...): replace PostHog with Dataflare.
- `rg -i posthog` must come back empty apart from historical notes.

## 6. Events and flags

- Events: keep the same snake_case names and non-identifying props. Add them
  to `ClientEvents` (`packages/analytics/src/events.ts`) and call `trackEvent`;
  `captureEvent` is the stopgap.
- Flags: before switching code, create each flag the app uses in its observe
  project with the same key and default (`POST /api/flags` with the admin key,
  or `npx dataflare-cli flags set <key> --rollout <n>`). PostHog targeting that
  Dataflare cannot express: keep the default and record the gap on the issue.
- Web flags need a device id: `/f` returns nothing for a cookieless visitor.
  An app that reads flags sets `VITE_DATAFLARE_PERSISTENCE=localStorage`
  (PostHog already stored an id, so this keeps the old behaviour) or calls
  `setAnalyticsConsent(true)` after consent. Student/children's apps stay
  cookieless (flags read defaults) and do not identify.

## 7. Why the bundled SDK and not the journey loader

The web app serves `script-src 'self' 'nonce-…'`. `dataflare-web` is part of
the app's own bundle, so the policy needs no extra `script-src`, and its
requests use `connect-src` (nothing extra through the `/_glass` proxy, else the
collector origin from `VITE_DATAFLARE_HOST`). The loader (`/dataflare.js`)
injects the collector's `/s.js` at runtime, which that policy blocks unless the
nonce is threaded through or the origin is allowed. The SDK is also typed and
exposes flags. Apps without a nonce CSP that already load `/dataflare.js` can
keep it for page views, but should still route events and flags through
`@sortey/analytics` so the API stays the same.

## 8. Not ported

Session replay and surveys stay off unless the owner asks. Flag payloads read
`undefined` until `dataflare-web` 0.9 is published.
