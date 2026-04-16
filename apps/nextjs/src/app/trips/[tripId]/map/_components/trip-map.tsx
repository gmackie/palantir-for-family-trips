"use client";

import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { useEffect, useRef, useState } from "react";

const PIN_TYPE_MARKER_COLORS: Record<string, string> = {
  lodging: "#3b82f6", // blue
  activity: "#22c55e", // green
  meal: "#f97316", // orange
  transit: "#a855f7", // purple
  drinks: "#ec4899", // pink
  tickets: "#eab308", // yellow
  custom: "#6b7280", // gray
};

export interface TripMapPin {
  id: string;
  type: string;
  title: string;
  lat: number;
  lng: number;
  startsAt: string | null;
  endsAt: string | null;
  attendeeCount: number;
}

export interface TripMapProps {
  apiKey: string;
  mapId?: string;
  center: { lat: number; lng: number };
  zoom: number;
  pins: TripMapPin[];
  onMapClick?: (lat: number, lng: number) => void;
  onPinClick?: (pinId: string) => void;
  onMapReady?: (map: google.maps.Map) => void;
  selectedPinIds?: string[];
}

function formatTimeRange(
  startsAt: string | null,
  endsAt: string | null,
): string {
  if (!startsAt) return "No time set";
  const fmt = new Intl.DateTimeFormat("en-US", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "UTC",
  });
  const start = fmt.format(new Date(startsAt));
  if (!endsAt) return start;
  const end = fmt.format(new Date(endsAt));
  return `${start} — ${end}`;
}

/** Shared flag so setOptions is only called once per page load. */
declare global {
  // eslint-disable-next-line no-var
  var __tripMapLoaderConfigured: boolean | undefined;
}

export function TripMap({
  apiKey,
  mapId,
  center,
  zoom,
  pins,
  onMapClick,
  onPinClick,
  onMapReady,
  selectedPinIds,
}: TripMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const legacyMarkersRef = useRef<google.maps.Marker[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize the map
  useEffect(() => {
    if (!apiKey) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function init() {
      try {
        if (!globalThis.__tripMapLoaderConfigured) {
          setOptions({
            key: apiKey,
            mapIds: mapId ? [mapId] : undefined,
          });
          globalThis.__tripMapLoaderConfigured = true;
        }

        const { Map } = (await importLibrary("maps")) as google.maps.MapsLibrary;

        if (cancelled || !containerRef.current) return;

        const map = new Map(containerRef.current, {
          center,
          zoom,
          mapId: mapId || undefined,
          disableDefaultUI: false,
          zoomControl: true,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          styles: mapId
            ? undefined
            : [
                { elementType: "geometry", stylers: [{ color: "#0b0f14" }] },
                {
                  elementType: "labels.text.stroke",
                  stylers: [{ color: "#0b0f14" }],
                },
                {
                  elementType: "labels.text.fill",
                  stylers: [{ color: "#8b949e" }],
                },
                {
                  featureType: "road",
                  elementType: "geometry",
                  stylers: [{ color: "#1f2a34" }],
                },
                {
                  featureType: "water",
                  elementType: "geometry",
                  stylers: [{ color: "#08111d" }],
                },
              ],
        });

        mapRef.current = map;
        onMapReady?.(map);

        // Click on map (not on marker) -> onMapClick
        map.addListener("click", (e: google.maps.MapMouseEvent) => {
          if (e.latLng) {
            onMapClick?.(e.latLng.lat(), e.latLng.lng());
          }
        });

        if (!cancelled) setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load Google Maps",
          );
          setLoading(false);
        }
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
    // Only run once on mount — center/zoom changes handled separately
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, mapId]);

  // Sync markers when pins change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear old markers
    for (const m of markersRef.current) m.map = null;
    markersRef.current = [];
    for (const m of legacyMarkersRef.current) m.setMap(null);
    legacyMarkersRef.current = [];

    if (!infoWindowRef.current) {
      void importLibrary("maps").then((mapsLib) => {
        const lib = mapsLib as google.maps.MapsLibrary;
        // InfoWindow doesn't need special handling
        void lib;
      });
      infoWindowRef.current = new google.maps.InfoWindow();
    }
    const infoWindow = infoWindowRef.current;

    const useAdvanced = !!mapId;

    async function createMarkers() {
      if (useAdvanced) {
        try {
          const { AdvancedMarkerElement } =
            (await importLibrary("marker")) as google.maps.MarkerLibrary;

          for (const pin of pins) {
            const color = PIN_TYPE_MARKER_COLORS[pin.type] ?? "#6b7280";

            // Create a colored pin element
            const pinEl = document.createElement("div");
            pinEl.style.width = "14px";
            pinEl.style.height = "14px";
            pinEl.style.borderRadius = "50%";
            pinEl.style.backgroundColor = color;
            pinEl.style.border = "2px solid white";
            pinEl.style.boxShadow = "0 2px 6px rgba(0,0,0,0.4)";
            pinEl.style.cursor = "pointer";

            const isSelected = selectedPinIds?.includes(pin.id);
            if (isSelected) {
              pinEl.style.width = "20px";
              pinEl.style.height = "20px";
              pinEl.style.border = "3px solid #fff";
            }

            const marker = new AdvancedMarkerElement({
              map,
              position: { lat: pin.lat, lng: pin.lng },
              title: pin.title,
              content: pinEl,
            });

            marker.addListener("click", () => {
              infoWindow.setContent(buildInfoContent(pin));
              infoWindow.open({ anchor: marker, map });
              onPinClick?.(pin.id);
            });

            markersRef.current.push(marker);
          }
        } catch {
          // Fallback to legacy markers if advanced fails
          createLegacyMarkers();
        }
      } else {
        createLegacyMarkers();
      }
    }

    function createLegacyMarkers() {
      for (const pin of pins) {
        const color = PIN_TYPE_MARKER_COLORS[pin.type] ?? "#6b7280";

        const marker = new google.maps.Marker({
          map,
          position: { lat: pin.lat, lng: pin.lng },
          title: pin.title,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: selectedPinIds?.includes(pin.id) ? 10 : 7,
            fillColor: color,
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          },
        });

        marker.addListener("click", () => {
          infoWindow.setContent(buildInfoContent(pin));
          infoWindow.open({ anchor: marker, map });
          onPinClick?.(pin.id);
        });

        legacyMarkersRef.current.push(marker);
      }
    }

    void createMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins, mapId, selectedPinIds, onPinClick]);

  // No API key — styled placeholder
  if (!apiKey) {
    return (
      <div className="bg-muted flex min-h-[500px] items-center justify-center rounded-2xl border">
        <div className="text-center">
          <p className="text-muted-foreground text-lg font-medium">
            Map unavailable
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to enable the map
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-muted flex min-h-[500px] items-center justify-center rounded-2xl border">
        <div className="text-center">
          <p className="text-destructive text-lg font-medium">
            Map failed to load
          </p>
          <p className="text-muted-foreground mt-1 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-[500px] overflow-hidden rounded-2xl border">
      {loading && (
        <div className="bg-muted absolute inset-0 z-10 flex items-center justify-center">
          <p className="text-muted-foreground animate-pulse text-sm">
            Loading map...
          </p>
        </div>
      )}
      <div ref={containerRef} className="h-full min-h-[500px] w-full" />
    </div>
  );
}

TripMap.displayName = "TripMap";

function buildInfoContent(pin: TripMapPin): string {
  const typeBadge = pin.type.charAt(0).toUpperCase() + pin.type.slice(1);
  const time = formatTimeRange(pin.startsAt, pin.endsAt);
  const attendees =
    pin.attendeeCount > 0
      ? `${pin.attendeeCount} attendee${pin.attendeeCount !== 1 ? "s" : ""}`
      : "";

  return `
    <div style="font-family: system-ui, sans-serif; min-width: 160px;">
      <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">${pin.title}</div>
      <div style="font-size: 12px; color: #666; margin-bottom: 2px;">
        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${PIN_TYPE_MARKER_COLORS[pin.type] ?? "#6b7280"}; margin-right: 4px; vertical-align: middle;"></span>
        ${typeBadge}
      </div>
      <div style="font-size: 11px; color: #888; margin-top: 4px;">${time}</div>
      ${attendees ? `<div style="font-size: 11px; color: #888; margin-top: 2px;">${attendees}</div>` : ""}
    </div>
  `;
}
