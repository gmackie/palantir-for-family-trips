import type { ConfigContext, ExpoConfig } from "expo/config";

type AppVariant = "development" | "preview" | "production";

const APP_VARIANT: AppVariant = (() => {
  const variant = process.env.APP_VARIANT;
  if (variant === "production" || variant === "preview") return variant;
  return "development";
})();

// Keep APP_ENV available to runtime consumers (src/config/env.ts) — derived
// from APP_VARIANT so the two stay in sync.
const APP_ENV = APP_VARIANT;
const API_URL = process.env.API_URL ?? "https://sortey.app";
const GOOGLE_MAPS_API_KEY =
  process.env.GOOGLE_MAPS_API_KEY ??
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ??
  "";
const ASSOCIATED_DOMAIN = process.env.EXPO_PUBLIC_APP_DOMAIN ?? "sortey.app";

const SENTRY_DSN =
  process.env.SENTRY_DSN ??
  (APP_VARIANT === "production"
    ? process.env.EXPO_PUBLIC_SENTRY_DSN_PROD
    : APP_VARIANT === "preview"
      ? process.env.EXPO_PUBLIC_SENTRY_DSN_STAGING
      : process.env.EXPO_PUBLIC_SENTRY_DSN_DEV);
const POSTHOG_KEY =
  process.env.POSTHOG_KEY ??
  (APP_VARIANT === "production"
    ? process.env.EXPO_PUBLIC_POSTHOG_KEY_PROD
    : APP_VARIANT === "preview"
      ? process.env.EXPO_PUBLIC_POSTHOG_KEY_STAGING
      : process.env.EXPO_PUBLIC_POSTHOG_KEY_DEV);
const POSTHOG_HOST =
  process.env.POSTHOG_HOST ??
  process.env.EXPO_PUBLIC_POSTHOG_HOST ??
  "https://us.i.posthog.com";

// Production bundle id. Each variant gets a distinct id/name/scheme so all
// three install side-by-side.
const BASE_BUNDLE_ID = "com.gmacko.sortey";
const BASE_SCHEME = "sortey";
const EAS_PROJECT_ID = "5f21337f-9f48-4b0c-8d02-656e4a08dc86";

const getVariantIcon = (): string => {
  if (APP_VARIANT === "development") return "./assets/icon-dev.png";
  if (APP_VARIANT === "preview") return "./assets/icon-preview.png";
  return "./assets/icon-light.png";
};

const getAppName = (): string => {
  switch (APP_VARIANT) {
    case "production":
      return "Sortey";
    case "preview":
      return "Sortey (Preview)";
    default:
      return "Sortey (Dev)";
  }
};

const getBundleId = (): string => {
  switch (APP_VARIANT) {
    case "production":
      return BASE_BUNDLE_ID;
    case "preview":
      return `${BASE_BUNDLE_ID}.preview`;
    default:
      return `${BASE_BUNDLE_ID}.dev`;
  }
};

const getScheme = (): string => {
  switch (APP_VARIANT) {
    case "production":
      return BASE_SCHEME;
    case "preview":
      return `${BASE_SCHEME}-preview`;
    default:
      return `${BASE_SCHEME}-dev`;
  }
};

const getSentryConfig = () => {
  if (!SENTRY_DSN) return null;

  try {
    require.resolve("@sentry/react-native/expo");
  } catch {
    return null;
  }

  return [
    "@sentry/react-native/expo",
    {
      organization: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
    },
  ];
};

export default ({ config }: ConfigContext): ExpoConfig => {
  const sentryPlugin = getSentryConfig();
  const plugins: ExpoConfig["plugins"] = [
    "expo-apple-authentication",
    "expo-router",
    "expo-secure-store",
    "expo-web-browser",
    ["react-native-maps", { iosGoogleMapsApiKey: GOOGLE_MAPS_API_KEY }],
    [
      "expo-splash-screen",
      {
        backgroundColor: "#F0F4F8",
        image: "./assets/icon-light.png",
        dark: {
          backgroundColor: "#0D1B2A",
          image: "./assets/icon-dark.png",
        },
      },
    ],
  ];

  plugins.push([
    "expo-share-intent",
    {
      iosShareExtensionName: "SorteyShare",
      // One App Group shared across all variants (registered in the portal),
      // instead of the plugin default group.<bundleId> which would need a
      // separate group per dev/preview/prod.
      iosAppGroupIdentifier: "group.com.gmacko.sortey",
      iosActivationRules: {
        NSExtensionActivationSupportsImageWithMaxCount: 20,
      },
    },
  ] as [string, Record<string, unknown>]);

  if (sentryPlugin) {
    plugins.push(sentryPlugin as [string, Record<string, unknown>]);
  }

  return {
    ...config,
    name: getAppName(),
    slug: "sortie",
    scheme: getScheme(),
    version: "0.1.0",
    orientation: "portrait",
    icon: getVariantIcon(),
    userInterfaceStyle: "automatic",
    // OTA updates may only target binaries with an identical native runtime.
    // Fingerprinting changes this value whenever native dependencies or native
    // configuration change, while ordinary JS/assets changes remain OTA-safe.
    runtimeVersion: { policy: "fingerprint" },
    updates: {
      url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
      checkAutomatically: "ON_LOAD",
      fallbackToCacheTimeout: 0,
    },
    assetBundlePatterns: ["**/*"],
    ios: {
      bundleIdentifier: getBundleId(),
      supportsTablet: true,
      usesAppleSignIn: true,
      associatedDomains: [`applinks:${ASSOCIATED_DOMAIN}`],
      icon:
        APP_VARIANT === "production"
          ? {
              light: "./assets/icon-light.png",
              dark: "./assets/icon-dark.png",
            }
          : getVariantIcon(),
      infoPlist: {
        CFBundleDisplayName: getAppName(),
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: getBundleId(),
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          data: [
            {
              scheme: "https",
              host: ASSOCIATED_DOMAIN,
              pathPrefix: "/",
            },
          ],
          category: ["BROWSABLE", "DEFAULT"],
        },
      ],
      adaptiveIcon: {
        foregroundImage:
          APP_VARIANT === "production"
            ? "./assets/icon-light.png"
            : getVariantIcon(),
        backgroundColor:
          APP_VARIANT === "development"
            ? "#4a6de5"
            : APP_VARIANT === "preview"
              ? "#eef2fb"
              : "#0D1B2A",
      },
    },
    extra: {
      APP_ENV,
      API_URL,
      GOOGLE_MAPS_API_KEY,
      SENTRY_DSN,
      POSTHOG_KEY,
      POSTHOG_HOST,
      eas: {
        projectId: EAS_PROJECT_ID,
      },
    },
    owner: "gmacko",
    experiments: {
      tsconfigPaths: true,
      typedRoutes: true,
      reactCanary: true,
      reactCompiler: true,
    },
    plugins,
  };
};
