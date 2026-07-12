# OTA updates

Sortey uses EAS Update for JavaScript and asset-only releases. Native changes
still require a new EAS build and store/internal distribution.

## Compatibility boundary

`app.config.ts` uses Expo's `fingerprint` runtime policy. An update is delivered
only to binaries with the same native fingerprint. Adding or upgrading a native
module, changing config plugins, entitlements, permissions, bundle identifiers,
or other native configuration requires a new binary before publishing updates.

The first build after enabling this policy establishes the compatible runtime
for each lane. Existing binaries built with the previous `0.1.0` runtime will
not receive fingerprinted updates.

## Channels

| EAS profile | Update channel | Audience |
| --- | --- | --- |
| `development` / `development-device` | `development` | developers and device QA |
| `preview` | `preview` | internal release QA |
| `production` | `production` | store users |

## Release flow

1. If native inputs changed, build and install a new binary for the target lane.
2. Publish to development and verify on a development build:

   ```bash
   pnpm update:development -- --message "Describe the change"
   ```

3. Publish the same commit to preview and verify on the internal build:

   ```bash
   pnpm update:preview -- --message "Describe the change"
   ```

4. Promote the tested update to production with EAS republish so production
   receives the exact bundle verified in preview. If a fresh production bundle
   is unavoidable, begin with a 10% rollout:

   ```bash
   pnpm update:production:rollout -- --message "Describe the change"
   ```

5. Monitor the EAS Update dashboard. Increase or cancel the rollout there or
   with `eas update:edit`. Use `eas update:rollback` if a fully deployed update
   must be reverted.

Do not publish directly from an unreviewed or dirty working tree. EAS Update
uses EAS environment variables selected by each script's `--environment` flag;
the `env` values in `eas.json` build profiles are not automatically available
to update exports.

App config aliases (`SENTRY_DSN`, `POSTHOG_KEY`, and `POSTHOG_HOST`) must resolve
identically from build-profile variables and their `EXPO_PUBLIC_*` EAS
environment counterparts. A runtime mismatch between `eas build` and
`eas update` means the update is not deliverable and must not be promoted.

Update scripts pin EAS CLI 20.5.1 because older CLI fingerprint implementations
can produce runtime versions that do not match current EAS Build fingerprints.
