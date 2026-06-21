import { describe, expect, it } from "vitest";

import { applyFerryGating } from "../route-planner";

interface Leg {
  id: string;
  destinationName: string | null;
  durationMinutes: number | null;
}

const legs: Leg[] = [
  {
    id: "seg-1",
    destinationName: "Edmonds",
    durationMinutes: 75,
  },
  {
    id: "seg-2",
    destinationName: "Olympic National Park",
    durationMinutes: 120,
  },
];

describe("applyFerryGating", () => {
  it("returns legs unchanged when there are no ferry crossings", () => {
    const result = applyFerryGating(legs, []);

    expect(result.legs).toHaveLength(2);
    for (const leg of result.legs) {
      expect(leg.ferry).toBeNull();
    }
    // No ferry => no non-driving minutes withheld from the budget.
    expect(result.totalNonDrivableMinutes).toBe(0);
  });

  it("attaches leaveBy + nonDrivableMinutes to the leg arriving at the departure terminal", () => {
    const result = applyFerryGating(legs, [
      {
        id: "ferry-1",
        departureTerminal: "Edmonds",
        afterSegmentId: null,
        scheduledDepartureAt: new Date("2026-07-09T14:05:00Z"),
        durationMinutes: 35,
        arrivalCutoffMinutes: 30,
      },
    ]);

    const arriving = result.legs.find((l) => l.id === "seg-1");
    const other = result.legs.find((l) => l.id === "seg-2");

    expect(other?.ferry).toBeNull();
    expect(arriving?.ferry).not.toBeNull();
    // 14:05 - 30 (cutoff) - 75 (drive to terminal) = 12:20
    expect(arriving?.ferry?.leaveBy?.toISOString()).toBe(
      "2026-07-09T12:20:00.000Z",
    );
    // 35 (crossing) + 30 (cutoff) = 65 non-driving minutes
    expect(arriving?.ferry?.nonDrivableMinutes).toBe(65);

    // The ferry's non-drivable time is NOT counted against the 12h driving
    // budget: it is reported as withheld non-driving time, not added to drive
    // minutes.
    expect(result.totalNonDrivableMinutes).toBe(65);
    expect(arriving?.durationMinutes).toBe(75);
  });

  it("matches by afterSegmentId in preference to terminal name", () => {
    const result = applyFerryGating(legs, [
      {
        id: "ferry-1",
        departureTerminal: "Edmonds",
        afterSegmentId: "seg-2",
        scheduledDepartureAt: null,
        durationMinutes: 40,
        arrivalCutoffMinutes: 20,
      },
    ]);

    const bySegment = result.legs.find((l) => l.id === "seg-2");
    const byName = result.legs.find((l) => l.id === "seg-1");

    expect(byName?.ferry).toBeNull();
    expect(bySegment?.ferry).not.toBeNull();
    // Unknown departure => leaveBy is null but non-drivable time still counts.
    expect(bySegment?.ferry?.leaveBy).toBeNull();
    expect(bySegment?.ferry?.nonDrivableMinutes).toBe(60);
    expect(result.totalNonDrivableMinutes).toBe(60);
  });
});
