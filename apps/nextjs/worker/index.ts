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

export default {
  async scheduled(_event: ScheduledEvent, _env: Env, _ctx: ExecutionContext) {},

  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
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
};
