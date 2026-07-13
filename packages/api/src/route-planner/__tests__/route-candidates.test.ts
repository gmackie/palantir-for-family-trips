import { describe, expect, it } from "vitest";

import { labelRouteCandidates } from "../route-candidates";

describe("labelRouteCandidates", () => {
  it("labels a single route as Primary", () => {
    const out = labelRouteCandidates([
      { distanceMiles: 100, durationMinutes: 120 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.label).toBe("Primary");
  });

  it("labels a clearly shorter alternate as Shorter", () => {
    const out = labelRouteCandidates([
      { distanceMiles: 200, durationMinutes: 240 },
      { distanceMiles: 150, durationMinutes: 200 },
    ]);
    expect(out.some((c) => c.label === "Shorter")).toBe(true);
  });

  it("applies coastal vs inland when midpoints diverge west/east", () => {
    const out = labelRouteCandidates([
      {
        distanceMiles: 400,
        durationMinutes: 420,
        samplePoints: [
          { lat: 42, lng: -124 },
          { lat: 41, lng: -124 },
        ],
      },
      {
        distanceMiles: 410,
        durationMinutes: 400,
        samplePoints: [
          { lat: 42, lng: -122 },
          { lat: 41, lng: -121 },
        ],
      },
    ]);
    const labels = out.map((c) => c.label).join(" ");
    expect(labels.toLowerCase()).toMatch(/coast|inland/);
  });
});
