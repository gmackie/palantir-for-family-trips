import type { AppRouter } from "@sortey/api";
import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, loggerLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import superjson from "superjson";

import { authClient } from "./auth";
import { getBaseUrl } from "./base-url";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // ...
    },
  },
});

/**
 * Vanilla tRPC client. Used by the React-Query options proxy below, and also
 * exported directly for imperative `.query` / `.mutate` calls (e.g. the
 * `useTripChat` hook bridges `chat.history` / `chat.send` through it — the
 * options proxy only exposes `queryOptions`/`mutationOptions`, not a plain
 * resolver, so a vanilla client is the clean imperative path).
 */
export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    loggerLink({
      enabled: (opts) =>
        process.env.NODE_ENV === "development" ||
        (opts.direction === "down" && opts.result instanceof Error),
      colorMode: "ansi",
    }),
    httpBatchLink({
      transformer: superjson,
      url: `${getBaseUrl()}/api/trpc`,
      fetch: (url, options) => fetch(url, { ...options, credentials: "omit" }),
      headers() {
        const headers: Record<string, string> = {
          "x-trpc-source": "expo-react",
        };

        const cookies = authClient.getCookie();
        if (cookies) {
          headers["cookie"] = cookies;
        }
        return headers;
      },
    }),
  ],
});

/**
 * A set of typesafe hooks for consuming your API.
 */
export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});

export type { RouterInputs, RouterOutputs } from "@sortey/api";
