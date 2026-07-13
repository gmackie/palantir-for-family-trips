# Fastlane — Sortey

## Roles

| Tool | Use for |
|------|---------|
| **EAS Submit** (`pnpm submit:ios`) | Primary path: production IPA → App Store Connect / TestFlight |
| **fastlane pilot** | Alternate: download latest EAS IPA and upload with pilot |
| **fastlane deliver** | Metadata + screenshots only (`skip_binary_upload`) |

Binary signing stays on EAS. Match is optional and unused by default.

## Lanes

```bash
cd apps/expo

# Preferred binary path
pnpm submit:ios

# Pilot latest EAS production IPA to TestFlight
pnpm fastlane:pilot

# Sync assets/app-store/drafts → fastlane/screenshots + upload listing
pnpm fastlane:meta

# Screenshots only into fastlane tree
pnpm fastlane:screenshots
```

## Auth for local fastlane

Use an App Store Connect API key (same model as EAS):

```bash
export APP_STORE_CONNECT_API_KEY_ID=XXXXXXXXXX
export APP_STORE_CONNECT_API_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
export APP_STORE_CONNECT_API_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_XXXXXXXXXX.p8"
```

Optional: `ASC_APP_ID=6775057200` (default), `APP_IDENTIFIER=com.gmacko.sortey`.

If the key is missing, `deliver`/`pilot` fall back to Apple ID interactive login (`APPLE_ID`).

## Metadata

Real listing copy lives in `fastlane/metadata/en-US/`. Validated by:

```bash
pnpm check:app-store
```

## Screenshots

1. Capture → `assets/app-store/drafts/`
2. `pnpm fastlane:screenshots` copies into `fastlane/screenshots/en-US/`
3. `pnpm fastlane:meta` uploads with deliver when PNGs are present

## Gemfile

If `bundle exec` is unavailable, install once from `apps/expo`:

```bash
# optional — system fastlane also works: `fastlane ios store_listing`
gem install fastlane
```
