
import { describe, expect, it } from "vitest";

import {
  getDatabaseRuntime,
  resolveDatabaseUrl,
  runWithDatabaseRuntime,
} from "./runtime";

describe("database runtime", () => {
  it("prefers the request runtime database URL over the process env value", () => {
    expect(
      resolveDatabaseUrl({
        envDatabaseUrl: "postgresql://env.example.com/app",
        runtimeDatabaseUrl: "postgresql://runtime.example.com/app",
      }),
    ).toBe("postgresql://runtime.example.com/app");
  });

  it("falls back to the process env database URL when no runtime value exists", () => {
    expect(
      resolveDatabaseUrl({
        envDatabaseUrl: "postgresql://env.example.com/app",
        runtimeDatabaseUrl: undefined,
      }),
    ).toBe("postgresql://env.example.com/app");
  });

  it("keeps runtime database values request-scoped", async () => {
    expect(getDatabaseRuntime()).toBeNull();

    await runWithDatabaseRuntime(
      { databaseUrl: "postgresql://runtime.example.com/app" },
      async () => {
        expect(getDatabaseRuntime()?.databaseUrl).toBe(
          "postgresql://runtime.example.com/app",
        );
      },
    );

    expect(getDatabaseRuntime()).toBeNull();
  });
});
