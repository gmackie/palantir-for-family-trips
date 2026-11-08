// ForgeGraph deployment identity on health responses.
//
// ForgeGraph's private one-box probe reads `x-fg-commit-sha` and
// `x-fg-worker-version` from `/api/health` and only accepts them when they
// match the recorded deployment. The values come solely from immutable
// bindings: `FG_COMMIT_HASH` (a var ForgeGraph injects at deploy time) and
// `FG_WORKER_VERSION` (wrangler `version_metadata`). Anything already on the
// response, or sent by the client, is discarded.

export interface HealthIdentityEnv {
  FG_COMMIT_HASH?: unknown;
  FG_WORKER_VERSION?: unknown;
}

const HEALTH_PATHS = new Set([
  "/api/health",
  "/api/health/live",
  "/api/health/ready",
  "/.well-known/forge-health",
]);
const COMMIT_SHA = /^[a-f0-9]{40}$/i;
const WORKER_VERSION = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export function isHealthPath(pathname: string): boolean {
  return HEALTH_PATHS.has(pathname);
}

export function withHealthIdentity(
  request: Request,
  env: HealthIdentityEnv,
  result: Response,
): Response {
  if (!isHealthPath(new URL(request.url).pathname)) return result;

  // Copy so the headers are mutable (framework responses may be immutable).
  const response = new Response(result.body, {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
  });
  response.headers.delete("x-fg-commit-sha");
  response.headers.delete("x-fg-worker-version");

  const commit = env.FG_COMMIT_HASH;
  if (typeof commit === "string" && COMMIT_SHA.test(commit))
    response.headers.set("x-fg-commit-sha", commit);

  const versionMetadata = env.FG_WORKER_VERSION;
  const version =
    versionMetadata && typeof versionMetadata === "object"
      ? (versionMetadata as { id?: unknown }).id
      : undefined;
  if (typeof version === "string" && WORKER_VERSION.test(version))
    response.headers.set("x-fg-worker-version", version);

  response.headers.set("cache-control", "private, no-store");
  return response;
}
