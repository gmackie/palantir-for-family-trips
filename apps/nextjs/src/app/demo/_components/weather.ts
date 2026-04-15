// @ts-nocheck
import { DAYS } from "./trip-data";

const WEATHER_API_ROOT = "https://api.weather.gov";
const DEFAULT_ACCEPT_HEADERS = {
  Accept: "application/geo+json",
};

export const DAY_WEATHER_TARGET = {
  thu: "basecamp",
  fri: "basecamp",
  sat: "yosemite",
  sun: "basecamp",
};

function parseTripDate(dayId, year = new Date().getFullYear()) {
  const day = DAYS.find((item) => item.id === dayId);
  const match = day?.shortLabel?.match(/(\d{1,2})\/(\d{1,2})/);
  if (!match) return null;

  const month = Number(match[1]) - 1;
  const date = Number(match[2]);
  return new Date(Date.UTC(year, month, date));
}

function toIsoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function getWeatherIconKey(condition = "") {
  const text = condition.toLowerCase();

  if (text.includes("thunder")) return "storm";
  if (text.includes("snow")) return "snow";
  if (
    text.includes("rain") ||
    text.includes("shower") ||
    text.includes("drizzle")
  )
    return "rain";
  if (text.includes("fog") || text.includes("haze") || text.includes("smoke"))
    return "fog";
  if (text.includes("wind") || text.includes("breezy")) return "wind";
  if (text.includes("sunny") || text.includes("clear")) return "sun";
  if (text.includes("partly") || text.includes("mostly")) return "partly";
  if (text.includes("cloud")) return "cloud";
  return "cloud";
}

function celsiusToFahrenheit(value) {
  if (typeof value !== "number") return null;
  return Math.round((value * 9) / 5 + 32);
}

function formatObservationTemperature(observation) {
  const celsius = observation?.properties?.temperature?.value;
  const fahrenheit = celsiusToFahrenheit(celsius);
  return fahrenheit == null ? null : `${fahrenheit} F`;
}

async function fetchWeatherJson(url) {
  const response = await fetch(url, { headers: DEFAULT_ACCEPT_HEADERS });
  if (!response.ok) {
    throw new Error(`Weather request failed: ${response.status}`);
  }
  return response.json();
}

async function fetchLatestObservation(stationsUrl) {
  if (!stationsUrl) return null;

  const stations = await fetchWeatherJson(stationsUrl);
  const firstStation = stations?.features?.[0];
  const stationUrl = firstStation?.id || firstStation?.properties?.["@id"];
  if (!stationUrl) return null;

  return fetchWeatherJson(`${stationUrl}/observations/latest`);
}

export async function fetchWeatherBundle({ label, coordinates }) {
  if (!coordinates?.lat || !coordinates?.lng) return null;

  const points = await fetchWeatherJson(
    `${WEATHER_API_ROOT}/points/${coordinates.lat},${coordinates.lng}`,
  );
  const pointProps = points?.properties || {};
  const relativeLocation = pointProps.relativeLocation?.properties;

  const [forecast, hourly, observation] = await Promise.all([
    pointProps.forecast
      ? fetchWeatherJson(pointProps.forecast)
      : Promise.resolve(null),
    pointProps.forecastHourly
      ? fetchWeatherJson(pointProps.forecastHourly)
      : Promise.resolve(null),
    pointProps.observationStations
      ? fetchLatestObservation(pointProps.observationStations)
      : Promise.resolve(null),
  ]);

  const forecastPeriods = forecast?.properties?.periods || [];
  const hourlyPeriods = hourly?.properties?.periods || [];
  const liveTemperature =
    formatObservationTemperature(observation) ||
    (hourlyPeriods[0]?.temperature != null
      ? `${hourlyPeriods[0].temperature} ${hourlyPeriods[0].temperatureUnit || "F"}`
      : null);
  const liveSummary =
    observation?.properties?.textDescription ||
    hourlyPeriods[0]?.shortForecast ||
    "";

  return {
    label,
    coordinates,
    placeLabel: relativeLocation
      ? `${relativeLocation.city || label}, ${relativeLocation.state || ""}`.replace(
          /, $/,
          "",
        )
      : label,
    forecastPeriods,
    hourlyPeriods,
    live: {
      summary: liveSummary || "Forecast pending",
      temperature: liveTemperature || "--",
      iconKey: getWeatherIconKey(
        liveSummary || hourlyPeriods[0]?.shortForecast || "",
      ),
      timestamp:
        observation?.properties?.timestamp ||
        hourlyPeriods[0]?.startTime ||
        null,
      wind: observation?.properties?.windSpeed?.value,
    },
  };
}

export function getTripDayWeather(bundleMap, day) {
  const targetKey = DAY_WEATHER_TARGET[day.id];
  const bundle = targetKey ? bundleMap?.[targetKey] : null;
  if (!bundle) {
    return {
      weather: day.weather,
      temperature: day.temperature,
      weatherIconKey: getWeatherIconKey(day.weather),
      weatherLocation: day.title,
    };
  }

  const targetDate = toIsoDate(parseTripDate(day.id));
  const forecastPeriod =
    bundle.forecastPeriods.find((period) => {
      const periodDate = toIsoDate(new Date(period.startTime));
      return periodDate === targetDate && period.isDaytime;
    }) ||
    bundle.forecastPeriods.find(
      (period) => toIsoDate(new Date(period.startTime)) === targetDate,
    );

  if (!forecastPeriod) {
    return {
      weather: day.weather,
      temperature: day.temperature,
      weatherIconKey: getWeatherIconKey(day.weather),
      weatherLocation: bundle.placeLabel,
    };
  }

  return {
    weather: forecastPeriod.shortForecast,
    temperature: `${forecastPeriod.temperature} ${forecastPeriod.temperatureUnit || "F"}`,
    weatherIconKey: getWeatherIconKey(forecastPeriod.shortForecast),
    weatherLocation: bundle.placeLabel,
  };
}

export function getMapWeather(bundleMap, focusDayId = "all") {
  const targetKey =
    focusDayId !== "all" ? DAY_WEATHER_TARGET[focusDayId] : "basecamp";
  const bundle = targetKey ? bundleMap?.[targetKey] : null;
  if (!bundle) return null;

  return {
    label:
      focusDayId !== "all"
        ? `${DAYS.find((day) => day.id === focusDayId)?.title || "Focused day"} weather`
        : "Live weather",
    placeLabel: bundle.placeLabel,
    summary: bundle.live.summary,
    temperature: bundle.live.temperature,
    iconKey: bundle.live.iconKey,
  };
}

export function getMapWeatherTargets(bundleMap, focusDayId = "all") {
  const focusedTargetKey =
    focusDayId !== "all" ? DAY_WEATHER_TARGET[focusDayId] : "basecamp";
  const targets = [
    { id: "basecamp", label: "Basecamp", bundle: bundleMap?.basecamp },
    { id: "yosemite", label: "Yosemite", bundle: bundleMap?.yosemite },
  ];

  return targets
    .filter((target) => target.bundle)
    .map((target) => ({
      id: target.id,
      label: target.label,
      placeLabel: target.bundle.placeLabel,
      summary: target.bundle.live.summary,
      temperature: target.bundle.live.temperature,
      iconKey: target.bundle.live.iconKey,
      active: target.id === focusedTargetKey,
    }));
}
