import { withSentryConfig } from "@sentry/nextjs";
import { integrations } from "@sortey/config";
import { createJiti } from "jiti";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const jiti = createJiti(import.meta.url);

await jiti.import("./src/env");

/** @type {import("next").NextConfig} */
const config = {
  output: process.env.DOCKER_BUILD ? "standalone" : undefined,

  transpilePackages: [
    "@sortey/api",
    "@sortey/auth",
    "@sortey/config",
    "@sortey/db",
    "@sortey/i18n",
    "@sortey/logging",
    "@sortey/monitoring",
    "@sortey/ui",
    "@sortey/validators",
  ],

  typescript: { ignoreBuildErrors: true },

  // Security headers
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        // CORS for API routes
        source: "/api/:path*",
        headers: [
          {
            key: "Access-Control-Allow-Origin",
            value: process.env.CORS_ORIGIN ?? "*",
          },
          {
            key: "Access-Control-Allow-Methods",
            value: "GET, POST, PUT, DELETE, OPTIONS",
          },
          {
            key: "Access-Control-Allow-Headers",
            value: "Content-Type, Authorization, X-Request-ID",
          },
          {
            key: "Access-Control-Max-Age",
            value: "86400",
          },
        ],
      },
    ];
  },
};

const sentryConfig = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
};

// Apply i18n plugin conditionally, then Sentry if enabled
const configWithI18n = integrations.i18n ? withNextIntl(config) : config;
const isVinextRuntime = process.env.VINEXT === "1";

export default integrations.sentry && !isVinextRuntime
  ? withSentryConfig(configWithI18n, sentryConfig)
  : configWithI18n;
