import type { TrackingStatus } from "@sortey/db/schema";

// AviationStack live flight status. Free tier (500 req/mo) is best-effort: every
// failure mode (no key, non-2xx, network error, empty/unmatched results) returns
// null so the caller leaves the transit unchanged rather than throwing.

const AVIATIONSTACK_URL = "https://api.aviationstack.com/v1/flights";
const DELAY_THRESHOLD_MS = 30 * 60 * 1000; // >30 min late ⇒ "delayed"

export interface FlightStatus {
  estimatedAt: Date | null;
  actualAt: Date | null;
  trackingStatus: TrackingStatus;
}

/**
 * Map AviationStack `flight_status` to our `trackingStatus` enum. Pure +
 * exported for unit testing. When the flight is still scheduled/active but the
 * estimated arrival is >30 min past the scheduled arrival, surface "delayed".
 */
export function mapFlightStatus(
  flightStatus: string | null | undefined,
  scheduledAt: Date | null,
  estimatedAt: Date | null,
): TrackingStatus {
  const isLate =
    scheduledAt != null &&
    estimatedAt != null &&
    estimatedAt.getTime() - scheduledAt.getTime() > DELAY_THRESHOLD_MS;

  switch (flightStatus) {
    case "active":
      return isLate ? "delayed" : "en_route";
    case "landed":
      return "arrived";
    case "cancelled":
      return "cancelled";
    case "incident":
    case "diverted":
      return "delayed";
    default:
      // "scheduled" and anything unexpected
      return isLate ? "delayed" : "scheduled";
  }
}

interface AviationStackFlight {
  flight_date?: string;
  flight_status?: string;
  arrival?: {
    scheduled?: string | null;
    estimated?: string | null;
    actual?: string | null;
  };
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Fetch live status for a flight by IATA code (e.g. "UA123"). Uses the arrival
 * leg (the dashboard cares about when people land). Returns null on any failure.
 */
export async function fetchFlightStatus(input: {
  flightIata: string;
  /** YYYY-MM-DD; when present, prefer the flight on that date. */
  scheduledDate?: string;
  apiKey?: string;
}): Promise<FlightStatus | null> {
  const apiKey = input.apiKey ?? process.env.AVIATIONSTACK_API_KEY;
  if (!apiKey) return null;

  const flightIata = input.flightIata.replace(/\s+/g, "").toUpperCase();
  if (!flightIata) return null;

  try {
    const url = `${AVIATIONSTACK_URL}?access_key=${encodeURIComponent(
      apiKey,
    )}&flight_iata=${encodeURIComponent(flightIata)}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const body = (await res.json()) as { data?: AviationStackFlight[] };
    const rows = body.data ?? [];
    if (rows.length === 0) return null;

    const flight =
      (input.scheduledDate
        ? rows.find((r) => r.flight_date === input.scheduledDate)
        : undefined) ?? rows[0];
    if (!flight) return null;

    const scheduledArrival = toDate(flight.arrival?.scheduled);
    const estimatedAt = toDate(flight.arrival?.estimated);
    const actualAt = toDate(flight.arrival?.actual);

    return {
      estimatedAt,
      actualAt,
      trackingStatus: mapFlightStatus(
        flight.flight_status,
        scheduledArrival,
        estimatedAt,
      ),
    };
  } catch {
    return null;
  }
}
