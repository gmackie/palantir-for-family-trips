"use client";

import { useEffect, useRef } from "react";

export interface PlanMapMarker {
  id: string;
  kind: "day" | "anchor" | "origin" | "destination";
  label: string;
  date?: string | null;
  intent?: string | null;
  lat: number;
  lng: number;
}

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
  /** Overnight / anchor markers along the multi-day plan (map itinerary). */
  planMarkers?: PlanMapMarker[];
  /** Encoded polyline for the selected day's drive leg (highlighted). */
  selectedLegPolyline?: string | null;
  onPoiClick?: (poiId: string) => void;
  onPlanMarkerClick?: (markerId: string) => void;
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
  planMarkers = [],
  selectedLegPolyline = null,
  onPoiClick,
  onPlanMarkerClick,
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

    // Multi-day plan markers (overnight stops + anchors)
    planMarkers.forEach((m) => {
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat: m.lat, lng: m.lng },
        title: m.label,
        content: createPlanMarkerContent(m),
      });
      if (onPlanMarkerClick) {
        marker.addListener("click", () => onPlanMarkerClick(m.id));
      }
    });

    // Selected day's drive leg — bright overlay
    if (selectedLegPolyline) {
      try {
        const legPath =
          google.maps.geometry.encoding.decodePath(selectedLegPolyline);
        new google.maps.Polyline({
          map,
          path: legPath,
          strokeColor: "#FFFFFF",
          strokeOpacity: 0.95,
          strokeWeight: 7,
          zIndex: 10,
        });
        new google.maps.Polyline({
          map,
          path: legPath,
          strokeColor: "#58A6FF",
          strokeOpacity: 1,
          strokeWeight: 4,
          zIndex: 11,
        });
      } catch {
        // ignore bad polyline
      }
    }

    // Fit bounds to route + plan markers
    const bounds = new google.maps.LatLngBounds();
    path.forEach((p) => bounds.extend(p));
    planMarkers.forEach((m) => bounds.extend({ lat: m.lat, lng: m.lng }));
    map.fitBounds(bounds);
  }, [
    encodedPolyline,
    center,
    zoom,
    showCorridor,
    pois,
    fuelZones,
    overnightZones,
    planMarkers,
    selectedLegPolyline,
    onPoiClick,
    onPlanMarkerClick,
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

const INTENT_DOT: Record<string, string> = {
  play: "#3FB950",
  drive: "#58A6FF",
  position: "#D29922",
  event: "#A371F7",
  recovery: "#8B949E",
};

function createPlanMarkerContent(m: PlanMapMarker): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.cssText =
    "display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;";

  const dot = document.createElement("div");
  const color =
    m.kind === "anchor"
      ? "#A371F7"
      : m.kind === "origin"
        ? "#3FB950"
        : m.kind === "destination"
          ? "#F85149"
          : (INTENT_DOT[m.intent ?? ""] ?? "#58A6FF");
  const size = m.kind === "anchor" ? 14 : 11;
  dot.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #0A0C10;box-shadow:0 0 0 1px ${color}88;`;
  wrap.appendChild(dot);

  const label = document.createElement("div");
  label.textContent =
    m.kind === "anchor" ? `◆ ${m.label}` : m.label.slice(0, 18);
  label.style.cssText =
    "font:700 9px/1.2 Inter,system-ui,sans-serif;color:#C9D1D9;background:#0D1117ee;padding:2px 4px;border-radius:2px;border:1px solid #30363D;white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis;";
  wrap.appendChild(label);

  if (m.date) {
    const date = document.createElement("div");
    date.textContent = m.date.slice(5); // MM-DD
    date.style.cssText =
      "font:600 8px/1 Geist Mono,ui-monospace,monospace;color:#8B949E;";
    wrap.appendChild(date);
  }

  return wrap;
}
