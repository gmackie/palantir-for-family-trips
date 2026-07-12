import { describe, expect, it } from "vitest";

import {
  expandStopDays,
  injectLiveOrigin,
  itineraryLegs,
  openSauceFullStops,
  remainingStopsFromDate,
} from "../itinerary-template";

describe("openSauceFullStops", () => {
  it("covers Hood through Moab with Open Sauce + Yosemite + Bryce", () => {
    const stops = openSauceFullStops();
    const names = stops.map((s) => s.name);
    expect(names[0]).toMatch(/Hood|Zigzag/i);
    expect(names).toContain("Bend");
    expect(names).toContain("Crater Lake");
    expect(names).toContain("Port Orford");
    expect(names).toContain("San Mateo");
    expect(names.some((n) => n.includes("Yosemite"))).toBe(true);
    expect(names.some((n) => n.includes("Bryce"))).toBe(true);
    expect(names[names.length - 1]).toMatch(/Moab/i);
  });

  it("has Open Sauce and Ahwahnee anchors", () => {
    const stops = openSauceFullStops();
    const anchors = stops.filter((s) => s.anchor).map((s) => s.anchor!.title);
    expect(anchors).toContain("Open Sauce");
    expect(anchors).toContain("Ahwahnee");
  });
});

describe("expandStopDays", () => {
  it("expands San Mateo into buffer + event days", () => {
    const stop = openSauceFullStops().find((s) => s.name === "San Mateo")!;
    const days = expandStopDays(stop);
    expect(days.map((d) => d.date)).toEqual([
      "2026-07-16",
      "2026-07-17",
      "2026-07-18",
      "2026-07-19",
    ]);
    expect(days[0]?.intent).toBe("position");
    expect(days.slice(1).every((d) => d.intent === "event")).toBe(true);
  });

  it("gives Bend a play day after drive-in", () => {
    const stop = openSauceFullStops().find((s) => s.name === "Bend")!;
    const days = expandStopDays(stop);
    expect(days).toHaveLength(2);
    expect(days[0]?.intent).toBe("drive");
    expect(days[1]?.intent).toBe("play");
  });
});

describe("itineraryLegs", () => {
  it("chains consecutive stops for routing", () => {
    const legs = itineraryLegs(openSauceFullStops());
    expect(legs.length).toBeGreaterThan(8);
    expect(legs[0]?.from.name).toMatch(/Hood|Zigzag/i);
    expect(legs[0]?.to.name).toBe("Bend");
    expect(legs[legs.length - 1]?.to.name).toMatch(/Moab/i);
  });
});

describe("remainingStopsFromDate", () => {
  it("drops completed stops before fromDate", () => {
    const remaining = remainingStopsFromDate(
      openSauceFullStops(),
      "2026-07-12",
    );
    expect(remaining[0]?.name).toBe("Crater Lake");
    expect(remaining[0]?.isOrigin).toBe(true);
    expect(remaining.some((s) => s.name === "Bend")).toBe(false);
    expect(remaining[remaining.length - 1]?.name).toMatch(/Moab/i);
  });

  it("clamps an in-progress multi-night stay", () => {
    // San Mateo starts 16th with 3 extra nights through 19th.
    const remaining = remainingStopsFromDate(
      openSauceFullStops(),
      "2026-07-18",
    );
    expect(remaining[0]?.name).toBe("San Mateo");
    expect(remaining[0]?.date).toBe("2026-07-18");
    expect(remaining[0]?.isOrigin).toBe(true);
    const nights = expandStopDays(remaining[0]!);
    expect(nights[0]?.date).toBe("2026-07-18");
    expect(nights[nights.length - 1]?.date).toBe("2026-07-19");
  });
});

describe("injectLiveOrigin", () => {
  it("updates first stop when GPS is nearby", () => {
    const remaining = remainingStopsFromDate(
      openSauceFullStops(),
      "2026-07-12",
    );
    // Crater Lake ≈ 42.944, -122.109 — GPS almost there
    const withGps = injectLiveOrigin(
      remaining,
      { lat: 42.95, lng: -122.11, name: "Near rim" },
      "2026-07-12",
    );
    expect(withGps[0]?.name).toBe("Crater Lake");
    expect(withGps[0]?.lat).toBeCloseTo(42.95, 2);
    expect(withGps[0]?.isOrigin).toBe(true);
    expect(withGps).toHaveLength(remaining.length);
  });

  it("prepends GPS when far from next stop", () => {
    const remaining = remainingStopsFromDate(
      openSauceFullStops(),
      "2026-07-12",
    );
    // Bend coords while next stop is Crater
    const withGps = injectLiveOrigin(
      remaining,
      { lat: 44.058, lng: -121.315, name: "Still in Bend" },
      "2026-07-12",
    );
    expect(withGps[0]?.name).toBe("Still in Bend");
    expect(withGps[0]?.isOrigin).toBe(true);
    expect(withGps[1]?.name).toBe("Crater Lake");
    expect(withGps[1]?.isOrigin).toBe(false);
    const legs = itineraryLegs(withGps);
    expect(legs[0]?.from.name).toBe("Still in Bend");
    expect(legs[0]?.to.name).toBe("Crater Lake");
  });
});
