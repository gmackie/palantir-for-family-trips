const assert = require("node:assert/strict");
const test = require("node:test");

const fingerprintConfig = require("../fingerprint.config.js");

const transformExpoConfig = (config) =>
  fingerprintConfig.fileHookTransform(
    { type: "contents", id: "expoConfig" },
    JSON.stringify(config),
    true,
    "utf8",
  );

test("normalizes native-irrelevant service configuration", () => {
  const buildConfig = {
    name: "Sortey (Dev)",
    extra: { API_URL: "${API_URL}", SENTRY_DSN: "${SENTRY_DSN}" },
    plugins: [
      ["react-native-maps", { iosGoogleMapsApiKey: "${GOOGLE_MAPS_API_KEY}" }],
      [
        "@sentry/react-native/expo",
        { organization: "${SENTRY_ORG}", project: "${SENTRY_PROJECT}" },
      ],
    ],
  };
  const updateConfig = {
    ...buildConfig,
    extra: {
      API_URL: "https://sortey.app",
      SENTRY_DSN: "https://example.invalid/1",
    },
    plugins: [
      ["react-native-maps", { iosGoogleMapsApiKey: "resolved-key" }],
      [
        "@sentry/react-native/expo",
        { organization: "sortie-app", project: "mobile" },
      ],
    ],
  };

  assert.equal(
    transformExpoConfig(buildConfig),
    transformExpoConfig(updateConfig),
  );
});

test("ignores whether the conditional Sentry plugin is present", () => {
  const withoutSentry = {
    ios: { bundleIdentifier: "com.gmacko.sortey" },
    plugins: [
      "expo-router",
      ["react-native-maps", { iosGoogleMapsApiKey: "" }],
    ],
  };
  const withSentry = {
    ...withoutSentry,
    plugins: [
      ...withoutSentry.plugins,
      [
        "@sentry/react-native/expo",
        { organization: "sortie-app", project: "mobile" },
      ],
    ],
  };

  assert.equal(
    transformExpoConfig(withoutSentry),
    transformExpoConfig(withSentry),
  );
});

test("preserves native compatibility inputs", () => {
  const baseline = {
    ios: { bundleIdentifier: "com.gmacko.sortey.dev" },
    plugins: ["expo-router"],
  };
  const nativeChange = {
    ...baseline,
    plugins: ["expo-router", "expo-secure-store"],
  };

  assert.notEqual(
    transformExpoConfig(baseline),
    transformExpoConfig(nativeChange),
  );
});

test("skips package scripts from the fingerprint", () => {
  assert.ok(fingerprintConfig.sourceSkips.includes("PackageJsonScriptsAll"));
});
