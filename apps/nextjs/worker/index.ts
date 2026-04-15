import { runWithDatabaseRuntime } from "@gmacko/db/runtime";
import handler from "vinext/server/app-router-entry";
import type { ImageConfig } from "vinext/server/image-optimization";
import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
  handleImageOptimization,
} from "vinext/server/image-optimization";

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
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const imageConfig: ImageConfig = {};

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    return runWithDatabaseRuntime(
      {
        databaseUrl:
          env.HYPERDRIVE?.connectionString ?? process.env.DATABASE_URL ?? null,
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
