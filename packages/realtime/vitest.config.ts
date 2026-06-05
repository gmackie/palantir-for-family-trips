import { baseConfig } from "@sortey/vitest-config/base";

// `mergeMessages` + the pure backoff/typing helpers are environment-free, so the
// base (node) config is sufficient. The socket lifecycle is integration-tested
// in Task 8, not here.
export default baseConfig;
