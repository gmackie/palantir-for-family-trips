# Launch Readiness

**Last assessed:** 2026-07-13

Private dogfood is live. App Store push is in flight.

## Live

- Web/API healthy at https://sortey.app; magic-link sign-in; Sentry DSN
- Planner + amenities + side-trip
- Today Command + reality replan (migration 0011) + service queue + fuel actuals
- Journey logging + OTA updates + iOS share extension (masters reconciled 2026-07-13; GitHub and Forgejo now share one line)
- Offline Today cache + dwell-stop suggestion + van→queue

## App Store (iOS)

Done:
- iOS permission usage strings (location / camera / photo library) via
  expo-location, expo-image-picker, expo-notifications config plugins +
  explicit infoPlist entries — was the top rejection blocker
- Real fastlane metadata (subtitle, description, keywords, promo, release
  notes); `check:app-store` now fails on placeholders and ASC length limits
- Apple credentials verified on EAS: distribution cert + active provisioning
  profile for com.gmacko.sortey and the share extension (team P4SWQXAB5H)
- ascAppId 6775057200 wired in eas.json submit profiles
- privacy (https://sortey.app/privacy) and support URLs resolve

- **Production build 6 (0.1.0) built and submitted to App Store Connect
  on 2026-07-13** (EAS build 8c40086d, submission 2993aa79, ASC API key
  RCRP9427V2 stored on EAS servers). Store provisioning profiles were
  regenerated with the `group.com.gmacko.sortey` App Group; APNs push key
  CUZMCMBZ86 assigned.
- **Production build 7 (0.1.0)** finished on EAS 2026-07-13
  (`ad91ed11-b21b-4561-9e24-94fb67cc4c32`, channel production). Prefer this
  for TestFlight if build 6 is superseded.
- **EAS Submit succeeded for build 7** — submission `dcc419a5-c37c-477b-b23a-acc90802168c`
  status `FINISHED` (2026-07-13T19:43Z). Binary is in App Store Connect / TestFlight.
  Re-running `eas submit` for the same build number will error; wait for Apple
  processing then install from TestFlight.

Automation (apps/expo):
```bash
pnpm submit:ios                         # latest production IPA → ASC (preferred)
pnpm build:ios:production:submit        # new build + auto-submit
pnpm fastlane:pilot                     # alternate: EAS IPA → pilot
pnpm fastlane:meta                      # metadata + screenshots only
```
- Fingerprint parity restored (three fixes: Sentry plugin filtered from the
  fingerprint, pristine frozen-lockfile node_modules, apps/expo/.gitignore
  now committed). `eas build` from a clean checkout matches EAS.

Remaining:
1. App Store screenshots — **drafts present** at
   `apps/expo/assets/app-store/drafts/` (3× iPhone 6.9" 1320×2868: trips,
   trip home, today). Still need: remaining 6.9" frames, iPad 13" set, and
   upload in ASC (not only drafts in repo).
2. App Privacy questionnaire in App Store Connect (location, analytics, email)
3. TestFlight pass on real devices, then submit for review in ASC

## Device

Native fingerprint changed on 2026-07-13 (permission plugins added): existing
binaries will NOT receive current updates over OTA. Install a fresh
`trip-device` build, then the usual loop applies:

1. OTA pull
2. Road trip → **Today**
3. Leave-by / Done / Replan…
