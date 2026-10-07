const { IOSConfig, withXcodeProject } = require("expo/config-plugins");

// expo-share-intent skips build settings when its target already exists.
// Reconcile them on every prebuild so switching lanes cannot retain the
// previous parent's identifier. Register before expo-share-intent: Expo runs
// Xcode mod actions in reverse registration order, so creation runs first.
/** @type {import('expo/config-plugins').ConfigPlugin} */
module.exports = (config) =>
  withXcodeProject(config, (mod) => {
    const parentIdentifier = mod.ios?.bundleIdentifier;
    if (!parentIdentifier) throw new Error("Sortey requires an iOS bundle ID");
    // xcode.addTarget quotes the new target comment; parsed projects may not.
    const target =
      mod.modResults.pbxTargetByName("SorteyShare") ??
      mod.modResults.pbxTargetByName('"SorteyShare"');
    if (!target)
      throw new Error("SorteyShare target must exist before identity sync");

    const configurations = IOSConfig.XcodeUtils.getBuildConfigurationsForListId(
      mod.modResults,
      target.buildConfigurationList,
    );
    for (const [, configuration] of configurations) {
      configuration.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = `"${parentIdentifier}.share-extension"`;
    }
    return mod;
  });
