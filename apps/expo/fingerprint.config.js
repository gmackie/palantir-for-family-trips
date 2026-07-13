const assert = require("node:assert");

// The Sentry config plugin only adds source-map upload build phases; the
// native module is always autolinked from package.json, so whether the
// plugin is present (it is conditional on SENTRY_DSN, which EAS Build has
// but a local `eas build` invocation may not) must not change the runtime
// fingerprint.
const isRuntimeConditionalPlugin = (plugin) =>
  (Array.isArray(plugin) ? plugin[0] : plugin) === "@sentry/react-native/expo";

const normalizePluginOptions = (plugin) => {
  if (!Array.isArray(plugin)) return plugin;

  const [name, options, ...rest] = plugin;
  if (!options || typeof options !== "object") return plugin;

  if (name === "react-native-maps" && "iosGoogleMapsApiKey" in options) {
    return [
      name,
      { ...options, iosGoogleMapsApiKey: "<runtime-value>" },
      ...rest,
    ];
  }

  return plugin;
};

/** @type {import('expo/fingerprint').Config} */
const config = {
  sourceSkips: ["PackageJsonScriptsAll"],
  // When the conditional Sentry plugin is active, @expo/fingerprint also
  // hashes the plugin's implementation files — ignore them for the same
  // reason the plugin entry itself is filtered out above.
  ignorePaths: [
    "**/node_modules/@sentry/react-native/**",
    "../../node_modules/@sentry/react-native/**",
    // Build/submit orchestration, not native runtime configuration —
    // editing submit profiles must not orphan built binaries from OTA.
    "eas.json",
  ],
  fileHookTransform: (source, chunk, isEndOfFile) => {
    if (source.type !== "contents" || source.id !== "expoConfig") return chunk;

    assert(
      isEndOfFile,
      "The Expo config fingerprint source must be a single chunk.",
    );
    const expoConfig = JSON.parse(chunk.toString());
    delete expoConfig.extra;
    expoConfig.plugins = expoConfig.plugins
      ?.filter((plugin) => !isRuntimeConditionalPlugin(plugin))
      .map(normalizePluginOptions);
    return JSON.stringify(expoConfig);
  },
};

module.exports = config;
