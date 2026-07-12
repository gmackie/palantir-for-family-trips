const assert = require("node:assert");

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

  if (name === "@sentry/react-native/expo") {
    return [
      name,
      {
        ...options,
        organization: "<runtime-value>",
        project: "<runtime-value>",
      },
      ...rest,
    ];
  }

  return plugin;
};

/** @type {import('expo/fingerprint').Config} */
const config = {
  sourceSkips: ["PackageJsonScriptsAll"],
  fileHookTransform: (source, chunk, isEndOfFile) => {
    if (source.type !== "contents" || source.id !== "expoConfig") return chunk;

    assert(
      isEndOfFile,
      "The Expo config fingerprint source must be a single chunk.",
    );
    const expoConfig = JSON.parse(chunk.toString());
    delete expoConfig.extra;
    expoConfig.plugins = expoConfig.plugins?.map(normalizePluginOptions);
    return JSON.stringify(expoConfig);
  },
};

module.exports = config;
