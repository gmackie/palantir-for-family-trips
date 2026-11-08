import { afterEach, describe, expect, it, vi } from "vitest";

import {
  identifyUser,
  resetUser,
  TRIP_CREATED_PARAM,
  track,
  tripCreatedFlag,
  tripCreatedProps,
} from "./analytics";

// SAFETY: tests run in node; they install and remove a fake `window` global.
const g = globalThis as { window?: unknown };

afterEach(() => {
  delete g.window;
});

describe("analytics helper", () => {
  it("no-ops when window.dataflare is missing", () => {
    expect(() => track("trip_created")).not.toThrow();
    g.window = {};
    expect(() => track("trip_created", { n: 1 })).not.toThrow();
    expect(() => identifyUser("u1")).not.toThrow();
    expect(() => resetUser()).not.toThrow();
  });

  it("passes event names, ids and props through", () => {
    const dataflare = { track: vi.fn(), identify: vi.fn(), reset: vi.fn() };
    g.window = { dataflare };
    track("trip_created", { source: "test" });
    identifyUser(42, { role: "admin" });
    resetUser();
    expect(dataflare.track).toHaveBeenCalledWith("trip_created", {
      source: "test",
    });
    expect(dataflare.identify).toHaveBeenCalledWith("42", { role: "admin" });
    expect(dataflare.reset).toHaveBeenCalledOnce();
  });

  it("swallows errors thrown by the loader", () => {
    g.window = {
      dataflare: {
        track: () => {
          throw new Error("boom");
        },
        identify: () => {},
        reset: () => {},
      },
    };
    expect(() => track("trip_created")).not.toThrow();
  });
});

describe("trip_created flag", () => {
  it("round-trips the create action's redirect flag", () => {
    const flag = tripCreatedFlag("roadtrip", true);
    expect(tripCreatedProps(`?${TRIP_CREATED_PARAM}=${flag}`)).toEqual({
      trip_mode: "roadtrip",
      group_mode: true,
    });
    expect(
      tripCreatedProps(`?x=1&${TRIP_CREATED_PARAM}=destination-family`),
    ).toEqual({ trip_mode: "destination", group_mode: false });
  });

  it("ignores missing or unexpected values", () => {
    expect(tripCreatedProps("")).toBeNull();
    expect(
      tripCreatedProps(`?${TRIP_CREATED_PARAM}=someone@example.com`),
    ).toBeNull();
  });
});
