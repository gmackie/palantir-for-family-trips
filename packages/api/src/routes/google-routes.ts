/**
 * Google Routes API Integration
 *
 * Wraps the Google Routes API (computeRoutes) for route planning.
 * Used by the road trip mode to compute driving routes between waypoints.
 *
 * API docs: https://developers.google.com/maps/documentation/routes/compute_route_pairs
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComputeRouteInput {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  waypoints?: Array<{ lat: number; lng: number }>;
  apiKey: string;
}

export interface RouteLeg {
  distanceMeters: number;
  duration: string;
  startLocation: { lat: number; lng: number };
  endLocation: { lat: number; lng: number };
}

export interface ComputeRouteResult {
  encodedPolyline: string;
  distanceMeters: number;
  duration: string;
  legs: RouteLeg[];
}

// ---------------------------------------------------------------------------
// Google Routes API response shapes (subset we consume)
// ---------------------------------------------------------------------------

interface GoogleLatLng {
  latitude: number;
  longitude: number;
}

interface GoogleLeg {
  distanceMeters?: number;
  duration?: string;
  startLocation?: { latLng?: GoogleLatLng };
  endLocation?: { latLng?: GoogleLatLng };
}

interface GoogleRoute {
  distanceMeters?: number;
  duration?: string;
  polyline?: { encodedPolyline?: string };
  legs?: GoogleLeg[];
}

interface GoogleRoutesResponse {
  routes?: GoogleRoute[];
  error?: { code?: number; message?: string; status?: string };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROUTES_API_URL =
  "https://routes.googleapis.com/directions/v2:computeRoutes";

const FIELD_MASK = [
  "routes.duration",
  "routes.distanceMeters",
  "routes.polyline.encodedPolyline",
  "routes.legs",
].join(",");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toWaypoint(point: { lat: number; lng: number }) {
  return {
    location: {
      latLng: {
        latitude: point.lat,
        longitude: point.lng,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function computeRoute(
  input: ComputeRouteInput,
): Promise<ComputeRouteResult> {
  const body: Record<string, unknown> = {
    origin: toWaypoint(input.origin),
    destination: toWaypoint(input.destination),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_UNAWARE",
    computeAlternativeRoutes: false,
    polylineEncoding: "ENCODED_POLYLINE",
  };

  if (input.waypoints && input.waypoints.length > 0) {
    body.intermediates = input.waypoints.map(toWaypoint);
  }

  const response = await fetch(ROUTES_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": input.apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Google Routes API error (${response.status}): ${errorText}`,
    );
  }

  const data = (await response.json()) as GoogleRoutesResponse;

  if (data.error) {
    throw new Error(
      `Google Routes API error: ${data.error.message ?? data.error.status ?? "unknown"}`,
    );
  }

  const route = data.routes?.[0];
  if (!route) {
    throw new Error("Google Routes API returned no routes");
  }

  const encodedPolyline = route.polyline?.encodedPolyline;
  if (!encodedPolyline) {
    throw new Error("Google Routes API returned no polyline");
  }

  const legs: RouteLeg[] = (route.legs ?? []).map((leg) => ({
    distanceMeters: leg.distanceMeters ?? 0,
    duration: leg.duration ?? "0s",
    startLocation: {
      lat: leg.startLocation?.latLng?.latitude ?? 0,
      lng: leg.startLocation?.latLng?.longitude ?? 0,
    },
    endLocation: {
      lat: leg.endLocation?.latLng?.latitude ?? 0,
      lng: leg.endLocation?.latLng?.longitude ?? 0,
    },
  }));

  return {
    encodedPolyline,
    distanceMeters: route.distanceMeters ?? 0,
    duration: route.duration ?? "0s",
    legs,
  };
}
