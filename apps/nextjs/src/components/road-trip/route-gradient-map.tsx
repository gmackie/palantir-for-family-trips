"use client";

import { useEffect, useRef } from "react";

interface RouteGradientMapProps {
  encodedPolyline: string;
  center?: { lat: number; lng: number };
  zoom?: number;
  corridorRadiusMiles?: number;
  showCorridor?: boolean;
  pois?: Array<{
    id: string;
    lat: number;
    lng: number;
    category: string;
    name: string;
  }>;
  fuelZones?: Array<{ lat: number; lng: number; mileMarker: number }>;
  overnightZones?: Array<{ lat: number; lng: number; radiusMiles: number }>;
  onPoiClick?: (poiId: string) => void;
}

const GRADIENT_COLORS = [
  "#F85149",
  "#E8603A",
  "#D8702B",
  "#C8801C",
  "#B8900D",
  "#A8A000",
  "#8AB020",
  "#6CC040",
  "#4ED060",
  "#30E080",
  "#12F0A0",
  "#00D4C0",
  "#0098E0",
  "#0058FF",
];

const CORRIDOR_METERS = 48280; // 30 miles

const POI_ICONS: Record<string, string> = {
  fuel: "⛽",
  water: "💧",
  campsite: "⛺",
  dump_station: "🚽",
  rest_area: "🅿️",
  scenic: "🏔️",
  shower: "🚿",
  grocery: "🛒",
  propane: "🔥",
  laundry: "👕",
};

export function RouteGradientMap({
  encodedPolyline,
  center,
  zoom = 7,
  corridorRadiusMiles: _corridorRadiusMiles = 30,
  showCorridor = true,
  pois = [],
  fuelZones = [],
  overnightZones = [],
  onPoiClick,
}: RouteGradientMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || !window.google?.maps) return;

    const map = new google.maps.Map(mapRef.current, {
      center: center ?? { lat: 46.0, lng: -110.0 },
      zoom,
      mapId: "sortie-dark",
      disableDefaultUI: true,
      zoomControl: true,
      styles: [
        { elementType: "geometry", stylers: [{ color: "#0A0C10" }] },
        { elementType: "labels.text.stroke", stylers: [{ color: "#0A0C10" }] },
        { elementType: "labels.text.fill", stylers: [{ color: "#8B949E" }] },
        {
          featureType: "road",
          elementType: "geometry",
          stylers: [{ color: "#21262D" }],
        },
        {
          featureType: "water",
          elementType: "geometry",
          stylers: [{ color: "#161B22" }],
        },
      ],
    });
    mapInstanceRef.current = map;

    // Decode polyline and render gradient segments
    const path = google.maps.geometry.encoding.decodePath(encodedPolyline);
    const segmentCount = Math.min(path.length - 1, GRADIENT_COLORS.length * 4);
    const pointsPerSegment = Math.ceil(path.length / segmentCount);

    for (let i = 0; i < segmentCount; i++) {
      const start = i * pointsPerSegment;
      const end = Math.min(start + pointsPerSegment + 1, path.length);
      const segmentPath = path.slice(start, end);
      const colorIndex = Math.floor(
        (i / segmentCount) * GRADIENT_COLORS.length,
      );

      new google.maps.Polyline({
        map,
        path: segmentPath,
        strokeColor: GRADIENT_COLORS[colorIndex],
        strokeOpacity: 0.9,
        strokeWeight: 4,
      });
    }

    // Corridor boundary
    if (showCorridor && path.length > 0) {
      new google.maps.Circle({
        map,
        center: path[Math.floor(path.length / 2)]!,
        radius: CORRIDOR_METERS,
        strokeColor: "#58A6FF",
        strokeOpacity: 0.2,
        strokeWeight: 1,
        fillColor: "#58A6FF",
        fillOpacity: 0.03,
      });
    }

    // POI markers
    pois.forEach((poi) => {
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat: poi.lat, lng: poi.lng },
        title: poi.name,
        content: createPoiMarkerContent(poi.category),
      });
      if (onPoiClick) {
        marker.addListener("click", () => onPoiClick(poi.id));
      }
    });

    // Fuel zone markers
    fuelZones.forEach((zone) => {
      new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat: zone.lat, lng: zone.lng },
        title: `Fuel zone at mile ${zone.mileMarker}`,
        content: createFuelZoneMarker(),
      });
    });

    // Overnight zones
    overnightZones.forEach((zone) => {
      new google.maps.Circle({
        map,
        center: { lat: zone.lat, lng: zone.lng },
        radius: zone.radiusMiles * 1609.34,
        strokeColor: "#D29922",
        strokeOpacity: 0.3,
        strokeWeight: 1,
        fillColor: "#D29922",
        fillOpacity: 0.05,
      });
    });

    // Fit bounds to route
    const bounds = new google.maps.LatLngBounds();
    path.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds);
  }, [
    encodedPolyline,
    center,
    zoom,
    showCorridor,
    pois,
    fuelZones,
    overnightZones,
    onPoiClick,
  ]);

  return (
    <div
      ref={mapRef}
      className="h-full w-full rounded-[4px] border border-[#21262D]"
    />
  );
}

function createPoiMarkerContent(category: string): HTMLElement {
  const div = document.createElement("div");
  div.className = "text-lg";
  div.textContent = POI_ICONS[category] ?? "📍";
  return div;
}

function createFuelZoneMarker(): HTMLElement {
  const div = document.createElement("div");
  div.className =
    "flex h-6 w-6 items-center justify-center rounded-full bg-[#D29922] text-xs font-bold text-black";
  div.textContent = "⛽";
  return div;
}
