import { describe, expect, it } from "vitest";

import { steerCopilot } from "../steer";

/**
 * Branch coverage for the steer rules engine beyond the seed happy paths:
 * empty input, the general fallback, heat-preference ordering, the framing
 * branch, and the unknown-leg drive-fact fallback.
 */
describe("steerCopilot branches", () => {
  it("empty message prompts for input without options", () => {
    const r = steerCopilot({ message: "   ", today: "2026-07-14" });
    expect(r.moveType).toBe("general");
    expect(r.options).toHaveLength(0);
    expect(r.reply).toMatch(/Say what changed/);
  });

  it("unmatched message falls back to the capability hint", () => {
    const r = steerCopilot({ message: "hello there", today: "2026-07-14" });
    expect(r.moveType).toBe("general");
    expect(r.reply).toMatch(/co-pilot/);
    expect(r.options).toHaveLength(0);
  });

  it("heat preference flips the recommendation away from the hike default", () => {
    const hike = steerCopilot({
      message: "2 Zion or 2 Bryce? I care more about the hike",
      today: "2026-07-14",
    });
    const heat = steerCopilot({
      message: "2 Zion or 2 Bryce? the heat is melting us",
      today: "2026-07-14",
    });
    expect(hike.moveType).toBe("ask_options");
    expect(heat.moveType).toBe("ask_options");
    expect(heat.recommendedOptionId).toBeDefined();
    expect(heat.recommendedOptionId).not.toBe(hike.recommendedOptionId);
    expect(heat.reply.toLowerCase()).toContain("heat");
  });

  it("framing message stages tonight with an anchor-aware chrome", () => {
    const r = steerCopilot({
      message: "leaving the bay, headed to yosemite",
      today: "2026-07-14",
    });
    expect(r.moveType).toBe("frame");
    expect(r.options.length).toBeGreaterThan(0);
    expect(r.recommendedOptionId).toBeDefined();
    expect(r.chrome?.tonightPlace).toBeTruthy();
    expect(r.reply).toMatch(/Yosemite/i);
  });

  it("drive-time question about an unknown leg admits it instead of guessing", () => {
    const r = steerCopilot({
      message: "how far is it from Paris to Rome?",
      today: "2026-07-14",
    });
    expect(r.moveType).toBe("question");
    expect(r.options).toHaveLength(0);
    expect(r.reply).toMatch(/known leg/);
  });
});
