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

Remaining:
1. Production build → `eas submit --platform ios` (needs `APPLE_ID` /
   `APPLE_TEAM_ID` env at submit time)
2. App Store screenshots (`assets/app-store/` is empty) — capture 6.9" and
   iPad 13" sets once a build is on TestFlight/simulator
3. App Privacy questionnaire in App Store Connect (location, analytics, email)
4. TestFlight pass on real devices before submitting for review

## Device

Native fingerprint changed on 2026-07-13 (permission plugins added): existing
binaries will NOT receive current updates over OTA. Install a fresh
`trip-device` build, then the usual loop applies:

1. OTA pull
2. Road trip → **Today**
3. Leave-by / Done / Replan…
