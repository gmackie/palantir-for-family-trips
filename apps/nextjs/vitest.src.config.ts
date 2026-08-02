import { defineConfig } from "vitest/config";

// Plain-node tests for `src/**` — pure logic that needs neither the workerd
// runtime (see vitest.worker.config.ts) nor a browser.
//
// These files existed and were never executed: `pnpm test` pointed only at the
// worker config, so seven suites' worth of assertions sat dead in the tree.
// `next.config.js` validates env at import time and would fail the run, so the
// include list is deliberately narrow and nothing here may import it.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
