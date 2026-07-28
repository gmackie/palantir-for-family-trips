import { describe, expect, it } from "vitest";

import { type AnchorLike, anchorPacing, nextAnchor } from "../anchors";

function anchor(p: Partial<AnchorLike> & { startDate: string }): AnchorLike {
  return {
    id: p.id ?? p.startDate,
    title: p.title ?? "Anchor",
    kind: p.kind ?? "event",
    placeName: p.placeName ?? null,
    lat: p.lat ?? null,
    lng: p.lng ?? null,
    startDate: p.startDate,
    endDate: p.endDate ?? null,
  };
}

describe("nextAnchor", () => {
  it("picks the soonest upcoming anchor", () => {
    const a = nextAnchor(
      [
        anchor({ startDate: "2026-07-17", title: "Open Sauce" }),
        anchor({ startDate: "2026-07-10", title: "Yosemite booking" }),
        anchor({ startDate: "2026-08-01", title: "Wedding" }),
      ],
      "2026-07-06",
    );
    expect(a?.title).toBe("Yosemite booking");
  });

  it("keeps a multi-day anchor current until its endDate passes", () => {
    const during = nextAnchor(
      [anchor({ startDate: "2026-07-17", endDate: "2026-07-19", title: "OS" })],
      "2026-07-18",
    );
    expect(during?.title).toBe("OS");
    const after = nextAnchor(
      [anchor({ startDate: "2026-07-17", endDate: "2026-07-19", title: "OS" })],
      "2026-07-20",
    );
    expect(after).toBeNull();
  });
});

describe("anchorPacing", () => {
  it("computes days + miles + required miles/day", () => {
    // ~1 deg lat ≈ 69 mi; 2 deg north ≈ 138 mi, 2 days out → ~69 mi/day
    const p = anchorPacing(
      anchor({ startDate: "2026-07-08", lat: 47.0, lng: -121.0 }),
      { lat: 45.0, lng: -121.0 },
      "2026-07-06",
    );
    expect(p.daysUntil).toBe(2);
    expect(p.milesAway).toBeGreaterThan(120);
    expect(p.milesAway).toBeLessThan(150);
    expect(p.milesPerDay).toBe(Math.round(p.milesAway! / 2));
    expect(p.behind).toBe(false);
  });

  it("flags `behind` when the required pace exceeds a hard push", () => {
    // ~690 mi away, 1 day out → 690 mi/day → behind
    const p = anchorPacing(
      anchor({ startDate: "2026-07-07", lat: 55.0, lng: -121.0 }),
      { lat: 45.0, lng: -121.0 },
      "2026-07-06",
    );
    expect(p.behind).toBe(true);
  });

  it("has null distance when coords are missing", () => {
    const p = anchorPacing(
      anchor({ startDate: "2026-07-10" }),
      { lat: 45, lng: -121 },
      "2026-07-06",
    );
    expect(p.milesAway).toBeNull();
    expect(p.milesPerDay).toBeNull();
    expect(p.behind).toBe(false);
  });
});
