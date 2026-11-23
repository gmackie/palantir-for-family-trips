/**
 * Dataflare (observe.gmac.io, or the app's own Dataflare) in the browser,
 * through the `dataflare-web` SDK bundled into the app.
 *
 * Why the SDK and not the journey loader (`/dataflare.js` + the collector's
 * `/s.js`): the web app serves a nonce-based CSP (`script-src 'self'
 * 'nonce-…'`). The SDK ships inside the app's own bundle, so the policy
 * needs no extra `script-src` at all, and its requests go to `connect-src`
 * (nothing extra either when the host is the same-origin `/_glass` proxy).
 * The loader would inject a second script from the collector's origin at
 * runtime, which that policy refuses unless it is widened or the nonce is
 * threaded through. The SDK is also typed, testable, and exposes flags.
 *
 * Off unless the `dataflare` integration is on, the kill switch is not
 * thrown, and both the host and the project are set. Every value comes from
 * the app's validated client config (`VITE_DATAFLARE_*` in apps/web's
 * `src/env.ts`); nothing here reads the environment. When on it runs:
 *
 * - `persistence`: `"cookieless"` by default: nothing is stored on the
 *   device, so no consent banner is needed; the Worker derives a
 *   daily-rotating id. Feature flags need a stable device id, so a
 *   cookieless visitor always reads the flag defaults; an app that uses
 *   flags sets `"localStorage"` (with whatever consent its audience needs)
 *   or calls `setAnalyticsConsent(true)` once consent is given.
 * - `replay: false`: session replay stays off, so `replay.js` is never
 *   loaded.
 * - autocapture on: page views, clicks, errors, web vitals.
 */
import { isDataflareEnabled } from "@sortey/config";
import type { GlassOptions } from "dataflare-web";
import { glass } from "dataflare-web";

import type { AnalyticsSink } from "../facade";

export type DataflarePersistence = "cookieless" | "localStorage";

export interface DataflareWebConfig {
  /** Collector origin, or the app's same-origin `/_glass` proxy. */
  readonly host?: string | undefined;
  /** The Dataflare project id (e.g. the app's observe.gmac.io project). */
  readonly project?: string | undefined;
  /** Kill switch from the app's config: `false` keeps the SDK unloaded. */
  readonly enabled?: boolean | undefined;
  /** Default `"cookieless"`; see the module comment for flags. */
  readonly persistence?: DataflarePersistence | undefined;
}

/** The part of the dataflare-web client this package drives. */
export interface DataflareWebClient {
  init(options: GlassOptions): void;
  capture(
    event: string,
    props?: Record<string, string | number | boolean | null>,
  ): void;
  identify(
    userId: string,
    personProperties?: Record<string, string | number | boolean | null>,
  ): void;
  reset(): void;
  /** `"on"`, a variant key, or null; records an `$exposure`. */
  flag(key: string): string | null;
  /** Every flag value, without recording exposures. */
  flags(): Readonly<Record<string, string>>;
  onFlags(
    listener: (flags: Readonly<Record<string, string>>) => void,
  ): () => void;
  reloadFlags(): Promise<void>;
  consent(granted: boolean): void;
}

/**
 * The SDK options for this config, or `null` when capture stays off (the
 * integration is off, the kill switch is thrown, or the host or the project
 * is unset).
 */
export const dataflareWebOptions = (
  config: DataflareWebConfig,
  enabled: boolean = isDataflareEnabled(),
): GlassOptions | null => {
  const host = config.host?.trim();
  const project = config.project?.trim();
  if (!enabled || config.enabled === false || !host || !project) return null;
  return {
    host,
    project,
    persistence: config.persistence ?? "cookieless",
    autocapture: true,
    replay: false,
  };
};

let active: DataflareWebClient | null = null;

/** Whether `initDataflareWeb` started the SDK in this page. */
export const isDataflareWebActive = (): boolean => active !== null;

/** The running client, or null before `initDataflareWeb` started one. */
export const activeDataflareWebClient = (): DataflareWebClient | null => active;

/**
 * Starts the SDK once, in the browser, when the config enables it. Returns
 * whether it is running. Call it before hydration (the app's client entry).
 */
export function initDataflareWeb(
  config: DataflareWebConfig,
  client: DataflareWebClient = glass,
  enabled: boolean = isDataflareEnabled(),
): boolean {
  if (active) return true;
  if (typeof window === "undefined") return false;
  const options = dataflareWebOptions(config, enabled);
  if (!options) return false;
  client.init(options);
  active = client;
  return true;
}

/**
 * Records the visitor's consent: `true` switches a cookieless page to a
 * persistent device id (flags start evaluating), `false` deletes stored ids
 * and goes cookieless. A no-op while the SDK is off.
 */
export function setAnalyticsConsent(granted: boolean): void {
  active?.consent(granted);
}

/** The facade's view of dataflare-web; a no-op until `initDataflareWeb` ran. */
export const dataflareWebSink = (): AnalyticsSink => ({
  track: (event, props) => active?.capture(event, props),
  identify: (userId, props) => active?.identify(userId, props),
  reset: () => active?.reset(),
});
