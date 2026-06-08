import { describe, expect, it } from "vitest";

import type { LocationEvent, LocationState } from "../locations";
import { mergeLocations } from "../locations";

// Helper to build a location event with a stable shape; `updatedAt` accepts the
// same string|number|Date the wire/in-process clients can hand us.
function loc(
  userId: string,
  updatedAt: string | number | Date,
  over: Partial<LocationEvent> = {},
): LocationEvent {
  return {
    userId,
    lat: 41.25,
    lng: -95.93,
    heading: null,
    speed: null,
    updatedAt,
    ...over,
  };
}

describe("mergeLocations", () => {
  it("adds a new user to an empty state", () => {
    const out = mergeLocations({}, loc("u1", "2026-06-08T10:00:00Z"));
    expect(Object.keys(out)).toEqual(["u1"]);
    expect(out.u1?.lat).toBe(41.25);
  });

  it("adds a second, distinct user without dropping the first", () => {
    const a = mergeLocations({}, loc("u1", "2026-06-08T10:00:00Z"));
    const b = mergeLocations(a, loc("u2", "2026-06-08T10:00:01Z"));
    expect(Object.keys(b).sort()).toEqual(["u1", "u2"]);
  });

  it("replaces a user's position when a newer event arrives", () => {
    const prev: LocationState = {
      u1: loc("u1", "2026-06-08T10:00:00Z", { lat: 1, lng: 1 }),
    };
    const out = mergeLocations(
      prev,
      loc("u1", "2026-06-08T10:00:05Z", { lat: 2, lng: 2 }),
    );
    expect(out.u1?.lat).toBe(2);
    expect(out.u1?.lng).toBe(2);
  });

  it("ignores an older event for a known user (older loses)", () => {
    const prev: LocationState = {
      u1: loc("u1", "2026-06-08T10:00:05Z", { lat: 2, lng: 2 }),
    };
    const out = mergeLocations(
      prev,
      loc("u1", "2026-06-08T10:00:00Z", { lat: 9, lng: 9 }),
    );
    expect(out.u1?.lat).toBe(2);
    // ignored frames return the SAME reference so callers can skip re-render.
    expect(out).toBe(prev);
  });

  it("ignores an equal-aged event (strictly-newer wins only)", () => {
    const t = "2026-06-08T10:00:00Z";
    const prev: LocationState = { u1: loc("u1", t, { lat: 1, lng: 1 }) };
    const out = mergeLocations(prev, loc("u1", t, { lat: 9, lng: 9 }));
    expect(out.u1?.lat).toBe(1);
    expect(out).toBe(prev);
  });

  it("accepts Date, number, and ISO-string updatedAt for the newest-wins compare", () => {
    const prev = mergeLocations({}, loc("u1", new Date("2026-06-08T10:00:00Z")));
    // newer as epoch millis
    const out = mergeLocations(
      prev,
      loc("u1", Date.parse("2026-06-08T10:00:10Z"), { lat: 7 }),
    );
    expect(out.u1?.lat).toBe(7);
    // older as ISO string is ignored
    const out2 = mergeLocations(out, loc("u1", "2026-06-08T09:59:00Z", { lat: 0 }));
    expect(out2.u1?.lat).toBe(7);
  });

  it("treats a malformed updatedAt as oldest and never throws", () => {
    const prev: LocationState = {
      u1: loc("u1", "2026-06-08T10:00:00Z", { lat: 1 }),
    };
    // junk timestamp -> time 0 -> older than the known frame -> ignored.
    const out = mergeLocations(prev, loc("u1", "not-a-date", { lat: 9 }));
    expect(out.u1?.lat).toBe(1);
  });

  it("does not mutate its inputs", () => {
    const prev: LocationState = {
      u1: loc("u1", "2026-06-08T10:00:00Z", { lat: 1, lng: 1 }),
    };
    const snapshot = JSON.parse(JSON.stringify(prev));
    mergeLocations(prev, loc("u1", "2026-06-08T10:00:05Z", { lat: 2 }));
    expect(prev).toEqual(snapshot);
  });
});
