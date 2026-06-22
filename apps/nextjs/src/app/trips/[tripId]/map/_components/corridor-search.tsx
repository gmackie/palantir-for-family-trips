"use client";

import type { AppRouter } from "@sortey/api";
import { Button } from "@sortey/ui/button";
import { toast } from "@sortey/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { useState } from "react";

import { useTRPC } from "~/trpc/react";

type PinType = inferRouterInputs<AppRouter>["pins"]["create"]["type"];
type CorridorPoi =
  inferRouterOutputs<AppRouter>["corridor"]["searchImported"][number];

/**
 * Van-friendly POI categories the corridor importer populates (OSM-derived).
 * The category strings line up 1:1 with pin types, so adding a result as a pin
 * is a direct mapping; anything unexpected falls back to "custom".
 */
const VAN_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: "", label: "All" },
  { value: "campsite", label: "Campsites" },
  { value: "water", label: "Water" },
  { value: "dump_station", label: "Dump" },
  { value: "propane", label: "Propane" },
  { value: "shower", label: "Showers" },
  { value: "fuel", label: "Fuel" },
  { value: "grocery", label: "Groceries" },
  { value: "rest_area", label: "Rest areas" },
  { value: "scenic", label: "Scenic" },
];

const VALID_PIN_TYPES = new Set<PinType>([
  "fuel",
  "campsite",
  "water",
  "dump_station",
  "rest_area",
  "grocery",
  "shower",
  "propane",
  "scenic",
]);

function toPinType(category: string): PinType {
  return VALID_PIN_TYPES.has(category as PinType)
    ? (category as PinType)
    : "custom";
}

function milesBetween(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 3959;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

interface CorridorSearchProps {
  workspaceId: string;
  tripId: string;
  /** Segment the added pin is attached to (pins are segment-scoped). */
  segmentId: string;
  /** Search center — typically the segment/trip destination. */
  center: { lat: number; lng: number };
}

export function CorridorSearch({
  workspaceId,
  tripId,
  segmentId,
  center,
}: CorridorSearchProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [category, setCategory] = useState<string>("");
  const [searched, setSearched] = useState(false);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  const centerValid =
    Number.isFinite(center.lat) && Number.isFinite(center.lng);

  const search = useQuery({
    ...trpc.corridor.searchImported.queryOptions({
      workspaceId,
      tripId,
      centerLat: center.lat,
      centerLng: center.lng,
      radiusMiles: 30,
      category: category || undefined,
      limit: 100,
    }),
    enabled: searched && centerValid,
  });

  const addPin = useMutation(
    trpc.pins.create.mutationOptions({
      onSuccess: async (_data, variables) => {
        await queryClient.invalidateQueries(trpc.pins.pathFilter());
        toast.success(`Added "${variables.title}" to trip pins`);
      },
      onError: () => toast.error("Couldn't add pin"),
    }),
  );

  const results = search.data ?? [];

  const handleAdd = (poi: CorridorPoi) => {
    setAddedIds((prev) => new Set(prev).add(poi.id));
    addPin.mutate({
      workspaceId,
      tripId,
      segmentId,
      title: poi.name,
      type: toPinType(poi.category),
      lat: String(poi.lat),
      lng: String(poi.lng),
    });
  };

  return (
    <div className="rounded-[4px] border border-[#21262D] bg-[#0D1117] p-4">
      <p className="text-muted-foreground text-xs uppercase tracking-[0.24em]">
        Van-friendly stops
      </p>
      <p className="mt-1 text-sm text-[#8B949E]">
        Search campsites, water, dump stations &amp; more within ~30 mi.
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {VAN_CATEGORIES.map((c) => (
          <Button
            key={c.value || "all"}
            size="sm"
            variant={category === c.value ? "default" : "outline"}
            onClick={() => {
              setCategory(c.value);
              setSearched(true);
            }}
          >
            {c.label}
          </Button>
        ))}
      </div>

      {!centerValid && (
        <p className="mt-3 text-sm text-[#8B949E]">
          Set a destination for this segment to search nearby stops.
        </p>
      )}

      {searched && centerValid && (
        <div className="mt-4 space-y-2">
          {search.isLoading && (
            <p className="text-muted-foreground text-sm">Searching…</p>
          )}
          {!search.isLoading && results.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No stops found nearby. POI data may not be imported yet — run{" "}
              <code className="font-mono text-xs">
                pnpm -F @sortey/db tsx scripts/import-ioverlander.ts
              </code>
              .
            </p>
          )}
          {results.map((poi) => {
            const dist = milesBetween(
              center.lat,
              center.lng,
              parseFloat(String(poi.lat)),
              parseFloat(String(poi.lng)),
            );
            const added = addedIds.has(poi.id);
            return (
              <div
                key={poi.id}
                className="flex items-center justify-between gap-2 rounded-[2px] border border-[#21262D] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-[#C9D1D9]">{poi.name}</p>
                  <p className="text-muted-foreground text-xs uppercase tracking-wider">
                    {poi.category.replace(/_/g, " ")} ·{" "}
                    <span className="font-mono tabular-nums">
                      {dist.toFixed(1)} mi
                    </span>
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={added || addPin.isPending}
                  onClick={() => handleAdd(poi)}
                >
                  {added ? "Added" : "Add"}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
