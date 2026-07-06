import { describe, expect, it } from "vitest";

import {
  assembleBriefing,
  type BriefingInput,
  type BriefingPoi,
  pickPoi,
} from "../briefing";
import type { ServiceAlert } from "../service";

function poi(
  partial: Partial<BriefingPoi> & { id: string; category: string },
): BriefingPoi {
  return { name: partial.id, lat: 0, lng: 0, milesAway: 5, ...partial };
}

const POIS: BriefingPoi[] = [
  poi({ id: "cowork", category: "coworking", milesAway: 8 }),
  poi({ id: "cafe1", category: "cafe", milesAway: 2 }),
  poi({ id: "cafe2", category: "cafe", milesAway: 6 }),
  poi({ id: "lib", category: "library", milesAway: 4 }),
  poi({ id: "rest", category: "restaurant", milesAway: 3 }),
  poi({ id: "trail", category: "trailhead", milesAway: 7 }),
  poi({ id: "camp", category: "campsite", milesAway: 10 }),
  poi({ id: "fuel", category: "fuel", milesAway: 1 }),
];

describe("pickPoi", () => {
  it("prefers earlier category, then nearer within a category", () => {
    expect(pickPoi(POIS, ["coworking", "cafe"])!.id).toBe("cowork");
    expect(pickPoi(POIS, ["cafe", "library"])!.id).toBe("cafe1"); // nearer cafe
    expect(pickPoi(POIS, ["library"])!.id).toBe("lib");
  });
  it("returns undefined when no category matches", () => {
    expect(pickPoi(POIS, ["propane"])).toBeUndefined();
  });
});

function baseInput(over: Partial<BriefingInput> = {}): BriefingInput {
  return {
    date: "2026-07-08",
    positionName: "Avery Park, WA",
    drive: { fromName: "Avery Park", toName: "Bend, OR", miles: 151, hours: 3 },
    stopName: "Bend, OR",
    weather: { highF: 84, lowF: 55, precipProbability: 10, label: "Clear" },
    serviceAlerts: [],
    pois: POIS,
    sunset: "20:41",
    ...over,
  };
}

const greyAlert: ServiceAlert = {
  resource: "grey",
  label: "Grey tank",
  levelPct: 84,
  daysUntil: 0,
  serviceCategory: "dump_station",
  urgency: "now",
  stop: { id: "d", name: "Dump X", lat: 0, lng: 0, milesAway: 4 },
};

describe("assembleBriefing", () => {
  it("puts a big drive in the morning and camp in the evening", () => {
    const b = assembleBriefing(baseInput());
    expect(b.schedule[0]!.part).toBe("morning");
    expect(b.schedule[0]!.title).toContain("Drive");
    const evening = b.schedule.find((s) => s.part === "evening");
    expect(evening!.title).toContain("Camp");
    expect(evening!.detail).toContain("20:41");
  });

  it("rain pushes work indoors and adds a note", () => {
    const b = assembleBriefing(
      baseInput({
        drive: null,
        weather: { highF: 60, lowF: 50, precipProbability: 80, label: "Rain" },
      }),
    );
    // parked + rainy → morning indoor work at the library (rain prefers library/cafe)
    expect(b.schedule[0]!.title).toMatch(/Indoor work/);
    expect(
      b.pois.work?.category === "library" || b.pois.work?.category === "cafe",
    ).toBe(true);
    expect(b.notes.some((n) => /Rain likely/.test(n))).toBe(true);
  });

  it("schedules an urgent service stop at midday", () => {
    const b = assembleBriefing(baseInput({ serviceAlerts: [greyAlert] }));
    const midday = b.schedule.find((s) => s.part === "midday");
    expect(midday!.title).toContain("Grey tank");
    expect(midday!.detail).toContain("Dump X");
    expect(b.serviceAlerts).toHaveLength(1);
  });

  it("pulls one useful POI per role", () => {
    const b = assembleBriefing(baseInput());
    expect(b.pois.food?.id).toBe("rest");
    expect(b.pois.experience?.id).toBe("trail");
    expect(b.pois.camp?.id).toBe("camp");
    expect(b.pois.fuel?.id).toBe("fuel");
  });

  it("flags a parked (no-drive) day", () => {
    const b = assembleBriefing(baseInput({ drive: null }));
    expect(b.notes.some((n) => /Parked day/.test(n))).toBe(true);
  });
});
