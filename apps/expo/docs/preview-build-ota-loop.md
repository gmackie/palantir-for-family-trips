# Preview build + OTA loop

Goal: one native binary per lane, then ship JS/UI as **EAS Update** in minutes.

## Profiles

| Profile | Channel | Device | Dev client? | API | Use |
| --- | --- | --- | --- | --- | --- |
| `preview-simulator` | `preview` | Simulator | no | `https://sortey.app` | Local preflight / sim QA |
| `preview-device` | `preview` | Physical | no | `https://sortey.app` | Internal device dogfood |
| `preview` | `preview` | Physical (EAS cloud) | no | `https://sortey.app` | Shared internal builds |
| `trip-device` | `development` | Physical | no | `https://sortey.app` | Trip dogfood on dev channel |
| `development` | `development` | Simulator | **yes** | prod | Metro-driven coding |

OTA only applies to **non–dev-client** release-style binaries (`developmentClient: false`). Metro/dev clients load from Metro in `__DEV__` and skip OTA.

## First-time local preview binary (preflight-ready)

```bash
cd apps/expo

# 1) Readiness (no runners)
pnpm preflight:local

# 2) Local simulator binary with preview channel baked in
pnpm build:preview:sim:local

# 3) Install the .app / tar from the EAS local output onto a booted sim
#    (eas prints the path when finished)

# 4) Optional: Preflight prove-app (smoke Maestro)
pnpm preflight:preview:sim
```

Physical device (local):

```bash
pnpm build:preview:device:local
# or cloud:
pnpm build:preview:device
```

## Everyday fast path (JS only)

After the native binary is installed:

```bash
cd apps/expo

# Preview lane (Sortey Preview app)
pnpm update:preview -- --message "feat: active trip command center"

# Dev-channel trip-device binaries
pnpm update:development -- --message "feat: active trip command center"
```

On device:

1. Foreground the app (auto-check on load / resume), **or**
2. Settings → **App updates** → **Check for update** → **Restart**

## When you need a new binary

Fingerprint `runtimeVersion` changes when native inputs change (new native module,
config plugin, entitlements, bundle id, etc.). Then:

1. Rebuild the lane (`build:preview:sim:local` / device / EAS cloud)
2. Install
3. Resume OTA-only publishes

Compare mismatch:

```bash
npx eas-cli@20.5.1 fingerprint:compare \
  --build-id BUILD_ID --update-id UPDATE_ID --environment preview --json
```

## Preflight vs OTA

| Tool | Job |
| --- | --- |
| **Preflight** | Prove the **binary** launches / Maestro smoke on sim or device |
| **EAS Update** | Ship **JS/assets** to that binary without rebuilding |

Use Preflight when native or install path changes; use OTA for product UI and API
client work once the binary is good.

## Checklist for this branch (active trip)

- [ ] `pnpm preflight:local` green
- [ ] Local `preview-simulator` or `preview-device` binary installed
- [ ] `pnpm update:preview -- --message "…"` published
- [ ] Settings shows channel `preview` + new update id
- [ ] Cold start → active trip / Today · Drive · fuel map
