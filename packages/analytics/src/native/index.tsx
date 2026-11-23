/**
 * `@sortey/analytics/native`: product analytics and feature flags for the
 * Expo app, on Dataflare.
 *
 * Events go through the app's copy of `dataflare-native.ts` (DATFLR-14, in
 * apps/expo/src/lib, copied unchanged from glass-analytics); this package
 * only sees it through `DataflareNativeClient`, the structural subset it
 * drives, so it has no React Native dependency. Flags come from Dataflare's
 * `/f`, keyed by that client's device id (`../flags`).
 *
 * Nothing here reads `process.env`: the app resolves host, project and the
 * kill switch from its validated config and calls `initDataflareNative`
 * once. Before that, or with Dataflare off, every call is a no-op and every
 * flag read returns its default.
 */
import type { AnalyticsSink } from "../facade";
import {
  createDataflareFlags,
  type DataflareFlags,
  isFlagOn,
  readFlag,
} from "../flags";
import type {
  AnalyticsProperties,
  FeatureFlagPayload,
  FeatureFlagValue,
} from "../properties";

export type {
  AnalyticsProperties,
  AnalyticsValue,
  FeatureFlagPayload,
  FeatureFlagValue,
} from "../properties";

type NativeProps = Record<string, string | number | boolean | null | undefined>;

/** The part of `dataflare-native.ts`'s `DataflareClient` this package drives. */
export interface DataflareNativeClient {
  readonly ready: Promise<void>;
  track(event: string, props?: NativeProps): void;
  identify(userId: string, personProps?: NativeProps): void;
  reset(): void;
  distinctId(): string | null;
}

export interface DataflareNativeConfig {
  /** The app's `createDataflare(...)` client. */
  readonly client: DataflareNativeClient;
  /** Collector origin; the client's own default is https://observe.gmac.io. */
  readonly host?: string | undefined;
  /** The Dataflare project id; empty leaves flags off. */
  readonly project: string;
  /** False with the kill switch, the integration off, or no project. */
  readonly enabled: boolean;
  /** Injected for tests. */
  readonly fetch?: Parameters<typeof createDataflareFlags>[0]["fetch"];
}

const DEFAULT_HOST = "https://observe.gmac.io";

interface NativeState {
  readonly client: DataflareNativeClient;
  readonly flags: DataflareFlags;
  readonly enabled: boolean;
  userId: string | null;
}

let state: NativeState | null = null;

/** JSON values the native client cannot send become absent keys. */
const flatProps = (
  properties: AnalyticsProperties | undefined,
): NativeProps | undefined => {
  if (!properties) return undefined;
  const out: NativeProps = {};
  for (const [key, value] of Object.entries(properties)) {
    // Lists and nested objects are the only `Object` values a JSON bag holds.
    if (!(value instanceof Object)) out[key] = value;
  }
  return out;
};

/**
 * Wires the package to the app's Dataflare client and starts loading flags
 * (once the client has its stored device id). Call it once at startup;
 * a second call replaces the first (tests, fast refresh).
 */
export function initDataflareNative(config: DataflareNativeConfig): void {
  const host = config.host?.trim() || DEFAULT_HOST;
  const next: NativeState = {
    client: config.client,
    enabled: config.enabled,
    userId: null,
    flags: createDataflareFlags({
      host,
      project: config.project,
      enabled: config.enabled,
      fetch: config.fetch,
      identity: async () => {
        await config.client.ready;
        return {
          distinctId: config.client.distinctId(),
          userId: next.userId,
        };
      },
    }),
  };
  state = next;
  if (next.enabled) void next.flags.reload();
}

/** Whether `initDataflareNative` ran with Dataflare on. */
export function isDataflareNativeEnabled(): boolean {
  return state?.enabled ?? false;
}

export function trackEventNative(
  eventName: string,
  properties?: AnalyticsProperties,
): void {
  if (!state?.enabled) return;
  state.client.track(eventName, flatProps(properties));
}

/** Identifies by an opaque user id (never an email), then reloads flags. */
export function identifyUserNative(
  userId: string,
  properties?: AnalyticsProperties,
): void {
  if (!state?.enabled || !userId) return;
  state.client.identify(userId, flatProps(properties));
  state.userId = userId;
  void state.flags.reload();
}

export function resetUserNative(): void {
  if (!state?.enabled) return;
  state.client.reset();
  state.userId = null;
  void state.flags.reload();
}

/**
 * Dataflare as a facade sink (`createAnalytics`, `../facade`). Identify and
 * reset go through the functions above, so flags follow the user.
 */
export const dataflareNativeSink: AnalyticsSink = {
  track: (event, props) => trackEventNative(event, props),
  identify: (userId, props) => identifyUserNative(userId, props),
  reset: () => resetUserNative(),
};

// Feature flags. Async like the PostHog-era API: the first read waits for
// the first load.

const loadedFlags = async (): Promise<DataflareFlags | null> => {
  if (!state?.enabled) return null;
  const { flags } = state;
  if (!flags.loaded()) await flags.reload();
  return flags;
};

export async function isFeatureEnabledNative(
  flagKey: string,
  defaultValue = false,
): Promise<boolean> {
  const flags = await loadedFlags();
  if (!flags) return defaultValue;
  return isFlagOn(flags.values()[flagKey], defaultValue);
}

export async function getFeatureFlagNative(
  flagKey: string,
  defaultValue?: FeatureFlagValue,
): Promise<FeatureFlagValue | undefined> {
  const flags = await loadedFlags();
  if (!flags) return defaultValue;
  return readFlag(flags.values()[flagKey], defaultValue);
}

/** Payloads are not read on native yet; `undefined` keeps callers on defaults. */
export async function getFeatureFlagPayloadNative(
  _flagKey: string,
): Promise<FeatureFlagPayload> {
  return undefined;
}

export async function reloadFeatureFlagsNative(): Promise<void> {
  if (state?.enabled) await state.flags.reload();
}

/** Called after every flag load. Returns an unsubscribe function. */
export function onFeatureFlagsNative(callback: () => void): () => void {
  if (!state?.enabled) {
    callback();
    return () => {};
  }
  return state.flags.subscribe(callback);
}

export interface ExperimentNative {
  key: string;
  variant: FeatureFlagValue | undefined;
  payload?: FeatureFlagPayload;
}

export async function getExperimentNative(
  experimentKey: string,
): Promise<ExperimentNative> {
  return {
    key: experimentKey,
    variant: await getFeatureFlagNative(experimentKey),
  };
}

/**
 * Records that the user saw the experiment, as the web SDK does when a flag
 * is read: an `$exposure` event with the flag and its variant.
 */
export function trackExperimentExposureNative(experimentKey: string): void {
  if (!state?.enabled) return;
  const variant = state.flags.values()[experimentKey];
  if (variant === undefined) return;
  state.client.track("$exposure", { flag: experimentKey, variant });
}
