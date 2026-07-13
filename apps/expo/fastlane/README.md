fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## iOS

### ios pilot_ipa

```sh
[bundle exec] fastlane ios pilot_ipa
```

Upload an IPA to TestFlight (pilot). Pass ipa: path/to.ipa

### ios pilot_eas_latest

```sh
[bundle exec] fastlane ios pilot_eas_latest
```

Download latest production IPA from EAS and upload to TestFlight via pilot

### ios deliver_meta

```sh
[bundle exec] fastlane ios deliver_meta
```

Push App Store metadata (and screenshots if present). Does not upload binary.

### ios sync_screenshots

```sh
[bundle exec] fastlane ios sync_screenshots
```

Sync App Store screenshots from assets/app-store/drafts into fastlane/screenshots

### ios store_listing

```sh
[bundle exec] fastlane ios store_listing
```

Metadata + screenshots to ASC (sync drafts first if present)

### ios beta

```sh
[bundle exec] fastlane ios beta
```

Preferred full TF path when not using eas submit: pilot_eas_latest

### ios sync_certs

```sh
[bundle exec] fastlane ios sync_certs
```

Sync certs via match (optional; EAS usually owns signing)

----


## Android

### android beta

```sh
[bundle exec] fastlane android beta
```

Upload AAB to Play internal track

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
