const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function runtime(extra, variables) {
  const filename = path.resolve(__dirname, "../src/config/env.ts");
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(
    source,
    {
      exports,
      process: { env: variables },
      require(id) {
        if (id === "expo-constants")
          return { default: { expoConfig: { extra } } };
        return require(path.resolve(path.dirname(filename), id));
      },
    },
    { filename },
  );
  return exports.env.observability.sentryDsn;
}

test("unresolved build DSN falls back to the valid environment DSN", () => {
  assert.equal(
    runtime(
      { SENTRY_DSN: "${EXPO_PUBLIC_SENTRY_DSN_STAGING}" },
      {
        EXPO_PUBLIC_SENTRY_DSN_DEV: "https://key@sentry.example/1",
      },
    ),
    "https://key@sentry.example/1",
  );
});

test("invalid environment-specific DSN falls back to generic DSN", () => {
  for (const environment of ["production", "staging", "development"]) {
    const suffix = {
      production: "PROD",
      staging: "STAGING",
      development: "DEV",
    }[environment];
    assert.equal(
      runtime(
        { APP_ENV: environment },
        {
          [`EXPO_PUBLIC_SENTRY_DSN_${suffix}`]: "${UNRESOLVED_DSN}",
          EXPO_PUBLIC_SENTRY_DSN: "https://key@sentry.example/2",
        },
      ),
      "https://key@sentry.example/2",
    );
  }
});

test("unconfigured and malformed DSNs never initialize optional telemetry", () => {
  for (const value of [
    "",
    "${SENTRY_DSN}",
    "not-a-dsn",
    "https://sentry.example/1",
  ]) {
    assert.equal(runtime({ SENTRY_DSN: value }, {}), undefined);
  }
});

test("valid explicit DSN preserves its precedence", () => {
  assert.equal(
    runtime(
      { SENTRY_DSN: "https://explicit@sentry.example/3" },
      {
        EXPO_PUBLIC_SENTRY_DSN: "https://fallback@sentry.example/4",
      },
    ),
    "https://explicit@sentry.example/3",
  );
});

const {
  selectSentryDsn,
  validSentryDsn,
} = require("../src/config/sentry-dsn.js");

test("validator agrees with installed Sentry SDK on supported DSN shapes", () => {
  const sdkRoot = path.dirname(
    require.resolve("@sentry/react-native/package.json", {
      paths: [path.resolve(__dirname, "..")],
    }),
  );
  const { makeDsn } = require(
    require.resolve("@sentry/core", { paths: [sdkRoot] }),
  );
  const values = [
    "https://public@sentry.example/1",
    "http://public:secret@sentry.example:9000/prefix/123",
    "https://public@[::1]/42",
    "https://public:secret!@sentry.example/1",
    "https://sentry.example/1",
    "https://public@sentry.example/project",
    "${EXPO_PUBLIC_SENTRY_DSN_STAGING}",
  ];
  for (const value of values) {
    assert.equal(
      Boolean(validSentryDsn(value)),
      Boolean(makeDsn(value)),
      value,
    );
  }
});

test("invalid and non-string candidates cannot prevent a valid fallback", () => {
  for (const value of [
    undefined,
    null,
    42,
    {},
    "",
    " ",
    "${SENTRY_DSN}",
    "https://key:bad!@sentry.example/1",
  ]) {
    assert.equal(
      selectSentryDsn(value, " https://key@sentry.example/2 "),
      "https://key@sentry.example/2",
    );
  }
});

test("Expo config loader omits placeholders and accepts a valid generic fallback", () => {
  const { execFileSync } = require("node:child_process");
  const appDir = path.resolve(__dirname, "..");
  const load = (generic) => {
    const variables = {
      ...process.env,
      APP_VARIANT: "preview",
      SENTRY_DSN: "${SENTRY_DSN}",
      EXPO_PUBLIC_SENTRY_DSN_STAGING: "${EXPO_PUBLIC_SENTRY_DSN_STAGING}",
      EXPO_PUBLIC_SENTRY_DSN: generic,
    };
    const source =
      'const {getConfig}=require("@expo/config"); console.log(JSON.stringify({dsn:getConfig(process.cwd()).exp.extra.SENTRY_DSN}));';
    return JSON.parse(
      execFileSync(process.execPath, ["-e", source], {
        cwd: appDir,
        env: variables,
        encoding: "utf8",
      }),
    ).dsn;
  };
  // Expo caches its compiled config module: each environment needs a fresh process.
  assert.equal(load(""), undefined);
  assert.equal(
    load("https://fallback@sentry.example/5"),
    "https://fallback@sentry.example/5",
  );
});
