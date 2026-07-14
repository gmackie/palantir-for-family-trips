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
});

describe("isActiveTripStatus", () => {
  it("recognizes en_route/active/paused", () => {
    expect(isActiveTripStatus("en_route")).toBe(true);
    expect(isActiveTripStatus("planning")).toBe(false);
  });
});
