"use client";

import type { AppRouter } from "@gmacko/api";
import { Button } from "@gmacko/ui/button";
import { useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { useTRPC } from "~/trpc/react";

import { DirectionsPanel } from "./_components/directions-panel";
import { PinList } from "./_components/pin-list";
import type { TripMapPin } from "./_components/trip-map";
import { TripMap } from "./_components/trip-map";

type SegmentOutput =
  inferRouterOutputs<AppRouter>["trips"]["listSegments"];

const GOOGLE_MAPS_API_KEY =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const GOOGLE_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID ?? "";

export default function MapPage() {
  const params = useParams<{ tripId: string }>();
  const tripId = params.tripId;
  const trpc = useTRPC();

  // We need a workspaceId — fetch trip to get it
  const { data: workspaceContext } = useQuery(
    trpc.settings.getWorkspaceContext.queryOptions(),
  );
  const workspaceId = workspaceContext?.workspace?.id;

  // Fetch trip for center coordinates
  const { data: trip } = useQuery({
    ...trpc.trips.get.queryOptions({
      workspaceId: workspaceId ?? "",
      tripId,
    }),
    enabled: !!workspaceId,
  });

  const { data: segments } = useQuery({
    ...trpc.trips.listSegments.queryOptions({
      workspaceId: workspaceId ?? "",
      tripId,
    }),
    enabled: !!workspaceId,
  });

  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    null,
  );

  // Auto-select first segment
  const activeSegmentId = useMemo(() => {
    if (selectedSegmentId) return selectedSegmentId;
    return segments?.[0]?.id ?? null;
  }, [selectedSegmentId, segments]);

  const { data: pinList } = useQuery({
    ...trpc.pins.list.queryOptions({
      workspaceId: workspaceId ?? "",
      tripId,
      segmentId: activeSegmentId ?? undefined,
    }),
    enabled: !!workspaceId && !!activeSegmentId,
  });

  // Map center from trip data (lat/lng are numeric strings in the DB)
  const mapCenter = useMemo(() => {
    const lat = parseFloat(trip?.destinationLat ?? "");
    const lng = parseFloat(trip?.destinationLng ?? "");
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
    // Fallback: world center
    return { lat: 40.7128, lng: -74.006 };
  }, [trip?.destinationLat, trip?.destinationLng]);

  const mapZoom = trip?.defaultZoom ?? 13;

  // Transform pins for the map component (lat/lng are strings from DB)
  const mapPins: TripMapPin[] = useMemo(() => {
    if (!pinList) return [];
    const result: TripMapPin[] = [];
    for (const pin of pinList) {
      const lat = parseFloat(String(pin.lat));
      const lng = parseFloat(String(pin.lng));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      result.push({
        id: pin.id,
        type: pin.type as string,
        title: pin.title,
        lat,
        lng,
        startsAt: pin.startsAt ? String(pin.startsAt) : null,
        endsAt: pin.endsAt ? String(pin.endsAt) : null,
        attendeeCount: pin.attendeeCount,
      });
    }
    return result;
  }, [pinList]);

  // Selected pins state for directions
  const [selectedPinIds, setSelectedPinIds] = useState<string[]>([]);

  const handlePinClick = useCallback((pinId: string) => {
    setSelectedPinIds((prev) => {
      if (prev.length === 0) return [pinId];
      if (prev.length === 1) {
        // If clicking the same pin, deselect
        if (prev[0] === pinId) return [];
        return [prev[0]!, pinId];
      }
      // Already have two — start fresh with new selection
      return [pinId];
    });
  }, []);

  // Resolve selected pins to lat/lng for directions
  const fromPin = useMemo(() => {
    if (selectedPinIds.length < 1) return null;
    const pin = mapPins.find((p) => p.id === selectedPinIds[0]);
    return pin ? { lat: pin.lat, lng: pin.lng, title: pin.title } : null;
  }, [selectedPinIds, mapPins]);

  const toPin = useMemo(() => {
    if (selectedPinIds.length < 2) return null;
    const pin = mapPins.find((p) => p.id === selectedPinIds[1]);
    return pin ? { lat: pin.lat, lng: pin.lng, title: pin.title } : null;
  }, [selectedPinIds, mapPins]);

  // Map click -> prefill add-pin form with coordinates
  const [prefillLat, setPrefillLat] = useState<string>("");
  const [prefillLng, setPrefillLng] = useState<string>("");

  const handleMapClick = useCallback((lat: number, lng: number) => {
    setPrefillLat(lat.toFixed(6));
    setPrefillLng(lng.toFixed(6));
  }, []);

  // Map instance from TripMap's onMapReady callback
  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);

  const handleMapReady = useCallback((map: google.maps.Map) => {
    setMapInstance(map);
  }, []);

  if (!workspaceId) {
    return (
      <main className="container mx-auto max-w-7xl px-4 py-10">
        <p className="text-muted-foreground">Loading workspace...</p>
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-7xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-muted-foreground text-sm uppercase tracking-[0.24em]">
            Map &amp; Pins
          </p>
          <h1 className="text-3xl font-black tracking-tight">Trip Map</h1>
        </div>
        <div className="flex gap-2">
          {selectedPinIds.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedPinIds([])}
            >
              Clear selection
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href={`/trips/${tripId}/itinerary`}>Timeline</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/trips/${tripId}`}>Dashboard</Link>
          </Button>
        </div>
      </div>

      {/* Segment selector */}
      {segments && segments.length > 1 && (
        <div className="mb-4 flex gap-2 overflow-x-auto">
          {segments.map((seg: SegmentOutput[number]) => (
            <Button
              key={seg.id}
              variant={activeSegmentId === seg.id ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedSegmentId(seg.id)}
            >
              {seg.name}
            </Button>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Map — 2/3 width */}
        <div className="lg:col-span-2">
          <TripMap
            apiKey={GOOGLE_MAPS_API_KEY}
            mapId={GOOGLE_MAP_ID || undefined}
            center={mapCenter}
            zoom={mapZoom}
            pins={mapPins}
            onMapClick={handleMapClick}
            onPinClick={handlePinClick}
            onMapReady={handleMapReady}
            selectedPinIds={selectedPinIds}
          />

          {/* Directions panel below the map */}
          {fromPin && toPin && (
            <DirectionsPanel
              map={mapInstance}
              fromPin={fromPin}
              toPin={toPin}
            />
          )}
        </div>

        {/* Pin list — 1/3 width */}
        <div className="max-h-[700px] overflow-y-auto">
          {activeSegmentId ? (
            <PinList
              workspaceId={workspaceId}
              tripId={tripId}
              segmentId={activeSegmentId}
              initialPins={pinList ?? []}
              prefillLat={prefillLat}
              prefillLng={prefillLng}
            />
          ) : (
            <p className="text-muted-foreground py-6 text-center text-sm">
              No segments found. Create a segment first.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
