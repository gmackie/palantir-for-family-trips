# Expo Development

Use development builds as the default mobile workflow for this app.

## Recommended Setup

1. Install Expo Orbit for simulator and device management.
2. Build a development client with `pnpm --filter @sortey/expo build:device:ios` or `pnpm --filter @sortey/expo build:device:android`.
3. Start the app with `pnpm --filter @sortey/expo dev:client`.

Expo Go is useful for quick checks, but the long-term default for product work should be a development build.

## Preflight Proofs

Use Preflight for the repeatable mobile smoke proof:

```bash
/Volumes/dev/preflight/preflight prove-app --app-dir apps/expo --platform ios --lane simulator --wait-for-runner
/Volumes/dev/preflight/preflight prove-app --app-dir apps/expo --platform android --lane simulator --wait-for-runner

## OTA (EAS Update) + Preflight

Planner / day-plan / amenity UI ships as **JS OTA** to existing binaries
(`runtimeVersion` `0.1.0`). Full checklist: [`docs/ai/MOBILE_OTA_PREFLIGHT.md`](../../docs/ai/MOBILE_OTA_PREFLIGHT.md).

```bash
# From apps/expo
pnpm update:preview "feat: day plan + amenities"
pnpm update:production "feat: day plan + amenities"
pnpm preflight:local   # readiness without runners
pnpm preflight:ios     # prove-app on simulator farm
```

In-app: Settings → **App updates** → Check for update.
```

Android local builds require Java 17 plus the Android SDK:

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=$HOME/Library/Android/sdk
export ANDROID_SDK_ROOT=$ANDROID_HOME
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
```

Physical-device proofs require the device to be visible to the host first:

```bash
adb devices -l
xcrun xctrace list devices
```

If an iPhone or iPad appears offline, unlock it, trust the Mac, and rerun the target discovery before starting a development-lane proof.

## Release Readiness

- Set `EXPO_PUBLIC_APP_DOMAIN` before you configure associated domains and deep-link verification.
- Replace the scaffold bundle identifier values in `app.config.ts` before store submission.
- Configure Sign in with Apple credentials before shipping iOS builds with social login.
- Verify the in-app account deletion flow on a real device before App Store submission.
- Keep staging and production API URLs explicit so the dev client, beta builds, and store builds do not drift.
- Run `pnpm --filter @sortey/expo check:app-store` and clear every placeholder before a release candidate.
- Work through the [mobile QA checklist](./docs/mobile-qa.md) before shipping a release candidate.
