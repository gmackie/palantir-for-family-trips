import Constants from "expo-constants";
import { selectSentryDsn } from "./sentry-dsn.js";

export type AppEnvironment = "development" | "staging" | "production";

interface ObservabilityConfig {
  sentryDsn?: string;
}

interface EnvironmentConfig {
  apiUrl: string;
  environment: AppEnvironment;
  isDevelopment: boolean;
  isStaging: boolean;
  isProduction: boolean;
  enableDebugMode: boolean;
  observability: ObservabilityConfig;
}

function getAppEnvironment(): AppEnvironment {
  const env = Constants.expoConfig?.extra?.APP_ENV ?? process.env.APP_ENV;
  if (env === "production") return "production";
  if (env === "staging") return "staging";
  return "development";
}

function getApiUrl(): string {
  const envApiUrl = Constants.expoConfig?.extra?.API_URL ?? process.env.API_URL;
  if (envApiUrl) return envApiUrl;

  const environment = getAppEnvironment();

  switch (environment) {
    case "production":
      return process.env.EXPO_PUBLIC_PRODUCTION_API_URL ?? "https://sortey.app";
    case "staging":
      return process.env.EXPO_PUBLIC_STAGING_API_URL ?? "https://sortey.app";
    case "development":
    default:
      return "https://sortey.app";
  }
}

function getObservabilityConfig(): ObservabilityConfig {
  const environment = getAppEnvironment();

  const sentryDsn = selectSentryDsn(
    Constants.expoConfig?.extra?.SENTRY_DSN,
    getSentryDsnForEnvironment(environment),
  );

  return {
    sentryDsn,
  };
}

function getSentryDsnForEnvironment(
  environment: AppEnvironment,
): string | undefined {
  switch (environment) {
    case "production":
      return selectSentryDsn(
        process.env.EXPO_PUBLIC_SENTRY_DSN_PROD,
        process.env.EXPO_PUBLIC_SENTRY_DSN,
      );
    case "staging":
      return selectSentryDsn(
        process.env.EXPO_PUBLIC_SENTRY_DSN_STAGING,
        process.env.EXPO_PUBLIC_SENTRY_DSN,
      );
    case "development":
    default:
      return selectSentryDsn(
        process.env.EXPO_PUBLIC_SENTRY_DSN_DEV,
        process.env.EXPO_PUBLIC_SENTRY_DSN,
      );
  }
}

export function getEnvConfig(): EnvironmentConfig {
  const environment = getAppEnvironment();

  return {
    apiUrl: getApiUrl(),
    environment,
    isDevelopment: environment === "development",
    isStaging: environment === "staging",
    isProduction: environment === "production",
    enableDebugMode: environment !== "production",
    observability: getObservabilityConfig(),
  };
}

export const env = getEnvConfig();

export function getBaseUrl(): string {
  return env.apiUrl;
}
