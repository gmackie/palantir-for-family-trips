import { describe, expect, it } from "vitest";

import { defaultSeedWorld, legHours } from "../seeds";
import { steerCopilot } from "../steer";

describe("steerCopilot", () => {
  it("stages Tracy for laundry / Bay camp tonight", () => {
    const r = steerCopilot({
      message: "we need laundry tonight near Tracy then Yosemite",
      today: "2026-07-14",
    });
    expect(r.options.length).toBeGreaterThan(0);
    expect(r.recommendedOptionId).toBe("opt:stage-tracy");
    expect(r.reply.toLowerCase()).toMatch(/tracy|laundry|bay/);
    expect(r.chrome?.tonightPlace).toBeTruthy();
  });

  it("answers Bryce to Denver hours from leg table", () => {
    const r = steerCopilot({
      message: "how long is the drive from Bryce to Denver on the 26th?",
    });
    expect(r.moveType).toBe("question");
    expect(r.reply).toMatch(/9\.3/);
    expect(r.options).toHaveLength(0);
  });

  it("recommends 2 Zion when hike preference", () => {
    const r = steerCopilot({
      message: "2 Zion or 2 Bryce? I care more about the hike",
      today: "2026-07-14",
    });
    expect(r.recommendedOptionId).toBe("opt:2zion-bryce-day-gj");
    expect(r.options.some((o) => o.id === "opt:2zion-bryce-day-gj")).toBe(true);
  });

  it("warns against Bryce overnight before Denver", () => {
    const r = steerCopilot({
      message: "should we sleep at Bryce then drive to Denver?",
      today: "2026-07-14",
    });
    const warn = r.options.find((o) => o.id === "opt:bryce-denver-same-day");
    expect(warn).toBeDefined();
    // The "Avoid:" option must never become the recommendation.
    expect(warn?.recommended).toBe(false);
    expect(r.recommendedOptionId).not.toBe("opt:bryce-denver-same-day");
    expect(r.reply.toLowerCase()).toMatch(/grand junction|gj|bryce/);
  });

  it("lists Costcos along the way", () => {
    const r = steerCopilot({
      message: "wheres the nearest costcos along the way",
    });
    expect(r.reply).toMatch(/Costco/i);
    expect(r.chrome?.facts?.some((f) => /Costco/i.test(f))).toBe(true);
  });
});

describe("legHours", () => {
  it("returns seed Bryce→Denver", () => {
    expect(legHours(defaultSeedWorld(), "node:bryce", "node:denver")).toBe(9.3);
  });
});
