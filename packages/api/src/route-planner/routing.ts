/**
 * Google Routes + Geocoding helpers, shared by route planning and journey
 * logging. All calls are fail-soft (return null on any error) so callers can
 * fall back (e.g. straight-line distance, un-named stop) rather than throw.
 */

const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RoutedLeg {
  miles: number;
  minutes: number;
  /** Encoded polyline (precision 5). */
  polyline: string;
}

function routesApiKey(): string | null {
  return (
    process.env.GOOGLE_ROUTES_API_KEY ??
    process.env.GOOGLE_MAPS_API_KEY ??
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ??
    null
  );
}

function metersToMiles(m: number): number {
  return Math.round((m / 1609.344) * 10) / 10;
}

function durationToMinutes(d: string): number {
  return Math.round(Number.parseInt(d.replace("s", ""), 10) / 60);
}

/**
 * Drive route between two points. Returns null on any failure (no key, network,
 * no route) so the caller can fall back to a straight-line estimate.
 */
export async function routeLeg(
  a: LatLng,
  b: LatLng,
  fetchImpl: typeof fetch = fetch,
): Promise<RoutedLeg | null> {
  const apiKey = routesApiKey();
  if (!apiKey) return null;
  try {
    const res = await fetchImpl(ROUTES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: a.lat, longitude: a.lng } } },
        destination: {
          location: { latLng: { latitude: b.lat, longitude: b.lng } },
        },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
        polylineEncoding: "ENCODED_POLYLINE",
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      routes?: Array<{
        distanceMeters: number;
        duration: string;
        polyline: { encodedPolyline: string };
      }>;
    };
    const route = data.routes?.[0];
    if (!route) return null;
    return {
      miles: metersToMiles(route.distanceMeters),
      minutes: durationToMinutes(route.duration),
      polyline: route.polyline.encodedPolyline,
    };
  } catch {
    return null;
  }
}

export interface GeocodedPlace {
  name: string;
  lat: number;
  lng: number;
}

/** Forward geocode a query ("Avery Park, WA") to a place. Null on failure. */
export async function geocode(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GeocodedPlace | null> {
  const apiKey = routesApiKey();
  if (!apiKey) return null;
  try {
    const res = await fetchImpl(
      `${GEOCODE_URL}?address=${encodeURIComponent(query)}&key=${apiKey}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: Array<{
        formatted_address: string;
        geometry: { location: { lat: number; lng: number } };
      }>;
    };
    const first = data.results?.[0];
    if (!first) return null;
    return {
      name: first.formatted_address,
      lat: first.geometry.location.lat,
      lng: first.geometry.location.lng,
    };
  } catch {
    return null;
  }
}

/**
 * Reverse geocode a coordinate to a human place name (locality first, else the
 * formatted address). Null on any failure.
 */
export async function reverseGeocode(
  point: LatLng,
  fetchImpl: typeof fetch = fetch,
): Promise<GeocodedPlace | null> {
  const apiKey = routesApiKey();
  if (!apiKey) return null;
  try {
    const res = await fetchImpl(
      `${GEOCODE_URL}?latlng=${point.lat},${point.lng}&key=${apiKey}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      status?: string;
      results?: Array<{
        formatted_address: string;
        geometry: { location: { lat: number; lng: number } };
        address_components?: Array<{ long_name: string; types: string[] }>;
      }>;
    };
    const first = data.results?.[0];
    if (!first) return null;
    const locality = first.address_components?.find(
      (c) =>
        c.types.includes("locality") ||
        c.types.includes("natural_feature") ||
        c.types.includes("park"),
    );
    const admin = first.address_components?.find((c) =>
      c.types.includes("administrative_area_level_1"),
    );
    const base =
      locality?.long_name ?? first.formatted_address.split(",")[0] ?? "Stop";
    const name = admin ? `${base}, ${admin.long_name}` : base;
    return {
      name,
      lat: first.geometry.location.lat,
      lng: first.geometry.location.lng,
    };
  } catch {
    return null;
  }
}
