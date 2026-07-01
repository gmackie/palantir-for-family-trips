/**
 * Open-Meteo daily forecast client.
 *
 * Free, no API key, forecast by lat/lng — ideal for surfacing the weather a
 * traveler will hit at each segment's overnight stop. Fail-soft: every error
 * (network, out-of-range date, bad payload) returns null so the UI degrades
 * gracefully. Forecast horizon is ~16 days; dates beyond it yield null.
 */

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";

export interface DailyForecast {
  /** ISO date (YYYY-MM-DD) this forecast is for. */
  date: string;
  highF: number;
  lowF: number;
  /** Max chance of precipitation that day, 0–100. */
  precipProbability: number;
  /** WMO weather code. */
  code: number;
  label: string;
  emoji: string;
}

interface OpenMeteoResponse {
  daily?: {
    time?: string[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
    weather_code?: number[];
  };
}

/** Map a WMO weather code to a short label + emoji. */
export function mapWeatherCode(code: number): { label: string; emoji: string } {
  if (code === 0) return { label: "Clear", emoji: "☀️" };
  if (code <= 2) return { label: "Partly cloudy", emoji: "🌤️" };
  if (code === 3) return { label: "Overcast", emoji: "☁️" };
  if (code <= 48) return { label: "Fog", emoji: "🌫️" };
  if (code <= 57) return { label: "Drizzle", emoji: "🌦️" };
  if (code <= 67) return { label: "Rain", emoji: "🌧️" };
  if (code <= 77) return { label: "Snow", emoji: "❄️" };
  if (code <= 82) return { label: "Rain showers", emoji: "🌧️" };
  if (code <= 86) return { label: "Snow showers", emoji: "🌨️" };
  if (code <= 99) return { label: "Thunderstorm", emoji: "⛈️" };
  return { label: "Unknown", emoji: "❓" };
}

/**
 * Fetch the daily forecast for one location + date. Returns null on any failure
 * or when the date is outside the forecast horizon.
 */
export async function fetchDailyForecast(args: {
  lat: number;
  lng: number;
  date: string;
  fetchImpl?: typeof fetch;
}): Promise<DailyForecast | null> {
  const doFetch = args.fetchImpl ?? fetch;
  const url =
    `${OPEN_METEO_URL}?latitude=${args.lat}&longitude=${args.lng}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
    `&temperature_unit=fahrenheit&timezone=auto&start_date=${args.date}&end_date=${args.date}`;

  try {
    const res = await doFetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as OpenMeteoResponse;
    const d = data.daily;
    if (
      !d?.time?.length ||
      d.temperature_2m_max?.[0] == null ||
      d.temperature_2m_min?.[0] == null
    ) {
      return null;
    }
    const code = d.weather_code?.[0] ?? 0;
    const { label, emoji } = mapWeatherCode(code);
    return {
      date: d.time[0]!,
      highF: Math.round(d.temperature_2m_max[0]!),
      lowF: Math.round(d.temperature_2m_min[0]!),
      precipProbability: Math.round(d.precipitation_probability_max?.[0] ?? 0),
      code,
      label,
      emoji,
    };
  } catch {
    return null;
  }
}
