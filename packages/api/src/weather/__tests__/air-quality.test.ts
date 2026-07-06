import { describe, expect, it, vi } from "vitest";

import { aqiCategory, fetchAirQuality } from "../air-quality";

describe("aqiCategory", () => {
  it("bands US AQI into label + concern", () => {
    expect(aqiCategory(30)).toEqual({ category: "Good", concern: "ok" });
    expect(aqiCategory(80).concern).toBe("moderate");
    expect(aqiCategory(130).concern).toBe("unhealthy");
    expect(aqiCategory(180).concern).toBe("unhealthy");
    expect(aqiCategory(250).concern).toBe("hazardous");
    expect(aqiCategory(400)).toEqual({
      category: "Hazardous",
      concern: "hazardous",
    });
  });
});

function mockFetch(payload: unknown, ok = true): typeof fetch {
  return vi.fn(async () => ({
    ok,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

describe("fetchAirQuality", () => {
  it("parses current us_aqi + pm2_5", async () => {
    const out = await fetchAirQuality({
      lat: 45.7,
      lng: -121.5,
      fetchImpl: mockFetch({ current: { us_aqi: 162, pm2_5: 74.3 } }),
    });
    expect(out).toEqual({
      usAqi: 162,
      pm25: 74.3,
      category: "Unhealthy",
      concern: "unhealthy",
    });
  });

  it("returns null on a bad response or missing aqi", async () => {
    expect(
      await fetchAirQuality({
        lat: 0,
        lng: 0,
        fetchImpl: mockFetch({}, false),
      }),
    ).toBeNull();
    expect(
      await fetchAirQuality({
        lat: 0,
        lng: 0,
        fetchImpl: mockFetch({ current: {} }),
      }),
    ).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    expect(await fetchAirQuality({ lat: 1, lng: 1, fetchImpl })).toBeNull();
  });
});
