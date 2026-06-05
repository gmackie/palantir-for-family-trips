import path from "node:path";
import { fileURLToPath } from "node:url";

import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const dir = path.dirname(fileURLToPath(import.meta.url));

// Vitest config for the Durable Object tests. These run inside the real
// `workerd` runtime via `@cloudflare/vitest-pool-workers`, so the hibernatable
// WebSocket API behaves exactly as it does in production.
//
// As of pool-workers 0.16 / vitest 4 the integration is a Vite plugin
// (`cloudflareTest`) rather than the old `defineWorkersConfig` wrapper. The
// plugin reads a test-only wrangler config that points at a tiny entry
// re-exporting just the `TripRoom` class (the app's real wrangler.jsonc has a
// vinext build + Next.js main the test pool can't bootstrap).
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: path.join(dir, "worker/__tests__/trip-room.wrangler.jsonc"),
      },
    }),
  ],
  test: {
    include: ["worker/__tests__/**/*.test.ts"],
  },
});
