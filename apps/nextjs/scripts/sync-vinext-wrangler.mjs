import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { syncWranglerDeployConfig } from "./lib/sync-wrangler-config.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const sourceConfigPath = path.join(appDir, "wrangler.jsonc");
const buildConfigPath = path.join(appDir, "dist", "server", "wrangler.json");

const [sourceConfigText, buildConfigText] = await Promise.all([
  readFile(sourceConfigPath, "utf8"),
  readFile(buildConfigPath, "utf8"),
]);

const sourceConfig = JSON.parse(sourceConfigText);
const buildConfig = JSON.parse(buildConfigText);

const syncedConfig = syncWranglerDeployConfig({
  buildConfig,
  sourceConfig,
});

await writeFile(
  buildConfigPath,
  `${JSON.stringify(syncedConfig, null, 2)}\n`,
  "utf8",
);
