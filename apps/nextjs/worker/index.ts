import { wrapFetch } from "@forgegraph/otel/workers";
import { runWithDatabaseRuntime } from "@gmacko/db/runtime";
import handler from "vinext/server/app-router-entry";
import type { ImageConfig } from "vinext/server/image-optimization";
import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
  handleImageOptimization,
} from "vinext/server/image-optimization";

interface R2Bucket {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | ReadableStream | Blob,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
}

interface Env {
  APP_ENV?: "development" | "staging" | "production";
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

        return handler.fetch(request, env, ctx);
      },
    );
  },
  { serviceName: "sortey" },
);

export default {
  async scheduled(_event: ScheduledEvent, _env: Env, _ctx: ExecutionContext) {},
  fetch: instrumentedFetch,
};
