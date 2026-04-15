import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  type DatabaseRuntime,
  getDatabaseRuntime,
  resolveDatabaseUrl,
} from "./runtime";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  database: Database | undefined;
};

type DatabaseRuntimeWithCache = DatabaseRuntime & {
  database?: Database;
};

function createDatabase(databaseUrl: string, maxConnections: number) {
  const sql = postgres(databaseUrl, {
    max: maxConnections,
    prepare: false,
  });

  return drizzle({
    client: sql,
    schema,
    casing: "snake_case",
  });
}

type Database = ReturnType<typeof createDatabase>;

function getGlobalDatabase(): Database {
  const databaseUrl = resolveDatabaseUrl({
    envDatabaseUrl: process.env.DATABASE_URL,
  });

  const existingDatabase = globalForDb.database;
  if (existingDatabase) {
    return existingDatabase;
  }

  const database = createDatabase(
    databaseUrl,
    process.env.NODE_ENV === "production" ? 10 : 1,
  );

  if (process.env.NODE_ENV !== "production") {
    globalForDb.database = database;
  }

  return database;
}

function getCurrentDatabase(): Database {
  const runtime = getDatabaseRuntime() as DatabaseRuntimeWithCache | null;
  if (!runtime) {
    return getGlobalDatabase();
  }

  if (!runtime.database) {
    runtime.database = createDatabase(
      resolveDatabaseUrl({
        envDatabaseUrl: process.env.DATABASE_URL,
        runtimeDatabaseUrl: runtime.databaseUrl,
      }),
      1,
    );
  }

  return runtime.database;
}

export const db = new Proxy({} as Database, {
  get(_target, prop, receiver) {
    const currentDatabase = getCurrentDatabase();
    const value = Reflect.get(currentDatabase as object, prop, receiver);
    return typeof value === "function" ? value.bind(currentDatabase) : value;
  },
}) as Database;
