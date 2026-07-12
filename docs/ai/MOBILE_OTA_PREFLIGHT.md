# Mobile OTA + Preflight — ship planner JS to devices

The multi-day planner, amenity scan, and iOverlander overnight tools are
**JS-only**. They ship via **EAS Update (OTA)** to existing native builds that
share the same **fingerprint** `runtimeVersion`. Backend tRPC procedures must
already be live on the API the app hits (`API_URL`).

## Ship status (2026-07-12)

| Layer | Status | Notes |
|---|---|---|
| API (`planner.*`) on `https://sortey.app` | **Live** | Unauth probes return `UNAUTHORIZED` / `METHOD_NOT_SUPPORTED` (procedure exists; not `NOT_FOUND`) |
| Web day-plan / amenity UI | **Live** | Cloudflare Worker deploy includes `DayPlanPanel` + amenity panels |
| OTA `production` | **Published** | iOS runtime `ec0c045b…`, Android `cdbe993b…` |
| OTA `preview` | **Published** | iOS `ec0c045b…` · Android `cdbe993b…` |
| OTA `development` | **Published** | iOS `82c0fc5d…` · Android `4f843e25…` (dev client fingerprint) |
| DB `trip_day` / anchors | **Applied** | Migration `0010_trip_day_planner.sql` |

Update message on all channels:

`feat: day plan, amenities, iOverlander overnight, OTA check`

### On-device pull

1. Open a build whose **channel** matches (`production` / `preview` / `development`).
2. Binary **fingerprint** must match the published runtime (Settings → App updates shows channel + update id after load).
3. Foreground the app, or Settings → **Check for update** → **Restart**.
4. Smoke: Road trip → **Day plan** · Drive amenities · Map plan markers.

**Older binaries** built with fixed `runtimeVersion: "0.1.0"` will **not** receive these fingerprinted updates — rebuild with the fingerprint policy first.

## Prerequisites

1. **API deployed** to the environment the build uses:
   - production channel → `https://sortey.app` (or configured `API_URL`)
   - preview channel → staging API if configured
2. Native binary already installed with:
   - `runtimeVersion: { policy: "fingerprint" }` (see `apps/expo/app.config.ts`)
   - matching EAS **channel** (`development` | `preview` | `production`)
3. Logged into EAS: `eas whoami` (account that owns project `5f21337f-9f48-4b0c-8d02-656e4a08dc86`)

## Publish an OTA update

From `apps/expo` (prefer direct `eas update` so `--message` is not swallowed by pnpm):

```bash
cd apps/expo

eas update --channel preview --environment preview \
  --message "feat: day plan + amenities" --non-interactive

eas update --channel production --environment production \
  --message "feat: day plan + amenities" --non-interactive

eas update --channel development --environment development \
  --message "feat: day plan + amenities" --non-interactive
```

Package scripts (`pnpm update:preview` etc.) map to the same channels; pass message via:

```bash
pnpm update:preview -- --message "your message" --non-interactive
```

(If extra args fail, use the `eas update` form above.)

### What clients do

- On load / foreground, the app calls `Updates.checkForUpdateAsync` (preview + production; see `use-ota-updates`).
- User is prompted to **Restart** when a new bundle is ready.
- Settings → **App updates** → **Check for update** for a manual pass.

## Preflight verification

Local readiness (no API / no runner):

```bash
cd apps/expo
pnpm preflight:local
```

Full iOS simulator proof (build farm + Maestro):

```bash
cd apps/expo
pnpm preflight:ios
# or:
/Volumes/dev/preflight/preflight prove-app \
  --app-dir . \
  --platform ios \
  --lane simulator \
  --wait-for-runner
```

Maestro flows in `.maestro/`:

| Flow | Purpose |
|---|---|
| `01-app-launches.yaml` | Smoke launch (default preflight proof) |
| `02-road-trip-day-plan.yaml` | Best-effort open Day plan after login |

Run locally after a dev client is running:

```bash
pnpm e2e
# or single flow
maestro test .maestro/02-road-trip-day-plan.yaml
```

Demo auth for automated / farm sessions uses magic-link bypass for
`*@demo.preflight.app` (see `@sortey/auth` demo domain).

## Feature checklist on device (after OTA)

- [ ] Settings → App updates → channel / update id visible  
- [ ] Road trip → **Day plan**  
- [ ] Build full map plan (or replan from GPS)  
- [ ] Auto-assign iOverlander sleep (needs CSV imported — usually via web)  
- [ ] Amenity scan list / warnings  
- [ ] Drive → **Today's plan** + sleep/fuel/dump/toll  
- [ ] Map → plan markers + amenity filters; callout opens day editor  

## Important constraints

| Layer | How it ships |
|---|---|
| Planner UI + amenities UI | **OTA** (`eas update`) |
| New tRPC procedures | **API deploy** (Forge / Workers) — not OTA |
| New native modules | **New EAS build** + store/TestFlight — not OTA |
| iOverlander CSV import | Web upload today (`PoiUpload`); mobile consumes workspace-scoped POIs |

If OTA clients get “procedure not found”, deploy the API first, then re-check.

## Config reference

- Project ID: `5f21337f-9f48-4b0c-8d02-656e4a08dc86`  
- Updates URL: `https://u.expo.dev/5f21337f-9f48-4b0c-8d02-656e4a08dc86`  
- `runtimeVersion`: fingerprint policy (must match binary)  
- Channels: `development` · `preview` · `production` (see `eas.json`)  
- Detail: `apps/expo/docs/ota-updates.md`
