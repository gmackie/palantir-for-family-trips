import { describe, expect, it } from "vitest";

import { rankPoisNear, suggestOvernightsAlongRoute } from "../poi-suggest";

const center = { lat: 44.06, lng: -121.31 };

const pois = [
  {
    id: "1",
    name: "Free BLM",
    category: "wild_camping",
    lat: 44.08,
    lng: -121.3,
    source: "ioverlander",
  },
  {
    id: "2",
    name: "KOA",
    category: "campsite",
    lat: 44.07,
    lng: -121.32,
    source: "ioverlander",
  },
  {
    id: "3",
    name: "Far camp",
    category: "wild_camping",
    lat: 45.5,
    lng: -121.3,
    source: "ioverlander",
  },
  {
    id: "4",
    name: "Dump",
    category: "dump_station",
    lat: 44.061,
    lng: -121.311,
    source: "ioverlander",
  },
];

describe("rankPoisNear", () => {
  it("filters by max miles and prefers sleep categories when asked", () => {
    const ranked = rankPoisNear(center, pois, {
      maxMiles: 30,
      preferSleep: true,
      categories: ["wild_camping", "campsite"],
    });
    expect(ranked.map((p) => p.id)).not.toContain("3");
    expect(ranked.map((p) => p.id)).not.toContain("4");
    // Free BLM should rank above or near KOA due to category bonus
    expect(ranked[0]!.category).toBe("wild_camping");
  });

  it("returns dump when that category is requested", () => {
    const ranked = rankPoisNear(center, pois, {
      categories: ["dump_station"],
      maxMiles: 5,
    });
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.name).toBe("Dump");
  });
});

describe("suggestOvernightsAlongRoute", () => {
  it("attaches suggestions per endpoint", () => {
    const result = suggestOvernightsAlongRoute(
      [{ date: "2026-07-11", name: "Bend", lat: 44.06, lng: -121.31 }],
      pois,
      { perEndpoint: 3, maxMiles: 30 },
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.suggestions.length).toBeGreaterThan(0);
    expect(result[0]!.date).toBe("2026-07-11");
  });
});

describe("amenity ranking edges", () => {
  it("surfaces tolls near an overnight center", () => {
    const withToll = [
      ...pois,
      {
        id: "t1",
        name: "Toll plaza",
        category: "toll",
        lat: 44.07,
        lng: -121.3,
        source: "ioverlander",
      },
    ];
    const ranked = rankPoisNear(center, withToll, {
      categories: ["toll"],
      maxMiles: 20,
    });
    expect(ranked[0]?.name).toBe("Toll plaza");
  });
});
