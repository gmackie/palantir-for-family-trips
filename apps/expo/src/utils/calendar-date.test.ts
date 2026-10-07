import { describe, expect, it } from "vitest";
import { formatCalendarDate } from "./calendar-date";

describe("calendar date labels", () => {
  it("keeps captured October6–8 range dates", () => {
    expect(
      `${formatCalendarDate("2026-10-06")} – ${formatCalendarDate("2026-10-08")}`,
    ).toBe("Oct 6, 2026 – Oct 8, 2026");
  });
  it.each([
    ["2026-01-01", "Jan 1, 2026"],
    ["2026-03-08", "Mar 8, 2026"],
    ["2026-11-01", "Nov 1, 2026"],
    ["2024-02-29", "Feb 29, 2024"],
  ])("keeps %s as %s", (date, label) => {
    expect(formatCalendarDate(date)).toBe(label);
  });
  it("preserves segment weekday format", () => {
    expect(
      formatCalendarDate("2026-10-06", {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    ).toBe("Tue, Oct 6");
  });
  it("does not apply a caller timezone offset to a calendar date", () => {
    expect(
      formatCalendarDate("2026-10-06", {
        dateStyle: "medium",
        timeZone: "America/Los_Angeles",
      }),
    ).toBe("Oct 6, 2026");
  });
  it("retains empty-date label", () => {
    expect(formatCalendarDate(null)).toBe("");
    expect(formatCalendarDate("")).toBe("");
  });
  it.each([
    "2026-02-30",
    "2026-13-01",
    "2026-10-06T00:00:00Z",
    "not-a-date",
  ])("rejects a non-calendar date %s", (value) => {
    expect(() => formatCalendarDate(value)).toThrow();
  });
});
