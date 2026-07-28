import { describe, expect, it } from "vitest";

import { computeLeaveBy, desiredArrivalFromSunset } from "../leave-by";

describe("computeLeaveBy", () => {
  it("is not late when enough time remains", () => {
    const now = new Date("2026-07-12T14:00:00Z");
    const arrival = new Date("2026-07-12T22:00:00Z"); // 8h later
    const r = computeLeaveBy({
      milesRemaining: 90, // 2h at 45mph
      now,
      desiredArrival: arrival,
      bufferHours: 0.5,
    });
    // leave by 22:00 - 2.5h = 19:30 UTC; slack from 14:00 = 5.5h
    expect(r.late).toBe(false);
    expect(r.driveHours).toBe(2);
    expect(r.minutesSlack).toBeGreaterThan(0);
  });

  it("marks late when leave-by is in the past", () => {
    const now = new Date("2026-07-12T20:00:00Z");
    const arrival = new Date("2026-07-12T21:00:00Z");
    const r = computeLeaveBy({
      milesRemaining: 200, // ~4.4h
      now,
      desiredArrival: arrival,
      bufferHours: 0.5,
    });
    expect(r.late).toBe(true);
    expect(r.minutesSlack).toBeLessThan(0);
  });

  it("handles zero miles", () => {
    const now = new Date("2026-07-12T12:00:00Z");
    const r = computeLeaveBy({
      milesRemaining: 0,
      now,
      desiredArrival: new Date("2026-07-12T18:00:00Z"),
    });
    expect(r.driveHours).toBe(0);
    expect(r.reason).toMatch(/Already at target/i);
  });
});

describe("desiredArrivalFromSunset", () => {
  it("uses sunset minus 1h when provided", () => {
    const sunset = new Date("2026-07-12T03:00:00Z");
    const d = desiredArrivalFromSunset(sunset, "2026-07-12");
    expect(d.getTime()).toBe(sunset.getTime() - 3_600_000);
  });

  it("falls back when no sunset", () => {
    const d = desiredArrivalFromSunset(null, "2026-07-12", 18);
    expect(d.getUTCHours()).toBe(18);
  });
});
