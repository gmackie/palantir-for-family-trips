import { AsyncLocalStorage } from "node:async_hooks";

export type DatabaseRuntime = {
  databaseUrl?: string | null;
  r2?: unknown;
};

const databaseRuntimeStorage = new AsyncLocalStorage<DatabaseRuntime>();

export function runWithDatabaseRuntime<T>(
  runtime: DatabaseRuntime,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return databaseRuntimeStorage.run(runtime, fn);
}

export function getDatabaseRuntime(): DatabaseRuntime | null {
  return databaseRuntimeStorage.getStore() ?? null;
}

export function getR2Bucket(): unknown | null {
  return databaseRuntimeStorage.getStore()?.r2 ?? null;
}

export function resolveDatabaseUrl(input: {
  envDatabaseUrl?: string | null;
  runtimeDatabaseUrl?: string | null;
}): string {
  const runtimeDatabaseUrl = input.runtimeDatabaseUrl?.trim();
  if (runtimeDatabaseUrl) {
    return runtimeDatabaseUrl;
  }

  const envDatabaseUrl = input.envDatabaseUrl?.trim();
  if (envDatabaseUrl) {
    return envDatabaseUrl;
  }

  throw new Error("Missing DATABASE_URL environment variable");
}
