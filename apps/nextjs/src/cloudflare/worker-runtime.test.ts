import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveWorkerDatabaseUrl } from "./worker-runtime";

const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
  vi.unstubAllEnvs();
});

describe("resolveWorkerDatabaseUrl", () => {
  it("falls back to process.env when the worker env is missing", () => {
    vi.stubEnv("DATABASE_URL", "postgres://local/fallback");

    expect(resolveWorkerDatabaseUrl()).toBe("postgres://local/fallback");
  });

  it("prefers the Hyperdrive connection string when present", () => {
    vi.stubEnv("DATABASE_URL", "postgres://local/fallback");

    expect(
      resolveWorkerDatabaseUrl({
        HYPERDRIVE: { connectionString: "postgres://hyperdrive/runtime" },
      }),
    ).toBe("postgres://hyperdrive/runtime");
  });

  it("returns null when neither Hyperdrive nor DATABASE_URL is available", () => {
    delete process.env.DATABASE_URL;

    expect(resolveWorkerDatabaseUrl()).toBeNull();
  });
});
