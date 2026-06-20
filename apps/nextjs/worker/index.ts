import { wrapFetch } from "@forgegraph/otel/workers";
import type { RateLimitCheck, RateLimitResult } from "@sortey/api";
import { runWithRateLimitRuntime, runWithRealtimeRuntime } from "@sortey/api";
import { and, eq } from "@sortey/db";
import { db } from "@sortey/db/client";
import { runWithDatabaseRuntime } from "@sortey/db/runtime";
import { tripMembers } from "@sortey/db/schema";
import handler from "vinext/server/app-router-entry";
import type { ImageConfig } from "vinext/server/image-optimization";
import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
  handleImageOptimization,
} from "vinext/server/image-optimization";
import { auth } from "~/auth/server";

interface R2Bucket {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | ReadableStream | Blob,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
}

// Minimal surface of the `TRIP_ROOM` Durable Object namespace binding. The full
// Workers types are not in this app's tsc env, so declare just what callers use.
interface DurableObjectId {
  toString(): string;
}
interface DurableObjectStub {
  // The Workers runtime's DO stub `fetch` mirrors the global `fetch` signature:
  // it accepts either a `Request` (used for the upgrade forward) or a URL string
  // + `RequestInit` (used by the server-side `/broadcast` helper).
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}
interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

export interface Env {
  APP_ENV?: "development" | "staging" | "production";
  TRIP_ROOM: DurableObjectNamespace;
  RATE_LIMITER: DurableObjectNamespace;
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: {
          format: string;
          quality: number;
        }): Promise<{ response(): Response }>;
      };
    };
  };
  HYPERDRIVE?: {
    connectionString?: string | null;
  };
  R2?: R2Bucket;
  FG_APP?: string;
  FG_STAGE?: string;
  OTEL_ENDPOINT?: string;
  OTEL_DISABLED?: string;
  [key: string]: unknown;
}

const SECRET_KEYS = [
  "AUTH_SECRET",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "AUTH_APPLE_ID",
  "AUTH_APPLE_SECRET",
  "AUTH_APPLE_BUNDLE_ID",
  "AUTH_DISCORD_ID",
  "AUTH_DISCORD_SECRET",
  "GEMINI_API_KEY",
  "GOOGLE_ROUTES_API_KEY",
  "RESEND_API_KEY",
  "ANTHROPIC_API_KEY",
] as const;

function syncEnvSecrets(env: Env) {
  for (const key of SECRET_KEYS) {
    const val = env[key];
    if (typeof val === "string" && val) {
      (process.env as Record<string, string>)[key] = val;
    }
  }
}

// Server-side fan-out seam. Persisting a chat message (tRPC `chat.send`/`delete`)
// POSTs the event to the trip's TripRoom DO, which broadcasts it to every
// connected socket. This is the ONLY path that reaches the DO's `/broadcast`
// route — it is never exposed to the public internet (see the WS route below,
// which only ever forwards the upgrade).
//
// Best-effort: a broadcast failure must never roll back or block the
// already-persisted mutation, so we swallow errors and never await the result in
// a way that propagates a rejection. The DO call is fired and forgotten.
function broadcastToTripRoom(env: Env, tripId: string, payload: unknown): void {
  try {
    const id = env.TRIP_ROOM.idFromName(tripId);
    const stub = env.TRIP_ROOM.get(id);
    void stub
      .fetch("https://do/broadcast", {
        method: "POST",
        body: JSON.stringify(payload),
      })
      .catch(() => {
        // Swallow: realtime delivery is opportunistic; Postgres is the source
        // of truth and history backfill covers any dropped broadcast.
      });
  } catch {
    // `idFromName`/`get` should not throw, but never let a fan-out problem
    // surface into the persisted mutation.
  }
}

// Rate-limit seam. Calls the RateLimiter DO's POST /check endpoint with the
// bucket key + policy params and returns the result. Fails open: if the DO is
// unreachable or returns an unexpected payload, we return `allowed: true` so a
// limiter outage never blocks legitimate traffic — and we log it.
async function checkRateLimit(
  env: Env,
  input: RateLimitCheck,
): Promise<RateLimitResult> {
  try {
    const id = env.RATE_LIMITER.idFromName(input.key);
    const stub = env.RATE_LIMITER.get(id);
    const res = await stub.fetch("https://do/check", {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
    });
    if (!res.ok) {
      console.warn(
        `[rate-limiter] DO returned ${res.status} for key ${input.key}; failing open`,
      );
      return {
        allowed: true,
        remaining: input.limit,
        resetAt: Date.now() + input.windowMs,
      };
    }
    return (await res.json()) as RateLimitResult;
  } catch (err) {
    console.warn(
      `[rate-limiter] error checking key ${input.key}: ${String(err)}; failing open`,
    );
    return {
      allowed: true,
      remaining: input.limit,
      resetAt: Date.now() + input.windowMs,
    };
  }
}

// --- Authenticated chat WebSocket upgrade -----------------------------------
//
// SECURITY-CRITICAL. The TripRoom DO trusts the `x-user-id` / `x-user-name`
// headers unconditionally, so this is the trust boundary: nothing reaches the DO
// upgrade path without (1) a valid better-auth session and (2) verified trip
// membership, and the identity headers are derived solely from the validated
// session — any client-supplied `x-user-*` header is stripped first.
//
// Must run inside `runWithDatabaseRuntime` so the `db` proxy resolves the
// request's Hyperdrive connection for the membership query.
async function handleChatWebSocketUpgrade(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  // Only a real WebSocket upgrade is forwarded to the DO.
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("expected websocket upgrade", { status: 426 });
  }

  // Path is `/api/chat/<tripId>/ws` -> ["", "api", "chat", "<tripId>", "ws"].
  const tripId = url.pathname.split("/")[3];
  if (
    !tripId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      tripId,
    )
  ) {
    return new Response("invalid trip id", { status: 400 });
  }

  // 1. Validate the better-auth session from the request cookies. Same
  //    mechanism as `~/auth/server` and the tRPC route handler.
  const session = await auth.api.getSession({ headers: request.headers });
  const userId = session?.user?.id;
  if (!userId) {
    return new Response("unauthorized", { status: 401 });
  }
  const name = session.user.name ?? "";

  // 2. Verify trip membership with a tiny scoped query. `db` here resolves the
  //    request's Hyperdrive connection via the surrounding database runtime.
  const membership = (await db
    .select({ userId: tripMembers.userId })
    .from(tripMembers)
    .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId)))
    .limit(1)) as { userId: string }[];
  if (membership.length === 0) {
    return new Response("forbidden", { status: 403 });
  }

  // 3. SECURITY: build a FRESH Headers from the incoming request, then DELETE
  //    any client-supplied identity headers (case-insensitive via
  //    `Headers.delete`) BEFORE setting the trusted values. Spreading the
  //    request headers into an object literal would NOT reliably overwrite a
  //    spoofed header, so we mutate an explicit Headers instance instead.
  const forwardHeaders = new Headers(request.headers);
  forwardHeaders.delete("x-user-id");
  forwardHeaders.delete("x-user-name");
  forwardHeaders.set("x-user-id", userId);
  forwardHeaders.set("x-user-name", name);

  // Forward the upgrade to the trip's DO. This is the only client-reachable DO
  // path; `/broadcast` is never routed here from the internet.
  const id = env.TRIP_ROOM.idFromName(tripId);
  const stub = env.TRIP_ROOM.get(id);
  return stub.fetch(new Request(request, { headers: forwardHeaders }));
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledEvent {
  cron: string;
  scheduledTime: number;
}

const imageConfig: ImageConfig = {};

const instrumentedFetch = wrapFetch(
  // `wrapFetch` types the handler against otel's looser `WorkerEnv`; narrow it
  // back to this worker's `Env` (which guarantees the ASSETS/IMAGES bindings).
  async (request, workerEnv, ctx) => {
    const env = workerEnv as Env;
    syncEnvSecrets(env);
    const url = new URL(request.url);

    if (url.pathname === "/api/auth-debug") {
      const cookieHeader = request.headers.get("cookie");
      return new Response(
        JSON.stringify({
          hasCookie: !!cookieHeader,
          cookiePreview: cookieHeader
            ? cookieHeader.substring(0, 120) + "..."
            : null,
          cookieNames: cookieHeader
            ? cookieHeader
                .split(";")
                .map((c) => c.trim().split("=")[0])
                .filter(Boolean)
            : [],
          hasHyperdrive: !!env.HYPERDRIVE?.connectionString,
          timestamp: new Date().toISOString(),
        }),
        { headers: { "content-type": "application/json" } },
      );
    }

    return runWithDatabaseRuntime(
      {
        databaseUrl:
          env.HYPERDRIVE?.connectionString ?? process.env.DATABASE_URL ?? null,
        r2: env.R2,
      },
      async () => {
        const url = new URL(request.url);

        // Authenticated chat WebSocket upgrade: `/api/chat/<tripId>/ws`. Handled
        // here (inside the DB runtime, so the membership query works) BEFORE the
        // request ever reaches the Next.js handler. The DO's `/broadcast` route
        // is intentionally NOT reachable from any client path.
        if (
          request.method === "GET" &&
          url.pathname.startsWith("/api/chat/") &&
          url.pathname.endsWith("/ws")
        ) {
          return handleChatWebSocketUpgrade(request, env, url);
        }

        if (url.pathname === "/_vinext/image") {
          const allowedWidths = [
            ...DEFAULT_DEVICE_SIZES,
            ...DEFAULT_IMAGE_SIZES,
          ];
          return handleImageOptimization(
            request,
            {
              fetchAsset: (assetPath, currentRequest) =>
                env.ASSETS.fetch(
                  new Request(new URL(assetPath, currentRequest.url)),
                ),
              transformImage: async (
                body: ReadableStream,
                {
                  width,
                  format,
                  quality,
                }: { width: number; format: string; quality: number },
              ) => {
                const result = await env.IMAGES.input(body)
                  .transform(width > 0 ? { width } : {})
                  .output({ format, quality });
                return result.response();
              },
            },
            allowedWidths,
            imageConfig,
          );
        }

        // Make the TripRoom fan-out seam available to tRPC mutations
        // (`chat.send` / `chat.delete`) for the duration of this request.
        // `createTRPCContext` reads this via `getRealtimeRuntime()` and exposes
        // it as `ctx.realtime`. In unit tests there is no runtime, so the
        // broadcast is skipped. `broadcast` is best-effort and never throws.
        //
        // The RateLimiter seam is nested inside: `createTRPCContext` reads it
        // via `getRateLimitRuntime()` and exposes it as `ctx.rateLimit`. Fails
        // open on any DO error so a limiter outage never blocks all writes.
        return runWithRealtimeRuntime(
          {
            broadcast: (tripId, payload) =>
              broadcastToTripRoom(env, tripId, payload),
          },
          () =>
            runWithRateLimitRuntime(
              {
                check: (input) => checkRateLimit(env, input),
              },
              () => handler.fetch(request, env, ctx),
            ),
        );
      },
    );
  },
  { serviceName: "sortey" },
);

export { RateLimiter } from "./rate-limiter";
// The `TripRoom` and `RateLimiter` Durable Object classes must be exported from
// the worker entry module so wrangler can bind them (see `durable_objects` in
// wrangler.jsonc).
export { TripRoom } from "./trip-room";

export default {
  async scheduled(_event: ScheduledEvent, _env: Env, _ctx: ExecutionContext) {},
  fetch: instrumentedFetch,
};
