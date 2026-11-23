/**
 * Feature flags from Dataflare (`POST <host>/f`), shared by the browser and
 * native surfaces. Dependency-free (`@sortey/analytics/flags`).
 *
 * Dataflare answers a flag with `"on"`, a variant key, or nothing (off, or
 * not targeted). The public API keeps the PostHog-era shape the apps were
 * written against: a boolean flag reads `true`, a multivariate flag reads
 * its variant key, and an off or unknown flag reads the caller's default.
 *
 * Flags need a stable device id: Dataflare buckets by it, and returns no
 * flags for a cookieless browser (see `DataflareWebConfig.persistence`).
 */
import type { FeatureFlagValue } from "./properties";

/** What the Worker's `/f` returns for one person. */
export interface FlagValues {
  readonly [key: string]: string;
}

/**
 * Dataflare's answer for one flag as the app reads it: `"on"` → `true`,
 * `"holdout"` (an experiment holdout gets the default experience) and no
 * answer → `undefined`, any other variant key → itself.
 */
export const toFlagValue = (
  raw: string | null | undefined,
): FeatureFlagValue | undefined => {
  if (raw === undefined || raw === null || raw === "" || raw === "holdout")
    return undefined;
  return raw === "on" ? true : raw;
};

/** `toFlagValue` with the caller's default for an off or unknown flag. */
export const readFlag = (
  raw: string | null | undefined,
  defaultValue?: FeatureFlagValue,
): FeatureFlagValue | undefined => toFlagValue(raw) ?? defaultValue;

/** Whether a flag is on for this person: any value but off and holdout. */
export const isFlagOn = (
  raw: string | null | undefined,
  defaultValue = false,
): boolean => {
  const value = toFlagValue(raw);
  return value === undefined ? defaultValue : value !== false;
};

/** The ids `/f` buckets and targets by. */
export interface FlagIdentity {
  /** The device id; without one `/f` returns no flags. */
  readonly distinctId: string | null;
  /** The opaque user id after `identify`, for person-targeted rules. */
  readonly userId: string | null;
}

/**
 * The body of Dataflare's `POST /f` (packages/worker/src/flags.ts in
 * glass-analytics): flag key → `"on"` or a variant key. Off flags are
 * absent. The same contract `dataflare-web` reads.
 */
export interface FlagResponse {
  readonly flags?: FlagValues | undefined;
}

export interface DataflareFlagsOptions {
  /** Collector origin (or the app's `/_glass` proxy). */
  readonly host: string;
  readonly project: string;
  /** Off (the kill switch, or no project): every read returns the default. */
  readonly enabled: boolean;
  readonly identity: () => FlagIdentity | Promise<FlagIdentity>;
  /** Injected for tests; defaults to the global `fetch`. */
  readonly fetch?: (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ) => Promise<{ ok: boolean; json(): Promise<FlagResponse> }>;
}

/** Flag reads for a surface whose SDK has none of its own (React Native). */
export interface DataflareFlags {
  /** The last values `/f` returned (empty until the first load). */
  readonly values: () => FlagValues;
  /** Whether a load finished (successfully or not). */
  readonly loaded: () => boolean;
  /** Fetches fresh values; never throws, keeps the old ones on failure. */
  readonly reload: () => Promise<void>;
  /** Called after every load. Returns an unsubscribe function. */
  readonly subscribe: (listener: () => void) => () => void;
}

export function createDataflareFlags(
  options: DataflareFlagsOptions,
): DataflareFlags {
  let values: FlagValues = {};
  let loaded = false;
  const listeners = new Set<() => void>();
  const host = options.host.replace(/\/+$/, "");

  const notify = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // A listener failing must not stop the others.
      }
    }
  };

  const reload = async (): Promise<void> => {
    if (!options.enabled || !options.project || !host) {
      loaded = true;
      notify();
      return;
    }
    try {
      const identity = await options.identity();
      if (!identity.distinctId) return;
      const send = options.fetch ?? globalThis.fetch;
      const res = await send(`${host}/f`, {
        method: "POST",
        // text/plain keeps the request "simple" (no CORS preflight), as the
        // web SDK does.
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          project: options.project,
          distinct_id: identity.distinctId,
          user_id: identity.userId,
        }),
      });
      if (res.ok) values = (await res.json()).flags ?? {};
    } catch {
      // Offline or the collector is down: keep the last values.
    } finally {
      loaded = true;
      notify();
    }
  };

  return {
    values: () => values,
    loaded: () => loaded,
    reload,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
