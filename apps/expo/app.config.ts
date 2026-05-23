import type { ConfigContext, ExpoConfig } from "expo/config";

const APP_ENV = process.env.APP_ENV ?? "development";
const API_URL = process.env.API_URL ?? "https://trip.gmac.io";
const ASSOCIATED_DOMAIN =
  process.env.EXPO_PUBLIC_APP_DOMAIN ?? "change-me.example.com";

const SENTRY_DSN = process.env.SENTRY_DSN;
const POSTHOG_KEY = process.env.POSTHOG_KEY;
const POSTHOG_HOST = process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";

const getAppName = (): string => {
  switch (APP_ENV) {
    case "production":
      return "Sortie";
    case "staging":
      return "Sortie (Beta)";
    default:
      return "Sortie (Dev)";
  }
};

const getBundleId = (): string => {
  // Scaffold note: replace these app identifiers and domains before store submission.
  const base = "com.gmacko.sortie";
  switch (APP_ENV) {
    case "production":
      return base;
    case "staging":
      return `${base}.beta`;
    default:
      return `${base}.dev`;
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

  if (sentryPlugin) {
    plugins.push(sentryPlugin as [string, Record<string, unknown>]);
  }

  return {
    ...config,
    name: getAppName(),
    slug: "sortie",
    scheme: "sortie",
    version: "0.1.0",
    orientation: "portrait",
    icon: "./assets/icon-light.png",
    userInterfaceStyle: "automatic",
    runtimeVersion: "0.1.0",
    assetBundlePatterns: ["**/*"],
    ios: {
      bundleIdentifier: getBundleId(),
      supportsTablet: true,
      usesAppleSignIn: true,
      associatedDomains: [`applinks:${ASSOCIATED_DOMAIN}`],
      icon: {
        light: "./assets/icon-light.png",
        dark: "./assets/icon-dark.png",
      },
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
        foregroundImage: "./assets/icon-light.png",
        backgroundColor: "#0D1B2A",
      },
    },
    extra: {
      APP_ENV,
      API_URL,
      SENTRY_DSN,
      POSTHOG_KEY,
      POSTHOG_HOST,
      eas: {
        projectId: "5f21337f-9f48-4b0c-8d02-656e4a08dc86",
      },
    },
    owner: process.env.EXPO_OWNER,
    experiments: {
      tsconfigPaths: true,
      typedRoutes: true,
      reactCanary: true,
      reactCompiler: true,
    },
    plugins,
  };
};
