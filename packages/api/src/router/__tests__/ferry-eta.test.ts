import { describe, expect, it } from "vitest";
import { computeLeaveBy, ferryNonDrivableMinutes } from "../ferry-eta";

describe("computeLeaveBy", () => {
  it("subtracts drive time + cutoff from departure", () => {
    const leaveBy = computeLeaveBy({
      scheduledDepartureAt: new Date("2026-07-09T14:05:00Z"),
      arrivalCutoffMinutes: 30,
      driveMinutesToTerminal: 75,
    });
    // 14:05 - 30 - 75 = 12:20
    expect(leaveBy?.toISOString()).toBe("2026-07-09T12:20:00.000Z");
  });

  it("returns null when departure unknown", () => {
    expect(
      computeLeaveBy({
        scheduledDepartureAt: null,
        arrivalCutoffMinutes: 30,
        driveMinutesToTerminal: 75,
      }),
    ).toBeNull();
  });

  it("does not mutate the input date", () => {
    const departure = new Date("2026-07-09T14:05:00Z");
    computeLeaveBy({
      scheduledDepartureAt: departure,
      arrivalCutoffMinutes: 30,
      driveMinutesToTerminal: 75,
    });
    expect(departure.toISOString()).toBe("2026-07-09T14:05:00.000Z");
  });
});

describe("ferryNonDrivableMinutes", () => {
  it("sums crossing duration with the arrival cutoff", () => {
    expect(
      ferryNonDrivableMinutes({
        durationMinutes: 35,
        arrivalCutoffMinutes: 30,
      }),
    ).toBe(65);
  });

  it("treats a null duration as zero", () => {
    expect(
      ferryNonDrivableMinutes({
        durationMinutes: null,
        arrivalCutoffMinutes: 30,
      }),
    ).toBe(30);
  });
});
