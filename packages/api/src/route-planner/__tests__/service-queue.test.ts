import { describe, expect, it } from "vitest";

import { buildServiceQueue } from "../service-queue";

const dump = {
  name: "Dump A",
  lat: 1,
  lng: 1,
  milesAway: 5,
};
const water = {
  name: "Water B",
  lat: 2,
  lng: 2,
  milesAway: 3,
};
const fuel = {
  name: "Fuel C",
  lat: 3,
  lng: 3,
  milesAway: 8,
};
const overnight = {
  name: "Camp D",
  lat: 4,
  lng: 4,
  milesAway: 12,
  category: "wild_camping",
};

describe("buildServiceQueue", () => {
  it("orders dump → water → fuel → sleep by default", () => {
    const q = buildServiceQueue({ dump, water, fuel, overnight });
    expect(q.map((s) => s.kind)).toEqual(["dump", "water", "fuel", "sleep"]);
  });

  it("elevates fuel when needFuel", () => {
    const q = buildServiceQueue({
      dump,
      water,
      fuel,
      overnight,
      needFuel: true,
    });
    expect(q[0]!.kind).toBe("fuel");
    expect(q.map((s) => s.kind)).toContain("sleep");
  });

  it("skips missing services", () => {
    const q = buildServiceQueue({ fuel, overnight });
    expect(q.map((s) => s.kind)).toEqual(["fuel", "sleep"]);
  });

  it("reads need dump from warnings text", () => {
    const q = buildServiceQueue({
      dump,
      water,
      fuel,
      overnight,
      warnings: ["No dump within 30mi of grey tank"],
    });
    expect(q[0]!.kind).toBe("dump");
  });
});
