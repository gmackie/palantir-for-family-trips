# Preview build + OTA loop

Goal: **one local native binary**, then ship JS/UI via **Preflight-hosted OTA**
in minutes (no App Store / EAS cloud rebuild).

Design: `preflight-app/docs/plans/2026-07-14-preflight-native-ota.md`.

## Two OTA paths

| Path | When | Runtime id | Publish |
| --- | --- | --- | --- |
| **Preflight OTA (preferred)** | Local / Fastlane / runner binaries | fixed `sortey-p0` | `pnpm ota:publish:preview` |
| **EAS Update (legacy)** | Existing EAS cloud fingerprints | fingerprint hash | `pnpm update:preview` |

Preview EAS profiles bake `PREFLIGHT_OTA_URL` + `PREFLIGHT_OTA_RUNTIME_VERSION=sortey-p0`
so local binaries talk to the local OTA server on `:3099`.

## Profiles

| Profile | Channel | Device | Dev client? | OTA | Use |
| --- | --- | --- | --- | --- | --- |
| `preview-simulator` | `preview` | Simulator | no | Preflight `sortey-p0` | Local preflight / sim QA |
| `preview-device` | `preview` | Physical | no | Preflight `sortey-p0` | Internal device dogfood |
| `preview` | `preview` | Physical | no | Preflight `sortey-p0` | Shared internal builds |
| `trip-device` | `development` | Physical | no | EAS fingerprint | Older trip dogfood |
| `development` | `development` | Simulator | **yes** | Metro | Coding with Metro |

OTA only applies to **non–dev-client** release-style binaries. Metro/`__DEV__` skips OTA.

## First-time local preview binary

```bash
# 0) OTA server (already often running on :3099)
cd /Volumes/dev/preflight-app
PREFLIGHT_OTA_STORE=/Volumes/PreflightBuild/ota-store \
  PREFLIGHT_OTA_PORT=3099 \
  node --experimental-strip-types packages/ota/scripts/ota-server.mjs

# 1) Readiness
cd /Volumes/dev/sortey/apps/expo
pnpm preflight:local

# 2) Local simulator binary (channel preview + Preflight OTA URL baked in)
pnpm build:preview:sim:local

# 3) Install the .app / tar from the EAS local output onto a booted sim
#    (eas prints the path when finished)

# 4) Optional: Preflight prove-app smoke
pnpm preflight:preview:sim
```

Physical device (local):

```bash
pnpm build:preview:device:local
```

## Everyday fast path (JS only — Preflight OTA)

```bash
cd apps/expo

# Export + publish into /Volumes/PreflightBuild/ota-store
pnpm ota:publish:preview -- --message "feat: active trip command center"

# Or development channel:
pnpm ota:publish:development -- --message "…"
```

On device / sim:

1. Foreground the app (auto-check on load / resume), **or**
2. Settings → **App updates** → **Check for update** → **Restart**

Health: `curl -s http://127.0.0.1:3099/api/preflight/v1/ota/health | jq`

## Legacy EAS Update (existing cloud binaries only)

```bash
pnpm update:preview -- --message "…"
pnpm update:development -- --message "…"
```

Only reaches binaries whose **fingerprint** matches the published runtime.
If fingerprints diverge, rebuild once with the Preflight OTA path above.

## Preflight vs OTA

| Tool | Job |
| --- | --- |
| **Preflight prove-app** | Prove the **binary** launches / Maestro smoke |
| **Preflight OTA** | Ship **JS/assets** to that binary without rebuilding |
| **EAS Update** | Fallback for older EAS cloud fingerprints |

## Checklist (active trip)

- [x] `pnpm preflight:local` green
- [ ] Local `preview-simulator` binary installed (`runtimeVersion` `sortey-p0`)
- [ ] OTA server healthy on `:3099`
- [ ] `pnpm ota:publish:preview -- --message "feat: active trip…"` published
- [ ] Settings → update id advances after Check for update
- [ ] Cold start → active trip / Today · Drive · fuel map
