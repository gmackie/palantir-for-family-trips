import { describe, expect, it } from "vitest";

import {
  eachDateInclusive,
  openSauceApproachDraft,
  replanDraft,
} from "../day-plan";

describe("eachDateInclusive", () => {
  it("lists inclusive dates", () => {
    expect(eachDateInclusive("2026-07-11", "2026-07-13")).toEqual([
      "2026-07-11",
      "2026-07-12",
      "2026-07-13",
    ]);
  });

  it("returns empty when inverted", () => {
    expect(eachDateInclusive("2026-07-15", "2026-07-11")).toEqual([]);
  });

  it("handles single day", () => {
    expect(eachDateInclusive("2026-07-11", "2026-07-11")).toEqual([
      "2026-07-11",
    ]);
  });
});

describe("replanDraft", () => {
  it("packs must-visits left to right", () => {
    const days = replanDraft({
      fromDate: "2026-07-11",
      untilDate: "2026-07-13",
      mustVisits: [
        { name: "Bend", nights: 1 },
        { name: "Crater Lake", nights: 1 },
      ],
    });
    expect(days).toHaveLength(3);
    expect(days[0]?.overnightName).toBe("Bend");
    expect(days[1]?.overnightName).toBe("Crater Lake");
    expect(days[2]?.intent).toBe("position");
    expect(days[2]?.overnightName).toBeNull();
  });

  it("honors playDates over default drive", () => {
    const days = replanDraft({
      fromDate: "2026-07-11",
      untilDate: "2026-07-12",
      playDates: ["2026-07-11"],
      mustVisits: [{ name: "Bend", nights: 1 }],
    });
    expect(days[0]?.intent).toBe("play");
    expect(days[1]?.intent).toBe("position");
  });

  it("honors multi-night visits", () => {
    const days = replanDraft({
      fromDate: "2026-07-20",
      untilDate: "2026-07-22",
      mustVisits: [{ name: "Yosemite", nights: 3, intent: "play" }],
    });
    expect(days.every((d) => d.overnightName === "Yosemite")).toBe(true);
    expect(days.every((d) => d.intent === "play")).toBe(true);
  });

  it("marks eventDates as event intent", () => {
    const days = replanDraft({
      fromDate: "2026-07-17",
      untilDate: "2026-07-19",
      eventDates: ["2026-07-17", "2026-07-18", "2026-07-19"],
      mustVisits: [{ name: "San Mateo", nights: 3 }],
    });
    expect(days.every((d) => d.intent === "event")).toBe(true);
  });
});

describe("openSauceApproachDraft", () => {
  it("matches the Jul 11–15 dogfood plan", () => {
    const days = openSauceApproachDraft();
    expect(days.map((d) => d.date)).toEqual([
      "2026-07-11",
      "2026-07-12",
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
    ]);
    expect(days[0]?.intent).toBe("play");
    expect(days[0]?.overnightName).toBe("Bend");
    expect(days[0]?.heroTitle).toBe("Smith Rock");
    expect(days[1]?.overnightName).toBe("Crater Lake");
    expect(days[2]?.overnightName).toBe("Port Orford");
    expect(days[3]?.intent).toBe("play");
    expect(days[3]?.overnightName).toBe("Redwoods corridor");
    expect(days[4]?.intent).toBe("position");
    expect(days[4]?.overnightName).toBe("North Bay");
  });
});
