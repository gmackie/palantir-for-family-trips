/**
 * `@sortey/analytics/web`: product analytics and feature flags for the
 * browser, on Dataflare (`dataflare-web`, see ./dataflare for why the SDK
 * and not the journey loader). Nothing here reads `process.env`; the host,
 * project, kill switch and persistence come from the app's validated client
 * config through `initDataflareWeb`.
 *
 * - Events: `trackEvent` (typed against the `../events` catalog),
 *   `captureEvent` (untyped, for call sites that predate the catalog),
 *   `identifyUser` / `resetUser` / `syncUser`. All no-ops while Dataflare is
 *   off.
 * - Flags: `isFeatureEnabled`, `getFeatureFlag`, `onFeatureFlags`,
 *   `reloadFeatureFlags`, `useFeatureFlag`, evaluated by Dataflare's `/f`.
 *   Off, not yet loaded, or cookieless → the caller's default.
 * - Experiments: `getExperiment` / `trackExperimentExposure`; Dataflare
 *   records the exposure when the variant is read.
 */
import { isDataflareEnabled } from "@sortey/config";
import { useCallback, useSyncExternalStore } from "react";

import type { ClientEvents } from "../events";
import { createAnalytics } from "../facade";
import { isFlagOn, readFlag } from "../flags";
import type { FeatureFlagPayload, FeatureFlagValue } from "../properties";
import { activeDataflareWebClient, dataflareWebSink } from "./dataflare";

export type {
  ClientEventName,
  ClientEvents,
  PropsArg,
} from "../events";
export type {
  AnalyticsProperties,
  AnalyticsValue,
  FeatureFlagPayload,
  FeatureFlagValue,
} from "../properties";
export {
  type DataflarePersistence,
  type DataflareWebClient,
  type DataflareWebConfig,
  dataflareWebOptions,
  initDataflareWeb,
  isDataflareWebActive,
  setAnalyticsConsent,
} from "./dataflare";

/** The browser's analytics: Dataflare when the integration is on, else none. */
export const analytics = createAnalytics<ClientEvents>(
  isDataflareEnabled() ? [dataflareWebSink()] : [],
);

/** Sends a catalog event (`../events` `ClientEvents`) to Dataflare. */
export const trackEvent = analytics.trackEvent;
/** Sends an event outside the catalog (props scrubbed of PII). */
export const captureEvent = analytics.captureEvent;
/** Links later events to this opaque user id (never an email). */
export const identifyUser = analytics.identifyUser;
/** Forgets the user; call on sign-out. */
export const resetUser = analytics.resetUser;
/** Follows the signed-in user (id or `null`), identifying or resetting on change. */
export const syncUser = analytics.syncUser;

// Feature flags

/**
 * Whether the flag is on for this visitor: `"on"` or any variant but
 * `holdout`. Records an exposure, so read it where the feature is shown.
 */
export function isFeatureEnabled(
  flagKey: string,
  defaultValue = false,
): boolean {
  const client = activeDataflareWebClient();
  if (!client) return defaultValue;
  return isFlagOn(client.flag(flagKey), defaultValue);
}

/**
 * The flag's value: `true` for an on boolean flag, the variant key for a
 * multivariate one, or `defaultValue` when off, unknown or not loaded.
 * Records an exposure.
 */
export function getFeatureFlag(
  flagKey: string,
  defaultValue?: FeatureFlagValue,
): FeatureFlagValue | undefined {
  const client = activeDataflareWebClient();
  if (!client) return defaultValue;
  return readFlag(client.flag(flagKey), defaultValue);
}

/**
 * The flag's JSON payload. `dataflare-web` 0.8.x does not expose payloads
 * (0.9 adds `flagPayload`), so this is `undefined` until the SDK is bumped;
 * kept so call sites compile and fall back to their defaults.
 */
export function getFeatureFlagPayload(_flagKey: string): FeatureFlagPayload {
  return undefined;
}

/**
 * Calls `callback` once flags have loaded and whenever they change; at once
 * when Dataflare is off. Returns an unsubscribe function.
 */
export function onFeatureFlags(callback: () => void): () => void {
  const client = activeDataflareWebClient();
  if (!client) {
    callback();
    return () => {};
  }
  return client.onFlags(() => callback());
}

/** Fetches fresh flag values (after a plan change, say). */
export function reloadFeatureFlags(): Promise<void> {
  return activeDataflareWebClient()?.reloadFlags() ?? Promise.resolve();
}

const subscribeFlags = (onChange: () => void): (() => void) =>
  activeDataflareWebClient()?.onFlags(() => onChange()) ?? (() => {});

/**
 * The flag's value in a component, re-rendering when flags load or change.
 * `defaultValue` during SSR, while loading, and while Dataflare is off.
 * Reads without recording an exposure; pair it with
 * `trackExperimentExposure` where an experiment variant is shown.
 */
export function useFeatureFlag(
  flagKey: string,
  defaultValue?: FeatureFlagValue,
): FeatureFlagValue | undefined {
  const read = useCallback(
    () => readFlag(activeDataflareWebClient()?.flags()[flagKey], defaultValue),
    [flagKey, defaultValue],
  );
  return useSyncExternalStore(subscribeFlags, read, () => defaultValue);
}

/** `useFeatureFlag` as a boolean: on for `"on"` or any variant. */
export function useFeatureFlagEnabled(
  flagKey: string,
  defaultValue = false,
): boolean {
  const value = useFeatureFlag(flagKey);
  return value === undefined ? defaultValue : value !== false;
}

// A/B testing / experiments

export interface Experiment {
  key: string;
  variant: FeatureFlagValue | undefined;
  payload?: FeatureFlagPayload;
}

/** The experiment's variant for this visitor; reading it records the exposure. */
export function getExperiment(experimentKey: string): Experiment {
  return { key: experimentKey, variant: getFeatureFlag(experimentKey) };
}

/**
 * Records that the visitor saw the experiment. Dataflare counts an exposure
 * when the flag is read, once per page, so this reads it.
 */
export function trackExperimentExposure(experimentKey: string): void {
  activeDataflareWebClient()?.flag(experimentKey);
}
