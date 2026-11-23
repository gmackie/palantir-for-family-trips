import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataflareNativeClient } from "../native";

const fakeClient = (distinctId: string | null = "dev_1") => {
  const client = {
    ready: Promise.resolve(),
    track: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    distinctId: vi.fn(() => distinctId),
  } satisfies DataflareNativeClient;
  return client;
};

const flagsResponse = (flags: Record<string, string>) =>
  vi.fn((_url: string, _init: { body: string }) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ flags }) }),
  );

// The native surface holds module state; each case gets a fresh module.
const load = () => import("../native");

beforeEach(() => {
  vi.resetModules();
});

describe("@sortey/analytics/native before init or when off", () => {
  it("is a no-op and every flag reads its default", async () => {
    const native = await load();
    expect(native.isDataflareNativeEnabled()).toBe(false);
    native.trackEventNative("post_created");
    native.identifyUserNative("usr_1");
    native.resetUserNative();
    expect(await native.isFeatureEnabledNative("beta", true)).toBe(true);
    expect(await native.getFeatureFlagNative("checkout", "control")).toBe(
      "control",
    );
    expect(
      await native.getFeatureFlagPayloadNative("checkout"),
    ).toBeUndefined();
    expect(await native.getExperimentNative("checkout")).toEqual({
      key: "checkout",
      variant: undefined,
    });
    const callback = vi.fn();
    native.onFeatureFlagsNative(callback)();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("sends nothing and fetches no flags with the kill switch thrown", async () => {
    const native = await load();
    const client = fakeClient();
    const fetch = flagsResponse({ beta: "on" });
    native.initDataflareNative({
      client,
      project: "acme",
      enabled: false,
      fetch,
    });
    native.trackEventNative("post_created");
    native.dataflareNativeSink.identify("usr_1");
    expect(client.track).not.toHaveBeenCalled();
    expect(client.identify).not.toHaveBeenCalled();
    expect(await native.isFeatureEnabledNative("beta")).toBe(false);
    await native.reloadFeatureFlagsNative();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("@sortey/analytics/native with Dataflare on", () => {
  it("forwards events with flat props only", async () => {
    const native = await load();
    const client = fakeClient();
    native.initDataflareNative({
      client,
      project: "acme",
      enabled: true,
      fetch: flagsResponse({}),
    });
    native.trackEventNative("post_created", {
      count: 2,
      tags: ["a"],
      meta: { a: 1 },
      none: null,
    });
    expect(client.track).toHaveBeenCalledWith("post_created", {
      count: 2,
      none: null,
    });
  });

  it("evaluates flags against the client's device id and the user", async () => {
    const native = await load();
    const client = fakeClient("dev_9");
    const fetch = flagsResponse({ beta: "on", checkout: "test" });
    native.initDataflareNative({
      client,
      host: "https://df.acme.dev",
      project: "acme",
      enabled: true,
      fetch,
    });
    expect(native.isDataflareNativeEnabled()).toBe(true);
    expect(await native.isFeatureEnabledNative("beta")).toBe(true);
    expect(await native.getFeatureFlagNative("checkout")).toBe("test");
    expect(await native.getFeatureFlagNative("missing", "control")).toBe(
      "control",
    );
    expect((await native.getExperimentNative("checkout")).variant).toBe("test");
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://df.acme.dev/f");
    expect(JSON.parse(init?.body ?? "{}")).toMatchObject({
      project: "acme",
      distinct_id: "dev_9",
      user_id: null,
    });

    native.dataflareNativeSink.identify("usr_1", { plan: "pro" });
    expect(client.identify).toHaveBeenCalledWith("usr_1", { plan: "pro" });
    await native.reloadFeatureFlagsNative();
    const last = fetch.mock.calls.at(-1);
    expect(JSON.parse(last?.[1].body ?? "{}").user_id).toBe("usr_1");

    native.dataflareNativeSink.reset();
    expect(client.reset).toHaveBeenCalledTimes(1);
    await native.reloadFeatureFlagsNative();
    expect(JSON.parse(fetch.mock.calls.at(-1)?.[1].body ?? "{}").user_id).toBe(
      null,
    );
  });

  it("defaults the host to observe.gmac.io", async () => {
    const native = await load();
    const fetch = flagsResponse({});
    native.initDataflareNative({
      client: fakeClient(),
      project: "acme",
      enabled: true,
      fetch,
    });
    await native.reloadFeatureFlagsNative();
    expect(fetch.mock.calls[0]?.[0]).toBe("https://observe.gmac.io/f");
  });

  it("records an exposure for an experiment the user is in", async () => {
    const native = await load();
    const client = fakeClient();
    native.initDataflareNative({
      client,
      project: "acme",
      enabled: true,
      fetch: flagsResponse({ checkout: "test" }),
    });
    native.trackExperimentExposureNative("checkout");
    await native.reloadFeatureFlagsNative();
    native.trackExperimentExposureNative("checkout");
    native.trackExperimentExposureNative("missing");
    expect(client.track).toHaveBeenCalledTimes(1);
    expect(client.track).toHaveBeenCalledWith("$exposure", {
      flag: "checkout",
      variant: "test",
    });
  });

  it("notifies flag subscribers after a load", async () => {
    const native = await load();
    native.initDataflareNative({
      client: fakeClient(),
      project: "acme",
      enabled: true,
      fetch: flagsResponse({ beta: "on" }),
    });
    const callback = vi.fn();
    const unsubscribe = native.onFeatureFlagsNative(callback);
    await native.reloadFeatureFlagsNative();
    expect(callback).toHaveBeenCalled();
    unsubscribe();
  });
});
