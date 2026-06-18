import { describe, expect, it } from "vitest";

import { TONE_HEX, trackingStatusTone, tripStatusTone } from "../status";

describe("tripStatusTone", () => {
  it("maps the trip lifecycle to tones", () => {
    expect(tripStatusTone("active")).toBe("success");
    expect(tripStatusTone("confirmed")).toBe("info");
    expect(tripStatusTone("planning")).toBe("warning");
    expect(tripStatusTone("en_route")).toBe("warning");
    expect(tripStatusTone("paused")).toBe("neutral");
    expect(tripStatusTone("completed")).toBe("neutral");
  });

  it("falls back to neutral for unknown statuses", () => {
    expect(tripStatusTone("???")).toBe("neutral");
  });
});

describe("trackingStatusTone", () => {
  it("maps arrival/tracking statuses to tones", () => {
    expect(trackingStatusTone("arrived")).toBe("success");
    expect(trackingStatusTone("scheduled")).toBe("info");
    expect(trackingStatusTone("en_route")).toBe("warning");
    expect(trackingStatusTone("delayed")).toBe("critical");
    expect(trackingStatusTone("cancelled")).toBe("neutral");
    expect(trackingStatusTone("???")).toBe("neutral");
  });
});

describe("TONE_HEX", () => {
  it("exposes the canonical palette for every tone", () => {
    expect(TONE_HEX.success).toBe("#3FB950");
    expect(TONE_HEX.warning).toBe("#D29922");
    expect(TONE_HEX.critical).toBe("#F85149");
    expect(TONE_HEX.info).toBe("#58A6FF");
    expect(TONE_HEX.neutral).toBe("#8B949E");
  });
});
