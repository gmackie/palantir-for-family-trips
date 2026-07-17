import { describe, expect, it } from "vitest";

import {
  defaultRouteForTrip,
  isActiveTripStatus,
  pickDefaultTrip,
} from "./active-trip-logic";

describe("pickDefaultTrip", () => {
  it("prefers the single en_route trip", () => {
    const trips = [
      { id: "a", status: "planning", startDate: "2026-07-01" },
      { id: "b", status: "en_route", startDate: "2026-07-10" },
    ];
    expect(pickDefaultTrip(trips)?.id).toBe("b");
  });

  it("prefers en_route among multiple actives", () => {
    const trips = [
      { id: "a", status: "active", startDate: "2026-07-01" },
      { id: "b", status: "en_route", startDate: "2026-07-05" },
    ];
    expect(pickDefaultTrip(trips)?.id).toBe("b");
  });

  it("falls back to last-opened when nothing is active", () => {
    const trips = [
      { id: "a", status: "planning", startDate: "2026-08-01" },
      { id: "b", status: "confirmed", startDate: "2026-07-20" },
    ];
    expect(pickDefaultTrip(trips, "a")?.id).toBe("a");
  });

  it("returns null for empty list", () => {
    expect(pickDefaultTrip([])).toBeNull();
  });

  it("picks the latest-starting active when several are active without en_route", () => {
    const trips = [
      { id: "a", status: "active", startDate: "2026-07-01" },
      { id: "b", status: "paused", startDate: "2026-07-10" },
      { id: "c", status: "active" }, // no startDate → treated as epoch 0
    ];
    expect(pickDefaultTrip(trips)?.id).toBe("b");
  });

  it("ignores a completed last-opened trip and falls back to soonest start", () => {
    const trips = [
      { id: "done", status: "completed", startDate: "2026-06-01" },
      { id: "later", status: "planning", startDate: "2026-09-01" },
      { id: "sooner", status: "confirmed", startDate: "2026-08-01" },
    ];
    expect(pickDefaultTrip(trips, "done")?.id).toBe("sooner");
  });

  it("sorts undated open trips after dated ones", () => {
    const trips = [
      { id: "undated", status: "planning" },
      { id: "dated", status: "planning", startDate: "2026-12-01" },
    ];
    expect(pickDefaultTrip(trips)?.id).toBe("dated");
  });

  it("returns the first trip when everything is completed", () => {
    const trips = [
      { id: "x", status: "completed", startDate: "2026-05-01" },
      { id: "y", status: "completed", startDate: "2026-04-01" },
    ];
    expect(pickDefaultTrip(trips)?.id).toBe("x");
  });
});

describe("defaultRouteForTrip", () => {
  it("sends moving active road trips to Drive", () => {
    const r = defaultRouteForTrip(
      { id: "t1", status: "en_route", tripMode: "roadtrip" },
      "moving",
    );
    expect(r.pathname).toContain("drive");
  });

  it("sends stopped active road trips to Today", () => {
    const r = defaultRouteForTrip(
      { id: "t1", status: "en_route", tripMode: "roadtrip" },
      "stopped",
    );
    expect(r.pathname).toContain("today");
  });

  it("sends planning trips to the trip hub", () => {
    const r = defaultRouteForTrip({
      id: "t1",
      status: "planning",
      tripMode: "roadtrip",
    });
    expect(r.pathname).toBe("/trip/[tripId]");
  });

  it("treats null tripMode as a road trip", () => {
    const r = defaultRouteForTrip(
      { id: "t1", status: "active", tripMode: null },
      "moving",
    );
    expect(r.pathname).toContain("drive");
  });

  it("accepts the road_trip spelling", () => {
    const r = defaultRouteForTrip(
      { id: "t1", status: "active", tripMode: "road_trip" },
      "stopped",
    );
    expect(r.pathname).toContain("today");
  });

  it("sends non-road active trips to the trip hub even while moving", () => {
    const r = defaultRouteForTrip(
      { id: "t1", status: "active", tripMode: "group" },
      "moving",
    );
    expect(r.pathname).toBe("/trip/[tripId]");
  });

  it("defaults unknown motion on an active road trip to Today", () => {
    const r = defaultRouteForTrip({ id: "t1", status: "en_route" });
    expect(r.pathname).toContain("today");
  });
});

describe("isActiveTripStatus", () => {
  it("recognizes en_route/active/paused", () => {
    expect(isActiveTripStatus("en_route")).toBe(true);
    expect(isActiveTripStatus("planning")).toBe(false);
  });
});
