import { describe, expect, it } from "vitest";

import type { BriefingPoi } from "../briefing";
import {
  DEFAULT_BATTERY_RESERVE_PCT,
  findWorkWindows,
  type PowerState,
} from "../work-window";

const GOOD_POWER: PowerState = { batterySoc: 90 };
const UP = { status: "up" as const, source: "starlink" };

const CAFE: BriefingPoi = {
  id: "poi_cafe",
  name: "Moab Coffee Roasters",
  category: "cafe",
  lat: 38.57,
  lng: -109.55,
  milesAway: 1.2,
};

const plan = (over: Partial<Parameters<typeof findWorkWindows>[0]> = {}) =>
  findWorkWindows({
    drive: null,
    power: GOOD_POWER,
    connectivity: UP,
    ...over,
  });

describe("findWorkWindows — the day's shape", () => {
  it("offers every part of a parked day, longest block first", () => {
    const { windows, blockers } = plan();
    expect(blockers).toEqual([]);
    expect(windows.map((w) => w.part)).toEqual([
      "morning",
      "afternoon",
      "midday",
      "evening",
    ]);
    expect(windows[0]?.hours).toBe(3);
  });

  it("gives up the parts the drive consumes", () => {
    // A five-hour drive eats the morning and midday.
    const { windows } = plan({
      drive: { fromName: "Bryce", toName: "Moab", miles: 250, hours: 5 },
    });
    expect(windows.map((w) => w.part)).toEqual(["afternoon", "evening"]);
  });

  it("says so when the whole day is the wheel", () => {
    const { windows, blockers } = plan({
      drive: { fromName: "A", toName: "B", miles: 700, hours: 11 },
    });
    expect(windows).toEqual([]);
    expect(blockers[0]).toMatch(/Driving all day/);
  });
});

describe("findWorkWindows — power is a hard gate", () => {
  it("refuses a day that would eat the reserve", () => {
    // Working down to a cold night is not a window, it is a decision.
    const { windows, blockers } = plan({
      power: { batterySoc: DEFAULT_BATTERY_RESERVE_PCT },
    });
    expect(windows).toEqual([]);
    expect(blockers[0]).toMatch(/at or below the 40% reserve/);
  });

  it("allows a low battery that is actively charging", () => {
    const { windows, blockers } = plan({
      power: { batterySoc: 20, charging: true },
    });
    expect(blockers).toEqual([]);
    expect(windows.length).toBeGreaterThan(0);
    expect(windows[0]?.because).toMatch(/charging/);
  });

  it("names the battery level in the reason when running off the house bank", () => {
    expect(plan().windows[0]?.because).toMatch(/battery 90%/);
  });
});

describe("findWorkWindows — connectivity", () => {
  it("plans nothing with no connection, and says which", () => {
    const { windows, blockers } = plan({
      connectivity: { status: "down", source: "starlink" },
    });
    expect(windows).toEqual([]);
    expect(blockers[0]).toMatch(/No connection \(starlink\)/);
  });

  it("still offers windows on a patchy signal, flagged", () => {
    // Plenty of work survives a bad connection; the traveller can judge.
    const { windows, blockers } = plan({
      connectivity: { status: "degraded" },
    });
    expect(blockers).toEqual([]);
    expect(windows[0]?.because).toMatch(/signal is patchy/);
  });
});

describe("findWorkWindows — missing readings", () => {
  it("asks for the reading instead of guessing", () => {
    // The alternative is inventing a battery level, which is how a plan
    // becomes a lie.
    expect(plan({ power: null }).blockers[0]).toMatch(/No power reading/);
    expect(plan({ connectivity: null }).blockers[0]).toMatch(
      /No connectivity reading/,
    );
  });

  it("reports every missing input at once, not one per attempt", () => {
    const { blockers } = plan({ power: null, connectivity: null });
    expect(blockers).toHaveLength(2);
  });
});

describe("findWorkWindows — a place to work", () => {
  it("anchors mid-day blocks to the cafe and leaves the rest wherever you are", () => {
    const { windows } = plan({ workPlace: CAFE });
    const byPart = new Map(windows.map((w) => [w.part, w]));
    expect(byPart.get("midday")?.place?.name).toBe("Moab Coffee Roasters");
    expect(byPart.get("afternoon")?.place?.id).toBe("poi_cafe");
    // A morning or evening detour to a cafe is not worth the drive.
    expect(byPart.get("morning")?.place).toBeNull();
    expect(byPart.get("evening")?.place).toBeNull();
  });

  it("mentions the detour distance so it can be judged", () => {
    const { windows } = plan({ workPlace: CAFE });
    const midday = windows.find((w) => w.part === "midday");
    expect(midday?.because).toMatch(/1\.2 mi away/);
  });
});
