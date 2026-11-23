/**
 * observe.gmac.io analytics for the Sortey app (SORTEY-32, DATFLR-14).
 *
 * Reports screens and a few product events to the same observe project as the
 * web app (`trip`, see apps/nextjs/public/dataflare.js), using the dependency-free
 * client in ./dataflare-native.ts (copied unchanged from glass-analytics).
 *
 * Event names match the web app's journey events (apps/nextjs/src/lib/analytics.ts)
 * where the action is the same. Props are small enums or counts: never emails,
 * names, places or free text. Identify with the opaque better-auth user id only.
 *
 * Kill switch: EXPO_PUBLIC_DATAFLARE=off.
 *
 * The same client backs `@sortey/analytics/native` (initDataflareNative,
 * SORTEY-33), so its `*Native` event, identify and feature-flag functions
 * (flags from Dataflare's `/f`) work anywhere in the app.
 */
import {
  identifyUserNative,
  initDataflareNative,
  resetUserNative,
} from "@sortey/analytics/native";
import { isDataflareEnabled } from "@sortey/config";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import {
  createDataflare,
  type DataflareClient,
  type DataflareStorage,
} from "./dataflare-native";

export const OBSERVE_PROJECT = "trip";

export type AppEvent =
  // Shared with the web app.
  | "trip_created"
  | "invite_sent"
  | "invite_accepted"
  // Mobile key actions.
  | "stop_logged"
  | "expense_created";

export type AppEventProps = Record<string, string | number | boolean | null>;

/**
 * expo-secure-store as the client's id store. SecureStore keys only allow
 * [A-Za-z0-9._-], so the client's `dataflare:<project>:<id>` keys are mapped.
 */
export function secureStoreKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, "_");
}

export const secureStoreStorage: DataflareStorage = {
  getItem: (key) => SecureStore.getItemAsync(secureStoreKey(key)),
  setItem: (key, value) => SecureStore.setItemAsync(secureStoreKey(key), value),
  removeItem: (key) => SecureStore.deleteItemAsync(secureStoreKey(key)),
};

function appBuild(): string | null {
  const config = Constants.expoConfig;
  if (Platform.OS === "ios") return config?.ios?.buildNumber ?? null;
  if (Platform.OS === "android") {
    const code = config?.android?.versionCode;
    return code == null ? null : String(code);
  }
  return null;
}

const enabled =
  isDataflareEnabled() && process.env.EXPO_PUBLIC_DATAFLARE !== "off";

function createClient(): DataflareClient {
  return createDataflare({
    project: OBSERVE_PROJECT,
    storage: secureStoreStorage,
    app: { version: Constants.expoConfig?.version ?? null, build: appBuild() },
    platform: {
      os: Platform.OS,
      osVersion: Platform.Version,
      device: Platform.OS === "ios" && Platform.isPad ? "tablet" : "mobile",
    },
    enabled,
  });
}

export const analytics: DataflareClient = createClient();

initDataflareNative({ client: analytics, project: OBSERVE_PROJECT, enabled });

/** Analytics must never break the app. */
function safely(fn: () => unknown): void {
  try {
    const result = fn();
    if (result instanceof Promise) result.catch(() => {});
  } catch {
    // Ignore.
  }
}

export function track(event: AppEvent, props?: AppEventProps): void {
  safely(() => analytics.track(event, props));
}

export function trackScreen(pathname: string): void {
  if (!pathname) return;
  safely(() => analytics.screen(pathname));
}

export function flushAnalytics(): void {
  safely(() => analytics.flush());
}

/**
 * Follows the auth session: identify when a session starts or is restored,
 * reset once it ends. Returns the user id to remember for the next call.
 */
export function syncAnalyticsUser(
  previousUserId: string | null,
  userId: string | null,
): string | null {
  if (userId && userId !== previousUserId) {
    // Through the package so feature flags reload for the user.
    safely(() => identifyUserNative(userId));
  } else if (!userId && previousUserId) {
    safely(() => resetUserNative());
  }
  return userId;
}
