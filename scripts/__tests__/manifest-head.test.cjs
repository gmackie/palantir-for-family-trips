const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Writable } = require("node:stream");
const { after, test } = require("node:test");

const repositoryRoot = path.resolve(__dirname, "../..");
const dependencyRoot =
  process.env.MANIFEST_TEST_DEPENDENCIES ??
  path.join(repositoryRoot, "node_modules");
const cliRoot =
  process.env.MANIFEST_TEST_CLI_ROOT ??
  path.dirname(
    require.resolve("@expo/cli/package.json", {
      paths: [path.join(repositoryRoot, "apps/expo")],
    }),
  );
assert.equal(require(path.join(cliRoot, "package.json")).version, "56.1.18");
const { ExpoGoManifestHandlerMiddleware } = require(
  path.join(
    cliRoot,
    "build/src/start/server/middleware/ExpoGoManifestHandlerMiddleware.js",
  ),
);
const projectRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "manifest-head-contract-"),
);
fs.writeFileSync(
  path.join(projectRoot, "app.json"),
  JSON.stringify({
    expo: {
      name: "HEAD contract",
      slug: "head-contract",
      sdkVersion: "56.0.0",
      runtimeVersion: "synthetic-native-runtime",
      platforms: ["ios", "android", "web"],
    },
  }),
);
fs.writeFileSync(
  path.join(projectRoot, "package.json"),
  JSON.stringify({
    name: "head-contract",
    dependencies: { expo: "56.0.14" },
  }),
);
fs.symlinkSync(dependencyRoot, path.join(projectRoot, "node_modules"));
after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

class ContractManifest extends ExpoGoManifestHandlerMiddleware {
  constructor(mode = "development") {
    super(projectRoot, { mode, constructUrl: () => "http://localhost:8081" });
    this.settingsReads = 0;
    this.savedDeviceRequests = 0;
  }
  async saveDevicesAsync() {
    this.savedDeviceRequests += 1;
  }
  async handleWebRequestAsync(req, res) {
    res.appendHeader("content-type", "text/html");
    res.end("synthetic-browser-page");
  }
  async _resolveProjectSettingsAsync() {
    this.settingsReads += 1;
    return {
      exp: {
        name: "HEAD contract",
        slug: "head-contract",
        runtimeVersion: "synthetic-native-runtime",
      },
      hostUri: "localhost:8081",
      bundleUrl: "http://localhost:8081/index.bundle",
      expoGoConfig: { developer: { tool: "expo-cli" } },
    };
  }
}

class ResponseSink extends Writable {
  constructor() {
    super();
    this.headers = new Headers();
    this.parts = [];
    this.statusCode = 200;
  }
  _write(chunk, encoding, done) {
    this.parts.push(Buffer.from(chunk));
    done();
  }
  setHeaders(headers) {
    this.headers = new Headers(headers);
  }
  appendHeader(name, value) {
    this.headers.append(name, value);
  }
}

async function invoke({
  method = "HEAD",
  url = "/",
  platform = "ios",
  accept = "application/expo+json,application/json",
  mode = "development",
  signature,
} = {}) {
  const handler = new ContractManifest(mode);
  const req = {
    method,
    url,
    headers: { host: "localhost:8081", "expo-platform": platform, accept },
  };
  if (signature) req.headers["expo-expect-signature"] = signature;
  const res = new ResponseSink();
  let nextCalls = 0;
  await handler.getHandler()(req, res, () => {
    nextCalls += 1;
  });
  return {
    handler,
    res,
    nextCalls,
    body: Buffer.concat(res.parts).toString("utf8"),
  };
}

// Mirrors EXDevLauncherManifestParser.m:46–68: successful HEAD with a non-HTML/non-JS content type is a manifest.
function nativeHeadDetectsManifest(res) {
  const contentType = res.headers.get("content-type");
  return (
    res.statusCode < 200 ||
    res.statusCode >= 300 ||
    res.headers.has("exponent-server") ||
    Boolean(
      contentType &&
        !contentType.startsWith("text/html") &&
        !contentType.includes("/javascript"),
    )
  );
}

test("native iOS HEAD negotiates headers without full runtime resolution", async () => {
  const r = await invoke();
  assert.equal(r.res.statusCode, 200);
  assert.equal(nativeHeadDetectsManifest(r.res), true);
  assert.equal(r.res.headers.get("expo-protocol-version"), "0");
  assert.equal(r.res.headers.get("expo-sfv-version"), "0");
  assert.equal(r.res.headers.get("cache-control"), "private, max-age=0");
  assert.equal(r.handler.settingsReads, 0);
  assert.equal(r.handler.savedDeviceRequests, 1);
  assert.equal(r.body, "");
});

test("GET retains actual installed runtime resolver and response", async () => {
  const r = await invoke({ method: "GET" });
  assert.equal(r.handler.settingsReads, 1);
  assert.equal(JSON.parse(r.body).runtimeVersion, "synthetic-native-runtime");
  assert.equal(JSON.parse(r.body).extra.expoGo.developer.tool, "expo-cli");
});

for (const [label, request] of [
  ["Android", { platform: "android" }],
  ["manifest alias", { url: "/manifest" }],
  ["query request", { url: "/?platform=ios" }],
  ["generic accept", { accept: "application/json" }],
  ["production mode", { mode: "production" }],
]) {
  test(`${label} retains full existing manifest path`, async () => {
    const r = await invoke(request);
    assert.equal(r.handler.settingsReads, 1);
    assert.equal(JSON.parse(r.body).runtimeVersion, "synthetic-native-runtime");
  });
}

test("bundle route falls through without claiming a manifest", async () => {
  const r = await invoke({ url: "/index.bundle" });
  assert.equal(r.nextCalls, 1);
  assert.equal(r.handler.settingsReads, 0);
});

test("invalid platform retains existing validation failure", async () => {
  const r = await invoke({ platform: "invalid" });
  assert.equal(r.res.statusCode, 500);
  assert.equal(r.handler.settingsReads, 0);
  assert.match(JSON.parse(r.body).error, /Received: "invalid"/);
});

test("browser request retains the existing HTML path", async () => {
  const r = await invoke({ platform: "web", accept: "text/html" });
  assert.equal(r.res.headers.get("content-type"), "text/html");
  assert.equal(r.handler.settingsReads, 0);
  assert.equal(r.body, "synthetic-browser-page");
});

test("signed HEAD retains the existing complete manifest path", async () => {
  const r = await invoke({ signature: 'keyid="unconfigured-test-key"' });
  assert.equal(r.handler.settingsReads, 1);
});
