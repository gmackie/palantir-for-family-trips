// Minimal ambient declaration of the Cloudflare Workers `ExecutionContext`
// global. `@forgegraph/otel/workers` is published as raw TypeScript source and
// references this global from `@cloudflare/workers-types`, which is not part of
// this app's tsc type environment. `skipLibCheck` does not skip `.ts` sources,
// so without this declaration tsc reports "Cannot find name 'ExecutionContext'"
// inside the otel package. Declaring just the surface otel uses keeps us free of
// a full `@cloudflare/workers-types` dependency.
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
