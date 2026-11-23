/**
 * The browser SDK starts only with the integration on, the kill switch not
 * thrown, and both the host and the project set, and always without
 * replay. Flags and experiments read through the running client and fall
 * back to their defaults while it is off. The suite runs in node, so
 * `window` is stubbed for the cases that need "in the browser".
 */
import type { GlassOptions } from "dataflare-web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DataflareWebClient } from "../web/dataflare";

type Listener = (flags: Readonly<Record<string, string>>) => void;

const fakeClient = (flagValues: Record<string, string> = {}) => {
  const inits: Array<GlassOptions> = [];
  const captured: Array<[string, unknown]> = [];
  const identified: Array<[string, unknown]> = [];
  const exposures: Array<string> = [];
  const consents: Array<boolean> = [];
  const listeners = new Set<Listener>();
  let resets = 0;
  let reloads = 0;
  const client: DataflareWebClient = {
    init: (options) => {
      inits.push(options);
    },
    capture: (event, props) => {
      captured.push([event, props]);
    },
    identify: (userId, props) => {
      identified.push([userId, props]);
    },
    reset: () => {
      resets += 1;
    },
    flag: (key) => {
      exposures.push(key);
      return flagValues[key] ?? null;
    },
    flags: () => flagValues,
    onFlags: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reloadFlags: () => {
      reloads += 1;
      return Promise.resolve();
    },
    consent: (granted) => {
      consents.push(granted);
    },
  };
  return {
    client,
    inits,
    captured,
    identified,
    exposures,
    consents,
    listeners,
    resets: () => resets,
    reloads: () => reloads,
    emit: () => {
      for (const listener of listeners) listener(flagValues);
    },
  };
};

// The running client is module state; each case gets a fresh module.
const loadSdk = () => import("../web/dataflare");
const loadWeb = () => import("../web/index");

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("window", {});
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const CONFIG = { host: "/_glass", project: "acme" };

describe("dataflareWebOptions", () => {
  it("is null when the host or the project is unset, or the integration is off", async () => {
    const { dataflareWebOptions } = await loadSdk();
    expect(dataflareWebOptions({}, true)).toBeNull();
    expect(dataflareWebOptions({ host: "/_glass" }, true)).toBeNull();
    expect(dataflareWebOptions({ project: "acme" }, true)).toBeNull();
    expect(
      dataflareWebOptions({ host: " ", project: "acme" }, true),
    ).toBeNull();
    expect(dataflareWebOptions(CONFIG, false)).toBeNull();
  });

  it("is null when the kill switch is thrown", async () => {
    const { dataflareWebOptions } = await loadSdk();
    expect(dataflareWebOptions({ ...CONFIG, enabled: false }, true)).toBeNull();
    expect(
      dataflareWebOptions({ ...CONFIG, enabled: true }, true),
    ).not.toBeNull();
  });

  it("is cookieless with replay off and autocapture on by default", async () => {
    const { dataflareWebOptions } = await loadSdk();
    expect(dataflareWebOptions(CONFIG, true)).toEqual({
      host: "/_glass",
      project: "acme",
      persistence: "cookieless",
      autocapture: true,
      replay: false,
    });
  });

  it("keeps a device id when the app asks for localStorage persistence", async () => {
    const { dataflareWebOptions } = await loadSdk();
    expect(
      dataflareWebOptions({ ...CONFIG, persistence: "localStorage" }, true)
        ?.persistence,
    ).toBe("localStorage");
  });
});

describe("initDataflareWeb", () => {
  it("does not initialise the SDK when the env is unset", async () => {
    const { initDataflareWeb, isDataflareWebActive, dataflareWebSink } =
      await loadSdk();
    const fake = fakeClient();
    expect(initDataflareWeb({}, fake.client, true)).toBe(false);
    expect(fake.inits).toEqual([]);
    expect(isDataflareWebActive()).toBe(false);
    dataflareWebSink().track("invite_sent", { role: "member" });
    expect(fake.captured).toEqual([]);
  });

  it("does not initialise on the server", async () => {
    vi.unstubAllGlobals();
    const { initDataflareWeb } = await loadSdk();
    const fake = fakeClient();
    expect(initDataflareWeb(CONFIG, fake.client, true)).toBe(false);
    expect(fake.inits).toEqual([]);
  });

  it("initialises once when configured, then the sink forwards", async () => {
    const { initDataflareWeb, dataflareWebSink, setAnalyticsConsent } =
      await loadSdk();
    const fake = fakeClient();
    expect(initDataflareWeb(CONFIG, fake.client, true)).toBe(true);
    expect(initDataflareWeb(CONFIG, fake.client, true)).toBe(true);
    expect(fake.inits).toHaveLength(1);
    const sink = dataflareWebSink();
    sink.track("invite_sent", { role: "member" });
    sink.identify("usr_1", { plan: "pro" });
    sink.reset();
    setAnalyticsConsent(true);
    expect(fake.captured).toEqual([["invite_sent", { role: "member" }]]);
    expect(fake.identified).toEqual([["usr_1", { plan: "pro" }]]);
    expect(fake.resets()).toBe(1);
    expect(fake.consents).toEqual([true]);
  });
});

describe("web flags and experiments", () => {
  it("return the defaults while Dataflare is off", async () => {
    const web = await loadWeb();
    expect(web.isFeatureEnabled("beta")).toBe(false);
    expect(web.isFeatureEnabled("beta", true)).toBe(true);
    expect(web.getFeatureFlag("checkout", "control")).toBe("control");
    expect(web.getFeatureFlagPayload("checkout")).toBeUndefined();
    expect(web.getExperiment("checkout")).toEqual({
      key: "checkout",
      variant: undefined,
    });
    const callback = vi.fn();
    web.onFeatureFlags(callback)();
    expect(callback).toHaveBeenCalledTimes(1);
    await expect(web.reloadFeatureFlags()).resolves.toBeUndefined();
    expect(() => web.trackExperimentExposure("checkout")).not.toThrow();
  });

  it("map Dataflare's answers onto the PostHog-era values", async () => {
    const sdk = await loadSdk();
    const web = await loadWeb();
    const fake = fakeClient({
      beta: "on",
      checkout: "test",
      held: "holdout",
    });
    sdk.initDataflareWeb(CONFIG, fake.client, true);
    expect(web.isFeatureEnabled("beta")).toBe(true);
    expect(web.getFeatureFlag("beta")).toBe(true);
    expect(web.getFeatureFlag("checkout")).toBe("test");
    expect(web.isFeatureEnabled("checkout")).toBe(true);
    // A holdout gets the default experience.
    expect(web.isFeatureEnabled("held")).toBe(false);
    expect(web.getFeatureFlag("held", "control")).toBe("control");
    // Off or unknown → the default.
    expect(web.isFeatureEnabled("missing", true)).toBe(true);
    expect(web.getFeatureFlag("missing")).toBeUndefined();
    expect(web.getExperiment("checkout").variant).toBe("test");
    web.trackExperimentExposure("checkout");
    // Every read went through flag(), which records Dataflare's exposure.
    expect(fake.exposures).toContain("checkout");
  });

  it("subscribe to flag loads and reload through the client", async () => {
    const sdk = await loadSdk();
    const web = await loadWeb();
    const fake = fakeClient({ beta: "on" });
    sdk.initDataflareWeb(CONFIG, fake.client, true);
    const callback = vi.fn();
    const unsubscribe = web.onFeatureFlags(callback);
    fake.emit();
    expect(callback).toHaveBeenCalledTimes(1);
    unsubscribe();
    fake.emit();
    expect(callback).toHaveBeenCalledTimes(1);
    await web.reloadFeatureFlags();
    expect(fake.reloads()).toBe(1);
  });
});

describe("web facade", () => {
  it("captures catalog and untyped events once Dataflare runs", async () => {
    const sdk = await loadSdk();
    const web = await loadWeb();
    const fake = fakeClient();
    web.captureEvent("legacy_event", { count: 1 });
    expect(fake.captured).toEqual([]);
    sdk.initDataflareWeb(CONFIG, fake.client, true);
    web.trackEvent("invite_sent", { role: "member" });
    web.captureEvent("legacy_event", { count: 1, email: "a@b.co" });
    web.identifyUser("usr_1", { plan: "pro" });
    expect(fake.captured).toEqual([
      ["invite_sent", { role: "member" }],
      ["legacy_event", { count: 1 }],
    ]);
    expect(fake.identified).toEqual([["usr_1", { plan: "pro" }]]);
  });
});
