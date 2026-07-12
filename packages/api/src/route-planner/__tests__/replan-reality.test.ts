import { describe, expect, it } from "vitest";

import { replanDraft } from "../day-plan";

/**
 * replan-reality buildReplanPreview needs DB; pure replanDraft coverage here
 * for the soft_days core used by reality presets.
 */
describe("replanDraft (soft_days core)", () => {
  it("fills range with drive by default", () => {
    const days = replanDraft({
      fromDate: "2026-07-13",
      untilDate: "2026-07-15",
    });
    expect(days).toHaveLength(3);
    expect(days.every((d) => d.date >= "2026-07-13")).toBe(true);
  });

  it("places must-visits", () => {
    const days = replanDraft({
      fromDate: "2026-07-13",
      untilDate: "2026-07-16",
      mustVisits: [{ name: "Port Orford", nights: 1, intent: "drive" }],
    });
    expect(days.some((d) => d.title === "Port Orford")).toBe(true);
  });
});
