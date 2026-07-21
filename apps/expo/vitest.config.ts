import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // scripts/*.test.cjs are node:test files (run via `node --test`), not
    // vitest suites — keep vitest scoped to app source tests.
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
