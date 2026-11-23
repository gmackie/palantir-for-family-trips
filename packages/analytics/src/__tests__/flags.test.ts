import { describe, expect, it, vi } from "vitest";

import {
  createDataflareFlags,
  type DataflareFlagsOptions,
  type FlagResponse,
  isFlagOn,
  readFlag,
  toFlagValue,
} from "../flags";

describe("flag value mapping", () => {
  it("reads on as true, a variant as itself, and off or holdout as nothing", () => {
    expect(toFlagValue("on")).toBe(true);
    expect(toFlagValue("test")).toBe("test");
    expect(toFlagValue("holdout")).toBeUndefined();
    expect(toFlagValue(null)).toBeUndefined();
    expect(toFlagValue(undefined)).toBeUndefined();
    expect(toFlagValue("")).toBeUndefined();
  });

  it("falls back to the caller's default", () => {
    expect(readFlag(null, "control")).toBe("control");
    expect(readFlag("test", "control")).toBe("test");
    expect(isFlagOn(null)).toBe(false);
    expect(isFlagOn(null, true)).toBe(true);
    expect(isFlagOn("on")).toBe(true);
    expect(isFlagOn("test")).toBe(true);
    expect(isFlagOn("holdout", true)).toBe(true);
  });
});

type FetchArgs = Parameters<NonNullable<DataflareFlagsOptions["fetch"]>>;

const respond = (body: FlagResponse, ok = true) =>
  vi.fn((..._args: FetchArgs) =>
    Promise.resolve({ ok, json: () => Promise.resolve(body) }),
  );

const options = (
  overrides: Partial<DataflareFlagsOptions> = {},
): DataflareFlagsOptions => ({
  host: "https://observe.example/",
  project: "acme",
  enabled: true,
  identity: () => ({ distinctId: "dev_1", userId: null }),
  ...overrides,
});

describe("createDataflareFlags", () => {
  it("posts the project and ids to /f and keeps the values", async () => {
    const fetch = respond({ flags: { beta: "on", checkout: "test" } });
    const flags = createDataflareFlags(
      options({
        fetch,
        identity: async () => ({ distinctId: "dev_1", userId: "usr_1" }),
      }),
    );
    expect(flags.loaded()).toBe(false);
    await flags.reload();
    expect(flags.loaded()).toBe(true);
    expect(flags.values()).toEqual({ beta: "on", checkout: "test" });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://observe.example/f");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body ?? "{}")).toEqual({
      project: "acme",
      distinct_id: "dev_1",
      user_id: "usr_1",
    });
  });

  it("sends nothing while off, and still reports loaded", async () => {
    const fetch = respond({ flags: { beta: "on" } });
    const flags = createDataflareFlags(options({ fetch, enabled: false }));
    const listener = vi.fn();
    flags.subscribe(listener);
    await flags.reload();
    expect(fetch).not.toHaveBeenCalled();
    expect(flags.values()).toEqual({});
    expect(flags.loaded()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("sends nothing without a device id", async () => {
    const fetch = respond({ flags: { beta: "on" } });
    const flags = createDataflareFlags(
      options({ fetch, identity: () => ({ distinctId: null, userId: null }) }),
    );
    await flags.reload();
    expect(fetch).not.toHaveBeenCalled();
    expect(flags.loaded()).toBe(true);
  });

  it("keeps the last values when a load fails, and never throws", async () => {
    let fail = false;
    const fetch = vi.fn((..._args: FetchArgs) =>
      fail
        ? Promise.reject(new Error("offline"))
        : Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ flags: { beta: "on" } }),
          }),
    );
    const flags = createDataflareFlags(options({ fetch }));
    await flags.reload();
    fail = true;
    await expect(flags.reload()).resolves.toBeUndefined();
    expect(flags.values()).toEqual({ beta: "on" });
  });

  it("ignores a non-OK answer and reads an absent flags field as none", async () => {
    const flags = createDataflareFlags(
      options({ fetch: respond({ flags: { beta: "on" } }, false) }),
    );
    await flags.reload();
    expect(flags.values()).toEqual({});
    const empty = createDataflareFlags(options({ fetch: respond({}) }));
    await empty.reload();
    expect(empty.values()).toEqual({});
  });

  it("notifies subscribers after each load until they unsubscribe", async () => {
    const flags = createDataflareFlags(
      options({ fetch: respond({ flags: {} }) }),
    );
    const listener = vi.fn();
    const broken = vi.fn(() => {
      throw new Error("listener bug");
    });
    flags.subscribe(broken);
    const unsubscribe = flags.subscribe(listener);
    await flags.reload();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    await flags.reload();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
