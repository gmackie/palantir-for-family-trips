type WorkerEnv = {
  HYPERDRIVE?: {
    connectionString?: string | null;
  };
};

export function resolveWorkerDatabaseUrl(env?: WorkerEnv): string | null {
  return env?.HYPERDRIVE?.connectionString ?? process.env.DATABASE_URL ?? null;
}
