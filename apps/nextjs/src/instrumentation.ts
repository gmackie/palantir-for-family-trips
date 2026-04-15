import { integrations } from "@gmacko/config";
import { captureException } from "@gmacko/monitoring/web";

export async function register() {
  if (integrations.sentry) {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      await import("../sentry.server.config");
    }

    if (process.env.NEXT_RUNTIME === "edge") {
      await import("../sentry.edge.config");
    }
  }
}

export async function onRequestError(error: unknown) {
  if (!integrations.sentry) {
    return;
  }

  captureException(error);
}
