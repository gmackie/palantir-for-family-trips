# driftport Van-Telemetry Spike — Driving Mode

**Date:** 2026-06-21
**Status:** Approved (scope: mock now + real provider wired; provisioning is a human runbook)
**Goal:** Overlay live van-system telemetry (battery / solar / climate / water) from driftport onto Sortey's mobile Driving Mode, abstracted so it ships flag-gated with a mock today and flips to the real driftport call once a service-account key is provisioned.

## Verified integration facts (do not re-derive)

- driftport exposes `system.dashboard` (a `rigProcedure` query) returning an array of `{ rigId, deviceId, system, metric, value, unit, readAt }` — `/Volumes/dev/driftport/packages/api/src/router/system.ts`.
- driftport's tRPC accepts `Authorization: Bearer gmk_<key>` (`/Volumes/dev/driftport/packages/api/src/trpc.ts`). The key binds to a driftport **user**; that user must have an active `rigMembership` for the rig. → A Sortey **service-account user** in driftport with `rigMembership` is sufficient; **no driftport code change needed.**
- **Separate Postgres databases** — no cross-DB query. Integration is a service-token HTTP call.
- Sortey deploys to Cloudflare Workers (`apps/nextjs/wrangler.jsonc`), same as driftport.

## Architecture

Abstract behind an interface; select provider at runtime.

```
packages/api/src/van-telemetry/
  types.ts        // VanSystemReading { system, metric, value, unit, readAt }
  provider.ts     // interface VanTelemetryProvider { getSnapshot(rigId): Promise<VanSystemReading[]> }
  mock.ts         // MockTelemetryProvider — sample battery/solar/climate/water
  driftport.ts    // DriftportTelemetryProvider — HTTP → driftport tRPC, Bearer gmk_ key
  resolve.ts      // pick provider: real if (flag on && DRIFTPORT_API_KEY set) else mock
```

`packages/api/src/router/van-telemetry.ts`:
- `getSnapshot` (`tripProcedure`): gate on `isEnabled("driftportTelemetryPreview", { userId })`; resolve the trip's vanProfile and its `driftportRigId`; if the flag is off or no rig is linked, return `null` (card hides). Else `provider.getSnapshot(rigId)`.
- Mount `vanTelemetry` in `packages/api/src/root.ts`.

## Tasks (TDD, one commit each)

1. **Schema:** add `driftportRigId uuid` (nullable) to `vanProfiles` (`packages/db/src/schema.ts`); generate migration. Commit `feat(db): vanProfiles.driftportRigId for driftport link`.
2. **Flag:** add `driftportTelemetryPreview` to `packages/flags/src/flags.ts` (default off; dev/staging on, prod off). Commit `feat(flags): driftportTelemetryPreview`.
3. **Provider layer:** `types.ts`, `provider.ts`, `mock.ts`, `resolve.ts` + unit tests (mock returns sample; resolve picks mock when no key). Commit `feat(api): van-telemetry provider interface + mock`.
4. **Real provider:** `driftport.ts` — reads `env.DRIFTPORT_API_URL` + `env.DRIFTPORT_API_KEY`; POSTs driftport's `system.dashboard` over its tRPC HTTP transport (verify the exact endpoint path + input encoding by reading driftport's tRPC handler/route, e.g. `/api/trpc/system.dashboard`); maps response → `VanSystemReading[]`; fail-safe (throws → router catches → returns null, never crashes Driving Mode). Unit-test against a mocked `fetch`. Add `DRIFTPORT_API_URL`/`DRIFTPORT_API_KEY` (optional) to `apps/nextjs/src/env.ts` + `scripts/doctor.sh` (warn-only). Commit `feat(api): driftport telemetry provider (HTTP, service-token)`.
5. **Router:** `van-telemetry.ts` + mount + tests (flag-off → null; rig-linked + mock → readings). Commit `feat(api): vanTelemetry.getSnapshot (flag-gated)`.
6. **Mobile card:** flag-gated "Van Status" card in `apps/expo/src/app/trip/[tripId]/drive.tsx` — battery SOC (mono, semantic color by level), water %, inside temp; hides when `getSnapshot` returns null. Commit `feat(mobile): van status card in Driving Mode`.
7. **Provisioning runbook** (`docs/driftport-integration.md`): exact steps for the human — create the driftport service-account user, add `rigMembership` (installer) for the rig, mint a `gmk_` key via driftport `settings.createApiKey`, `forge secret set DRIFTPORT_API_URL` + `DRIFTPORT_API_KEY`, link `vanProfile.driftportRigId`, flip the flag. Commit `docs: driftport telemetry provisioning runbook`.

## Out of scope (this spike)
- Web dashboard surface (mobile Driving Mode only).
- Remote control / commands (read-only telemetry).
- Realtime/SSE (single snapshot query; the screen's existing poll cadence refreshes it).
- Permission federation beyond the single service-account key.

## The one human decision / handoff
Minting the driftport `gmk_` key and storing it as a Sortey secret are credential actions for the human (runbook in task 7). Until then the provider stays on mock; the flag stays off in prod. The real path is a drop-in with zero further code change once secrets exist.
