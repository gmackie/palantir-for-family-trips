/**
 * Open-Meteo Air Quality client — wildfire smoke / AQI for the day-map's
 * conditions layer. Free, no key (same provider as the weather forecast).
 * Fail-soft: every error returns null so the briefing degrades gracefully.
 */

const AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";

export interface AirQuality {
  /** US AQI (0–500+). */
  usAqi: number;
  /** PM2.5 µg/m³ — the wildfire-smoke signal. */
  pm25: number;
  category: string;
  /** Coarse concern level the briefing acts on. */
  concern: "ok" | "moderate" | "unhealthy" | "hazardous";
}

/** US AQI → label + concern band. */
export function aqiCategory(usAqi: number): {
  category: string;
  concern: AirQuality["concern"];
} {
  if (usAqi <= 50) return { category: "Good", concern: "ok" };
  if (usAqi <= 100) return { category: "Moderate", concern: "moderate" };
  if (usAqi <= 150)
    return { category: "Unhealthy for sensitive groups", concern: "unhealthy" };
  if (usAqi <= 200) return { category: "Unhealthy", concern: "unhealthy" };
  if (usAqi <= 300) return { category: "Very unhealthy", concern: "hazardous" };
  return { category: "Hazardous", concern: "hazardous" };
}

export async function fetchAirQuality(args: {
  lat: number;
  lng: number;
  fetchImpl?: typeof fetch;
}): Promise<AirQuality | null> {
  const doFetch = args.fetchImpl ?? fetch;
  const url =
    `${AIR_QUALITY_URL}?latitude=${args.lat}&longitude=${args.lng}` +
    `&current=us_aqi,pm2_5&timezone=auto`;
  try {
    const res = await doFetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      current?: { us_aqi?: number; pm2_5?: number };
    };
    const usAqi = data.current?.us_aqi;
    if (usAqi == null) return null;
    const { category, concern } = aqiCategory(usAqi);
    return {
      usAqi: Math.round(usAqi),
      pm25: Math.round((data.current?.pm2_5 ?? 0) * 10) / 10,
      category,
      concern,
    };
  } catch {
    return null;
  }
}
