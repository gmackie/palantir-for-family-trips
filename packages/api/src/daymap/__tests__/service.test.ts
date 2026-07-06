import { describe, expect, it } from "vitest";

import {
  DEFAULT_RESOURCE_MODELS,
  daysUntilNeed,
  matchServiceStops,
  predictServiceNeeds,
  type ResourceModel,
  type ServicePoi,
} from "../service";

const grey = DEFAULT_RESOURCE_MODELS.find((m) => m.resource === "grey")!;
const fresh = DEFAULT_RESOURCE_MODELS.find((m) => m.resource === "fresh")!;

describe("daysUntilNeed", () => {
  it("fill: days for grey to rise to its threshold (85%)", () => {
    // 55% now, +30%/day → 30% headroom / 30 = 1.0 day
    expect(daysUntilNeed(55, 30, grey)).toBe(1);
  });
  it("drain: days for fresh to fall to its threshold (15%)", () => {
    // 75% now, -30%/day → 60% headroom / 30 = 2.0 days
    expect(daysUntilNeed(75, 30, fresh)).toBe(2);
  });
  it("returns 0 when already past threshold (due now)", () => {
    expect(daysUntilNeed(90, 30, grey)).toBe(0); // grey already > 85
    expect(daysUntilNeed(10, 30, fresh)).toBe(0); // fresh already < 15
  });
  it("returns null when rate is non-positive", () => {
    expect(daysUntilNeed(55, 0, grey)).toBeNull();
    expect(daysUntilNeed(55, -5, grey)).toBeNull();
  });
});

describe("predictServiceNeeds", () => {
  it("forecasts + sorts by urgency, tagging now/soon/ok", () => {
    const needs = predictServiceNeeds([
      { resource: "grey", levelPct: 82 }, // ~0.1 day → now
      { resource: "fresh", levelPct: 75 }, // 2 days → soon (<=2)
      { resource: "propane", levelPct: 90 }, // 7 days → ok
    ]);
    expect(needs.map((n) => n.resource)).toEqual(["grey", "fresh", "propane"]);
    expect(needs[0]!.urgency).toBe("now");
    expect(needs[1]!.urgency).toBe("soon");
    expect(needs[2]!.urgency).toBe("ok");
  });

  it("skips resources with no level reported", () => {
    const needs = predictServiceNeeds([{ resource: "grey", levelPct: 50 }]);
    expect(needs).toHaveLength(1);
    expect(needs[0]!.resource).toBe("grey");
  });

  it("maps each need to the right service category", () => {
    const needs = predictServiceNeeds([
      { resource: "grey", levelPct: 50 },
      { resource: "fresh", levelPct: 50 },
    ]);
    const byRes = Object.fromEntries(
      needs.map((n) => [n.resource, n.serviceCategory]),
    );
    expect(byRes.grey).toBe("dump_station");
    expect(byRes.fresh).toBe("water");
  });
});

describe("matchServiceStops", () => {
  const from = { lat: 45.7, lng: -121.5 }; // Columbia Gorge
  const pois: ServicePoi[] = [
    {
      id: "d1",
      name: "Far dump",
      category: "dump_station",
      lat: 47.0,
      lng: -122.0,
    },
    {
      id: "d2",
      name: "Near dump",
      category: "dump_station",
      lat: 45.8,
      lng: -121.6,
    },
    {
      id: "w1",
      name: "Water fill",
      category: "water",
      lat: 45.75,
      lng: -121.55,
    },
  ];

  it("matches each need to the nearest POI of its category", () => {
    const needs = predictServiceNeeds([
      { resource: "grey", levelPct: 84 },
      { resource: "fresh", levelPct: 20 },
    ]);
    const alerts = matchServiceStops(needs, pois, from);
    const grey = alerts.find((a) => a.resource === "grey")!;
    const fresh = alerts.find((a) => a.resource === "fresh")!;
    expect(grey.stop?.id).toBe("d2"); // nearer dump wins
    expect(fresh.stop?.id).toBe("w1");
    expect(grey.stop!.milesAway).toBeGreaterThan(0);
  });

  it("returns a null stop when no POI serves the category", () => {
    const needs = predictServiceNeeds([{ resource: "propane", levelPct: 25 }]);
    const alerts = matchServiceStops(needs, pois, from);
    expect(alerts[0]!.stop).toBeNull();
  });
});
