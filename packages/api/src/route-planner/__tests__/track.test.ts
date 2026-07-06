import { describe, expect, it } from "vitest";

import { buildTrackStats, downsamplePath, type TrackPoint } from "../track";

function pt(lat: number, lng: number, min: number): TrackPoint {
  const t = new Date(Date.parse("2026-07-06T00:00:00Z") + min * 60_000);
  return { lat, lng, recordedAt: t.toISOString() };
}

describe("buildTrackStats", () => {
  it("is empty for no points", () => {
    const s = buildTrackStats([]);
    expect(s.points).toBe(0);
    expect(s.actualMiles).toBe(0);
    expect(s.bounds).toBeNull();
  });

  it("sums consecutive hops into driven miles + bounds", () => {
    // ~1 deg of latitude ≈ 69 mi; two 0.1-deg hops ≈ 13.8 mi
    const s = buildTrackStats([
      pt(45.0, -121.0, 0),
      pt(45.1, -121.0, 10),
      pt(45.2, -121.0, 20),
    ]);
    expect(s.points).toBe(3);
    expect(s.actualMiles).toBeGreaterThan(12);
    expect(s.actualMiles).toBeLessThan(15);
    expect(s.bounds).toEqual({
      minLat: 45.0,
      maxLat: 45.2,
      minLng: -121.0,
      maxLng: -121.0,
    });
  });

  it("orders out-of-order batches by time", () => {
    const s = buildTrackStats([pt(45.2, -121, 20), pt(45.0, -121, 0)]);
    expect(s.firstAt).toBe(pt(45.0, -121, 0).recordedAt);
    expect(s.lastAt).toBe(pt(45.2, -121, 20).recordedAt);
  });

  it("ignores parked jitter (sub-30m hops)", () => {
    const s = buildTrackStats([
      pt(45.0, -121.0, 0),
      pt(45.00001, -121.00001, 1), // ~1.5m — jitter
      pt(45.00002, -121.0, 2),
    ]);
    expect(s.actualMiles).toBe(0);
  });

  it("drops absurd single hops as bad fixes", () => {
    const s = buildTrackStats([
      pt(45.0, -121.0, 0),
      pt(10.0, 40.0, 1), // teleport — bad fix
      pt(45.1, -121.0, 2),
    ]);
    // The two good endpoints are ~7 mi apart via the bad point, both hops huge → dropped
    expect(s.actualMiles).toBe(0);
  });
});

describe("downsamplePath", () => {
  it("returns input unchanged when under the cap", () => {
    const arr = [1, 2, 3];
    expect(downsamplePath(arr, 500)).toBe(arr);
  });

  it("keeps first + last and caps the count", () => {
    const arr = Array.from({ length: 5000 }, (_, i) => i);
    const out = downsamplePath(arr, 500);
    expect(out.length).toBe(500);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(4999);
  });
});
