import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  ready: Promise.resolve(),
  track: vi.fn(),
  screen: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  flush: vi.fn(() => Promise.resolve()),
  shutdown: vi.fn(),
  distinctId: vi.fn(() => null),
}));
const createDataflare = vi.hoisted(() => vi.fn(() => client));
const secureStore = vi.hoisted(() => ({
  getItemAsync: vi.fn(() => Promise.resolve("stored")),
  setItemAsync: vi.fn(() => Promise.resolve()),
  deleteItemAsync: vi.fn(() => Promise.resolve()),
}));

vi.mock("./dataflare-native", () => ({ createDataflare }));
vi.mock("expo-secure-store", () => secureStore);
vi.mock("expo-constants", () => ({
  default: { expoConfig: { version: "1.4.0", ios: { buildNumber: "42" } } },
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios", Version: "18.2", isPad: false },
}));

import {
  flushAnalytics,
  OBSERVE_PROJECT,
  secureStoreKey,
  secureStoreStorage,
  syncAnalyticsUser,
  track,
  trackScreen,
} from "./observe-analytics";

describe("observe analytics client", () => {
  it("creates one client for the web app's observe project", () => {
    expect(createDataflare).toHaveBeenCalledTimes(1);
    expect(createDataflare).toHaveBeenCalledWith({
      project: OBSERVE_PROJECT,
      storage: secureStoreStorage,
      app: { version: "1.4.0", build: "42" },
      platform: { os: "ios", osVersion: "18.2", device: "mobile" },
      enabled: true,
    });
    expect(OBSERVE_PROJECT).toBe("trip");
  });
});

describe("observe analytics wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records screens and skips empty paths", () => {
    trackScreen("/trip/abc/members");
    trackScreen("");
    expect(client.screen).toHaveBeenCalledTimes(1);
    expect(client.screen).toHaveBeenCalledWith("/trip/abc/members");
  });

  it("tracks typed events with their props", () => {
    track("trip_created", { trip_mode: "roadtrip", group_mode: true });
    expect(client.track).toHaveBeenCalledWith("trip_created", {
      trip_mode: "roadtrip",
      group_mode: true,
    });
  });

  it("never throws when the client does", () => {
    client.track.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    client.flush.mockImplementationOnce(() => Promise.reject(new Error("x")));
    expect(() => track("invite_sent", { method: "share_link" })).not.toThrow();
    expect(() => flushAnalytics()).not.toThrow();
  });

  it("identifies on session start or restore, once per user", () => {
    expect(syncAnalyticsUser(null, "user_1")).toBe("user_1");
    expect(syncAnalyticsUser("user_1", "user_1")).toBe("user_1");
    expect(client.identify).toHaveBeenCalledTimes(1);
    expect(client.identify).toHaveBeenCalledWith("user_1");
    syncAnalyticsUser("user_1", "user_2");
    expect(client.identify).toHaveBeenLastCalledWith("user_2");
    expect(client.reset).not.toHaveBeenCalled();
  });

  it("resets on sign-out but not while signed out", () => {
    expect(syncAnalyticsUser("user_1", null)).toBeNull();
    expect(client.reset).toHaveBeenCalledTimes(1);
    syncAnalyticsUser(null, null);
    expect(client.reset).toHaveBeenCalledTimes(1);
    expect(client.identify).not.toHaveBeenCalled();
  });
});

describe("secure store adapter", () => {
  it("maps client keys to SecureStore-safe keys", async () => {
    expect(secureStoreKey("dataflare:trip:distinct_id")).toBe(
      "dataflare_trip_distinct_id",
    );
    await expect(
      secureStoreStorage.getItem("dataflare:trip:user_id"),
    ).resolves.toBe("stored");
    await secureStoreStorage.setItem("dataflare:trip:user_id", "u");
    await secureStoreStorage.removeItem("dataflare:trip:user_id");
    expect(secureStore.getItemAsync).toHaveBeenCalledWith(
      "dataflare_trip_user_id",
    );
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      "dataflare_trip_user_id",
      "u",
    );
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(
      "dataflare_trip_user_id",
    );
  });
});
