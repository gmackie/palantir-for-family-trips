import { AsyncLocalStorage } from "node:async_hooks";

export type DatabaseRuntime = {
  databaseUrl?: string | null;
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
