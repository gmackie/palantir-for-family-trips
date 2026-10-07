import { describe, expect, it } from "vitest";
import { resolveTripTimezone, tripCalendarDay } from "./trip-day";

describe("trip calendar day", () => {
  it.each([
    ["2026-10-07T04:32:50Z", "America/Los_Angeles", "2026-10-06"],
    ["2026-10-07T06:59:59Z", "America/Los_Angeles", "2026-10-06"],
    ["2026-10-07T07:00:00Z", "America/Los_Angeles", "2026-10-07"],
    ["2026-10-06T16:00:00Z", "Asia/Tokyo", "2026-10-07"],
    ["2026-03-08T07:59:59Z", "America/Los_Angeles", "2026-03-07"],
    ["2026-03-08T08:00:00Z", "America/Los_Angeles", "2026-03-08"],
    ["2026-03-08T10:00:00Z", "America/Los_Angeles", "2026-03-08"],
    ["2026-11-01T08:30:00Z", "America/Los_Angeles", "2026-11-01"],
    ["2026-11-01T09:30:00Z", "America/Los_Angeles", "2026-11-01"],
    ["2027-01-01T00:30:00Z", "America/Los_Angeles", "2026-12-31"],
  ])("%s in %s selects %s", (instant, tz, expected) => {
    expect(tripCalendarDay(new Date(instant), tz)).toBe(expected);
  });
  it("falls back to UTC for invalid stored timezone", () => {
    expect(resolveTripTimezone("Review/Invalid")).toBe("UTC");
    expect(
      tripCalendarDay(new Date("2026-10-07T04:32:50Z"), "Review/Invalid"),
    ).toBe("2026-10-07");
  });
  it("rejects invalid clock input", () => {
    expect(() => tripCalendarDay(new Date(NaN), "UTC")).toThrow();
  });
});
