import { describe, expect, it, vi } from "vitest";

import { fetchDailyForecast, mapWeatherCode } from "../open-meteo";

describe("mapWeatherCode", () => {
  it("maps representative WMO codes to label + emoji", () => {
    expect(mapWeatherCode(0).label).toBe("Clear");
    expect(mapWeatherCode(2).label).toBe("Partly cloudy");
    expect(mapWeatherCode(3).label).toBe("Overcast");
    expect(mapWeatherCode(45).label).toBe("Fog");
    expect(mapWeatherCode(63).label).toBe("Rain");
    expect(mapWeatherCode(75).label).toBe("Snow");
    expect(mapWeatherCode(95).label).toBe("Thunderstorm");
    expect(mapWeatherCode(0).emoji).toBeTruthy();
  });

  it("handles unknown codes", () => {
    expect(mapWeatherCode(200).label).toBe("Unknown");
  });
});

function mockFetch(payload: unknown, ok = true): typeof fetch {
  return vi.fn(async () => ({
    ok,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

describe("fetchDailyForecast", () => {
  it("parses a daily forecast into rounded F + label", async () => {
    const fetchImpl = mockFetch({
      daily: {
        time: ["2026-07-08"],
        temperature_2m_max: [72.4],
        temperature_2m_min: [48.6],
        precipitation_probability_max: [20],
        weather_code: [3],
      },
    });
    const out = await fetchDailyForecast({
      lat: 46.78,
      lng: -121.73,
      date: "2026-07-08",
      fetchImpl,
    });
    expect(out).toEqual({
      date: "2026-07-08",
      highF: 72,
      lowF: 49,
      precipProbability: 20,
      code: 3,
      label: "Overcast",
      emoji: "☁️",
    });
  });

  it("returns null on a non-ok response", async () => {
    const out = await fetchDailyForecast({
      lat: 0,
      lng: 0,
      date: "2026-07-08",
      fetchImpl: mockFetch({}, false),
    });
    expect(out).toBeNull();
  });

  it("returns null when the date is out of forecast range (empty daily)", async () => {
    const out = await fetchDailyForecast({
      lat: 46.78,
      lng: -121.73,
      date: "2027-01-01",
      fetchImpl: mockFetch({ daily: { time: [] } }),
    });
    expect(out).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const out = await fetchDailyForecast({
      lat: 1,
      lng: 1,
      date: "2026-07-08",
      fetchImpl,
    });
    expect(out).toBeNull();
  });

  it("defaults missing precip + code to safe values", async () => {
    const out = await fetchDailyForecast({
      lat: 46.78,
      lng: -121.73,
      date: "2026-07-08",
      fetchImpl: mockFetch({
        daily: {
          time: ["2026-07-08"],
          temperature_2m_max: [60],
          temperature_2m_min: [40],
        },
      }),
    });
    expect(out?.precipProbability).toBe(0);
    expect(out?.code).toBe(0);
    expect(out?.label).toBe("Clear");
  });
});
