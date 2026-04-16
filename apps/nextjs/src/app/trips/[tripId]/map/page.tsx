"use client";

import type { AppRouter } from "@gmacko/api";
import { Button } from "@gmacko/ui/button";
import { useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";

import { useTRPC } from "~/trpc/react";

import { PinList } from "./_components/pin-list";

type SegmentOutput =
  inferRouterOutputs<AppRouter>["trips"]["listSegments"];

const PIN_TYPE_COLORS: Record<string, string> = {
  lodging: "bg-blue-500",
  activity: "bg-green-500",
  meal: "bg-orange-500",
  transit: "bg-purple-500",
  drinks: "bg-amber-500",
  tickets: "bg-pink-500",
  custom: "bg-gray-500",
};

export default function MapPage() {
  const params = useParams<{ tripId: string }>();
  const tripId = params.tripId;
  const trpc = useTRPC();

  // We need a workspaceId — fetch trip to get it
  const { data: workspaceContext } = useQuery(
    trpc.settings.getWorkspaceContext.queryOptions(),
  );
  const workspaceId = workspaceContext?.workspace?.id;

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
        {/* Map placeholder — 2/3 width */}
        <div className="bg-muted relative flex min-h-[500px] items-center justify-center rounded-2xl border lg:col-span-2">
          <div className="text-center">
            <p className="text-muted-foreground text-lg font-medium">
              Map will render here
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              Google Maps JS integration deferred
            </p>
          </div>

          {/* Pin markers preview overlay */}
          {pinList && pinList.length > 0 && (
            <div className="absolute right-3 top-3 max-h-60 overflow-y-auto rounded-lg bg-black/60 p-2 backdrop-blur-sm">
              {pinList.map((pin) => (
                <div
                  key={pin.id}
                  className="flex items-center gap-1.5 py-0.5 text-xs text-white"
                >
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${PIN_TYPE_COLORS[pin.type] ?? "bg-gray-500"}`}
                  />
                  <span className="truncate">{pin.title}</span>
                  <span className="font-mono text-white/60">
                    {pin.lat},{pin.lng}
                  </span>
                </div>
              ))}
            </div>
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
