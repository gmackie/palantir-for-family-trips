import { describe, expect, it } from "vitest";

import { buildRecap, type RecapPin, type RecapSegment } from "../recap";

function seg(startDate: string, dest: string, miles: number): RecapSegment {
  return {
    name: `X → ${dest}`,
    destinationName: dest,
    distanceMiles: String(miles),
    startDate,
  };
}

const segs: RecapSegment[] = [
  seg("2026-06-29", "Mount Vernon, WA", 58),
  seg("2026-07-01", "Johnny Creek Campground, WA", 149),
  seg("2026-07-05", "Avery Park, WA", 29),
  seg("2026-07-08", "Bend, OR", 151), // future/planned
];

const pins: RecapPin[] = [
  { title: "Johnny Creek Campground", type: "campsite" },
  { title: "Blewett Pass camp", type: "campsite" },
  { title: "Some viewpoint", type: "scenic" },
];

describe("buildRecap", () => {
  it("recaps only traveled legs (startDate <= today), excluding planned", () => {
    const r = buildRecap(segs, pins, "2026-07-06");
    expect(r.stopCount).toBe(3); // Bend (7/08) excluded
    expect(r.totalMiles).toBe(58 + 149 + 29);
    expect(r.dateStart).toBe("2026-06-29");
    expect(r.dateEnd).toBe("2026-07-05");
    expect(r.days).toBe(7); // 6/29 → 7/05 inclusive
  });

  it("extracts states first-seen and counts camps", () => {
    const r = buildRecap(segs, pins, "2026-07-06");
    expect(r.states).toEqual(["WA"]);
    expect(r.campCount).toBe(2);
  });

  it("finds the longest traveled leg", () => {
    const r = buildRecap(segs, pins, "2026-07-06");
    expect(r.longestLeg).toEqual({
      name: "Johnny Creek Campground, WA",
      miles: 149,
    });
  });

  it("includes Bend + OR once today reaches 7/08", () => {
    const r = buildRecap(segs, pins, "2026-07-09");
    expect(r.stopCount).toBe(4);
    expect(r.states).toEqual(["WA", "OR"]);
  });
});
