// @ts-expect-error vitest is installed in sibling workspace test packages
import { describe, expect, it } from "vitest";

import { syncWranglerDeployConfig } from "../../scripts/lib/sync-wrangler-config.mjs";

describe("syncWranglerDeployConfig", () => {
  it("preserves routes and hyperdrive bindings from the source config", () => {
    const buildConfig = {
      name: "trip-gmac-io",
      main: "index.js",
      assets: { directory: "../client", binding: "ASSETS" },
      hyperdrive: [],
      triggers: {},
    };

    const sourceConfig = {
      routes: [{ pattern: "trip.gmac.io", custom_domain: true }],
      hyperdrive: [{ binding: "HYPERDRIVE", id: "hyperdrive-id" }],
    };

    expect(
      syncWranglerDeployConfig({
        buildConfig,
        sourceConfig,
      }),
    ).toMatchObject({
      name: "trip-gmac-io",
      routes: [{ pattern: "trip.gmac.io", custom_domain: true }],
      hyperdrive: [{ binding: "HYPERDRIVE", id: "hyperdrive-id" }],
      assets: { directory: "../client", binding: "ASSETS" },
    });
  });

  it("preserves the version_metadata binding used for health identity", () => {
    expect(
      syncWranglerDeployConfig({
        buildConfig: { name: "sortey-app", main: "index.js" },
        sourceConfig: {
          version_metadata: { binding: "FG_WORKER_VERSION" },
        },
      }),
    ).toMatchObject({
      version_metadata: { binding: "FG_WORKER_VERSION" },
    });
  });
});
