"use client";

import type { AppRouter } from "@gmacko/api";
import { Button } from "@gmacko/ui/button";
import { Input } from "@gmacko/ui/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useEffect, useState } from "react";

import { useTRPC } from "~/trpc/react";

type PinListOutput = inferRouterOutputs<AppRouter>["pins"]["list"];
type PinItem = PinListOutput[number];

const PIN_TYPE_LABELS: Record<string, string> = {
  lodging: "🏨 Lodging",
  activity: "🎯 Activity",
  meal: "🍽️ Meal",
  transit: "🚌 Transit",
  drinks: "🍻 Drinks",
  tickets: "🎟️ Tickets",
  custom: "📌 Custom",
};

const PIN_TYPE_OPTIONS = [
  "lodging",
  "activity",
  "meal",
  "transit",
  "drinks",
  "tickets",
  "custom",
] as const;

function formatTimeRange(
  startsAt: Date | string | null,
  endsAt: Date | string | null,
) {
  if (!startsAt) return "No time set";
  const fmt = new Intl.DateTimeFormat("en-US", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "UTC",
  });
  const start = fmt.format(new Date(startsAt));
  if (!endsAt) return start;
  const end = fmt.format(new Date(endsAt));
  return `${start} - ${end}`;
}

export function PinList(props: {
  workspaceId: string;
  tripId: string;
  segmentId: string;
  initialPins: PinListOutput;
  prefillLat?: string;
  prefillLng?: string;
}) {
  const { workspaceId, tripId, segmentId } = props;
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { data: pinList } = useQuery({
    ...trpc.pins.list.queryOptions({ workspaceId, tripId, segmentId }),
    initialData: props.initialPins,
  });

  // Add pin form state
  const [title, setTitle] = useState("");
  const [type, setType] = useState<(typeof PIN_TYPE_OPTIONS)[number]>("custom");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");

  // Sync prefill coordinates from map clicks
  useEffect(() => {
    if (props.prefillLat) setLat(props.prefillLat);
  }, [props.prefillLat]);

  useEffect(() => {
    if (props.prefillLng) setLng(props.prefillLng);
  }, [props.prefillLng]);

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: trpc.pins.list.queryKey({ workspaceId, tripId, segmentId }),
    });
  };

  const createMutation = useMutation({
    ...trpc.pins.create.mutationOptions(),
    onSuccess: () => {
      invalidate();
      setTitle("");
      setLat("");
      setLng("");
    },
  });

  const deleteMutation = useMutation({
    ...trpc.pins.delete.mutationOptions(),
    onSuccess: invalidate,
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Add pin form */}
      <div className="bg-card space-y-3 rounded-xl border p-4">
        <h3 className="text-sm font-semibold uppercase tracking-widest">
          Add Pin
        </h3>
        <Input
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="flex gap-2">
          <select
            className="border-input bg-background text-foreground rounded-md border px-3 py-2 text-sm"
            value={type}
            onChange={(e) =>
              setType(e.target.value as (typeof PIN_TYPE_OPTIONS)[number])
            }
          >
            {PIN_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {PIN_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Latitude"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            className="font-mono"
          />
          <Input
            placeholder="Longitude"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            className="font-mono"
          />
        </div>
        <Button
          size="sm"
          disabled={!title || !lat || !lng || createMutation.isPending}
          onClick={() =>
            createMutation.mutate({
              workspaceId,
              tripId,
              segmentId,
              title,
              type,
              lat,
              lng,
            })
          }
        >
          {createMutation.isPending ? "Adding..." : "Add pin"}
        </Button>
      </div>

      {/* Pin list */}
      <div className="space-y-2">
        {pinList.length === 0 && (
          <p className="text-muted-foreground py-6 text-center text-sm">
            No pins yet. Add one above.
          </p>
        )}
        {pinList.map((pin: PinItem) => (
          <div
            key={pin.id}
            className="bg-card flex items-start justify-between gap-3 rounded-lg border p-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm">
                  {PIN_TYPE_LABELS[pin.type] ?? pin.type}
                </span>
                <span className="truncate text-sm font-medium">
                  {pin.title}
                </span>
              </div>
              <p className="text-muted-foreground mt-1 font-mono text-xs">
                {formatTimeRange(pin.startsAt, pin.endsAt)}
              </p>
              <p className="text-muted-foreground mt-0.5 font-mono text-xs">
                {pin.lat}, {pin.lng}
              </p>
              {pin.attendeeCount > 0 && (
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {pin.attendeeCount} attendee
                  {pin.attendeeCount !== 1 ? "s" : ""}
                </p>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={deleteMutation.isPending}
              onClick={() =>
                deleteMutation.mutate({ workspaceId, tripId, pinId: pin.id })
              }
            >
              Delete
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
