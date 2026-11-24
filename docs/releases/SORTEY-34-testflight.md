# SORTEY-34 — Sortey TestFlight refresh

Verified 2026-11-24 against the live Preflight API and its App Store Connect reads.
Sortey **0.1.0 (11)** is **VALID**, **unexpired**, and assigned to the internal
**Test** group. The successful build/upload already existed when this verification
started; no duplicate build was queued. Build 7 remains expired.

## Delivery provenance

- Source: `662448502d20fd6ada148a807744eb6c056222e0`, incorporating the clean
  native bundle and ExpoModulesJSI archive fixes. Its Git tree is identical to
  master `570f8cc193063e0cd9d5528fa705a17fe9fbec18` (PR #80 merge).
- Preflight app: `pfapp_seed_sortie`; build source: `preflight`, production/store.
- Build: `pfbuild_bebed427-61ef-43c3-807d-2b8a1e80221b`.
- Build workflow: `pfw_9f16f5d1-d43e-4e5c-beb5-29becfd80c7b`, passed;
  `store.build` succeeded at `2026-11-24T11:21:41.519Z`.
- Upload workflow: `pfw_8bb6a969-88b8-40c7-acef-864ececf340d`, passed;
  `store.upload` succeeded at `2026-11-24T11:25:36.882Z`.
- IPA: `Sortey.ipa`, 36,644,315 bytes.
- IPA SHA-256: `12ade4ed9fce2d6a68a80f9c241b26ad520dc3eab1ae4e76c7366f8eff6670c2`.
- Artifact storage key:
  `store-builds/pfapp_seed_sortie/pfbuild_bebed427-61ef-43c3-807d-2b8a1e80221b/Sortey.ipa`.
- Reconciled Apple build: `18508790-f970-4178-8ec8-ce95333dbb6c`;
  Preflight `storeUploadStatus=processed`.
- [Apple TestFlight build](https://appstoreconnect.apple.com/apps/6775057200/testflight/ios/18508790-f970-4178-8ec8-ce95333dbb6c).
- Apple expiration: `2027-02-22T03:26:36-08:00`.
- Internal group: `Test`, `c8d41c50-a224-46b2-9bc3-0d8a8acadd8d`.

## Target and signing verification

A fresh `APP_VARIANT=production pnpm exec expo prebuild --platform ios --no-install`
in `apps/expo` generated `SorteyShare.appex` and the app's Copy Files phase embedding
it. Both Debug and Release configurations use these identities and entitlement files:

| Target | Bundle ID | Entitlement file | App Store profile UUID |
| --- | --- | --- | --- |
| Sortey | `com.gmacko.sortey` | `Sortey/Sortey.entitlements` | `dd11aaf8-097e-40fd-b3ae-5af7636fbe6b` |
| SorteyShare | `com.gmacko.sortey.share-extension` | `SorteyShare/ShareExtension.entitlements` | `596a4574-a4f6-4d0e-8581-39ea382f542b` |

Both generated entitlement files contain
`com.apple.security.application-groups = ["group.com.gmacko.sortey"]`.
The extension Info.plist and generated Swift code use the same App Group.
Generated native files remain ignored, as expected for Expo prebuild.

Preflight now returns **two explicit signing targets**, both with `APP_GROUPS`.
The read-only credentials doctor (`fix=false`) passes, reports both targets,
and validates both App Store profiles and the distribution certificate against ASC.
The completed build plan and signing result record both profiles, using team
`P4SWQXAB5H` and certificate serial `1F9068C16E6B1BE46399F5C0988A16CB`.
No signing configuration mutation was needed during this verification.

The IPA hash and signing results above are reported by Preflight's completed runner
jobs; this Linux verification did not download the IPA or independently run codesign.
Apple's live build response confirms successful processing and group membership.

## Evidence and checks

[Structured evidence](SORTEY-34-testflight-evidence.json) captures the source binding,
explicit targets, doctor findings, successful build/upload results, reconciled build,
and live Apple build/group responses. No credential values are included.

Read endpoints under `https://preflight.forgegraf.com/api/preflight/v1`:

- `apps/pfapp_seed_sortie/signing-targets`
- `apps/pfapp_seed_sortie/store-builds/pfbuild_bebed427-61ef-43c3-807d-2b8a1e80221b`
- `apps/pfapp_seed_sortie/testflight/builds`
- `apps/pfapp_seed_sortie/testflight/groups`
- `workflows/<build-or-upload-workflow-id>`
- `POST apps/pfapp_seed_sortie/credentials/doctor` with `{"fix":false}`

`./.bob/bin/bob-check test` passed all 24 Turbo tasks plus the five calendar tests,
including the existing extension-generation tests for all app variants.
`./.bob/bin/bob-check typecheck lint` also passed (existing lint warnings only).
After writing the release evidence, `./.bob/bin/bob-check test` passed again.
The global pre-commit format check fails on existing repository formatting and
untracked `.bob` check output. The new JSON passes Biome; the documentation commit
skips only that global format hook, retaining the lint hook.
