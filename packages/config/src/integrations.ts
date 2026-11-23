export const integrations = {
  // Monitoring & Analytics (default ON)
  sentry: true,
  // Product analytics and feature flags: Dataflare (observe.gmac.io, project
  // `trip`). Web loads public/dataflare.js; mobile uses the DATFLR-14 client
  // (apps/expo/src/utils/observe-analytics.ts). EXPO_PUBLIC_DATAFLARE=off is
  // the mobile kill switch.
  dataflare: true,

  // Payments - Web (default OFF)
  stripe: false,

  // Payments - Mobile (default OFF)
  revenuecat: false,

  // Push Notifications — Expo push token registration + trip alerts
  notifications: true,

  // Communication (default OFF)
  email: {
    enabled: true,
    provider: "resend" as "resend" | "sendgrid" | "none",
  },

  // Realtime (polling with SSE upgrade path)
  realtime: {
    enabled: true,
    provider: "sse" as "pusher" | "ably" | "sse" | "none",
  },

  // Storage (Cloudflare R2)
  storage: {
    enabled: true,
    provider: "r2" as "uploadthing" | "r2" | "none",
  },

  // Internationalization (default OFF)
  i18n: true,

  // OpenAPI documentation (default OFF)
  openapi: false,
} as const;

export type Integrations = typeof integrations;

export const saasFeatures = {
  collaboration: false,
  billing: false,
  metering: false,
  support: false,
  launch: false,
  referrals: false,
  operatorApis: false,
} as const;

export type SaasFeatures = typeof saasFeatures;

export const tenancy = {
  mode: "single-tenant" as "single-tenant" | "multi-tenant",
} as const;

export type Tenancy = typeof tenancy;

export const platformPrimitives = {
  featureFlags: {
    enabled: true,
    provider: "local" as const,
  },
  jobs: {
    enabled: true,
    provider: "local" as const,
  },
  rateLimits: {
    enabled: true,
    scopes: [
      "auth",
      "contact",
      "signup",
      "api-keys",
      "operator-api",
      "chat",
      "share-link",
    ] as const,
  },
  botProtection: {
    enabled: true,
    provider: "local-rate-limit" as const,
  },
  compliance: {
    enabled: true,
    dataExport: true,
    dataDeletion: true,
  },
  emailDelivery: {
    enabled: integrations.email.enabled,
    provider: integrations.email.provider,
    requiredEnv:
      integrations.email.enabled && integrations.email.provider === "resend"
        ? (["RESEND_API_KEY"] as const)
        : ([] as const),
  },
} as const;

export type PlatformPrimitives = typeof platformPrimitives;

export const isSentryEnabled = () => integrations.sentry;
export const isDataflareEnabled = () => integrations.dataflare;
export const isStripeEnabled = () => integrations.stripe;
export const isRevenueCatEnabled = () => integrations.revenuecat;
export const isNotificationsEnabled = () => integrations.notifications;
export const isEmailEnabled = () => integrations.email.enabled;
export const isRealtimeEnabled = () => integrations.realtime.enabled;
export const isStorageEnabled = () => integrations.storage.enabled;
export const isI18nEnabled = () => integrations.i18n;
export const isOpenApiEnabled = () => integrations.openapi;
export const isSaasCollaborationEnabled = () => saasFeatures.collaboration;
export const isSaasBillingEnabled = () => saasFeatures.billing;
export const isSaasMeteringEnabled = () => saasFeatures.metering;
export const isSaasSupportEnabled = () => saasFeatures.support;
export const isSaasLaunchEnabled = () => saasFeatures.launch;
export const isSaasReferralsEnabled = () => saasFeatures.referrals;
export const isSaasOperatorApisEnabled = () => saasFeatures.operatorApis;
export const isSingleTenant = () => tenancy.mode === "single-tenant";
export const isMultiTenant = () => tenancy.mode === "multi-tenant";
export const isEmailDeliveryEnabled = () =>
  platformPrimitives.emailDelivery.enabled;
