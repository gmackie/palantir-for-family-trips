"use client";

import { Button } from "@sortey/ui/button";
import { Input } from "@sortey/ui/input";
import { toast } from "@sortey/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useTRPC } from "~/trpc/react";

const KINDS = [
  "camp",
  "overnight",
  "rest",
  "scenic",
  "fuel",
  "water",
  "dump",
  "town",
  "custom",
] as const;
type Kind = (typeof KINDS)[number];

function todayLocal(): string {
  return new Intl.DateTimeFormat("en-CA").format(new Date());
}

export function JourneyEditor({
  workspaceId,
  tripId,
}: {
  workspaceId: string;
  tripId: string;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();

  const segmentsQuery = useQuery(
    trpc.trips.listSegments.queryOptions({ workspaceId, tripId }),
  );
  const ordered = [...(segmentsQuery.data ?? [])].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );

  function invalidate() {
    void qc.invalidateQueries({
      queryKey: trpc.trips.listSegments.queryKey({ workspaceId, tripId }),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <AddStop
        workspaceId={workspaceId}
        tripId={tripId}
        onLogged={invalidate}
      />

      <div className="flex flex-col gap-2">
        <div className="font-mono text-xs uppercase tracking-widest text-[#8B949E]">
          {ordered.length} stops
        </div>
        {segmentsQuery.isLoading ? (
          <div className="text-sm text-[#8B949E]">Loading…</div>
        ) : ordered.length === 0 ? (
          <div className="text-sm text-[#8B949E]">No stops logged yet.</div>
        ) : (
          ordered.map((seg) => (
            <StopRow
              key={seg.id}
              seg={seg}
              workspaceId={workspaceId}
              tripId={tripId}
              onChanged={invalidate}
            />
          ))
        )}
      </div>
    </div>
  );
}

function AddStop({
  workspaceId,
  tripId,
  onLogged,
}: {
  workspaceId: string;
  tripId: string;
  onLogged: () => void;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();

  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [kind, setKind] = useState<Kind>("camp");
  const [date, setDate] = useState(todayLocal());
  const [note, setNote] = useState("");
  const [locating, setLocating] = useState(false);

  const search = useQuery({
    ...trpc.routePlanner.searchPlaces.queryOptions({ query }),
    enabled: query.trim().length >= 3,
  });

  const logStop = useMutation(
    trpc.journey.logStop.mutationOptions({
      onSuccess: () => {
        toast.success(`Logged ${name}`);
        setName("");
        setCoords(null);
        setQuery("");
        setNote("");
        onLogged();
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  function useMyLocation() {
    if (!navigator.geolocation) {
      toast.error("Geolocation not available");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setCoords({ lat, lng });
        try {
          const place = await qc.fetchQuery(
            trpc.journey.reverseGeocode.queryOptions({ lat, lng }),
          );
          if (place?.name) setName((prev) => prev || place.name);
        } finally {
          setLocating(false);
        }
      },
      () => {
        toast.error("Couldn't read your location");
        setLocating(false);
      },
    );
  }

  const canSave = !!coords && name.trim().length > 0 && !logStop.isPending;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[#21262D] bg-[#0D1117] p-4">
      <div className="font-mono text-xs uppercase tracking-widest text-[#8B949E]">
        Log a stop
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={useMyLocation}
          disabled={locating}
        >
          {locating ? "Locating…" : "📍 Use my location"}
        </Button>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="…or search a place"
          className="min-w-[220px] flex-1"
        />
      </div>

      {(search.data ?? []).slice(0, 5).map((p) => (
        <button
          key={p.placeId}
          type="button"
          onClick={() => {
            setCoords({ lat: p.lat, lng: p.lng });
            setName(p.name);
            setQuery("");
          }}
          className="rounded-md border border-[#21262D] p-2 text-left hover:border-[#58A6FF]"
        >
          <div className="text-sm font-medium text-[#C9D1D9]">{p.name}</div>
          <div className="truncate text-xs text-[#8B949E]">{p.address}</div>
        </button>
      ))}

      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name this stop (e.g. Johnny Creek Campground)"
      />
      {coords && (
        <div className="font-mono text-xs text-[#3FB950]">
          📍 {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`rounded-md border px-3 py-1.5 text-sm capitalize ${
              kind === k
                ? "border-[#58A6FF] bg-[#58A6FF]/15 text-[#58A6FF]"
                : "border-[#21262D] text-[#C9D1D9] hover:border-[#484F58]"
            }`}
          >
            {k}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="font-mono text-xs uppercase tracking-widest text-[#8B949E]">
          Date
        </label>
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-[170px]"
        />
        <span className="text-xs text-[#8B949E]">(editable later)</span>
      </div>

      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
      />

      <Button
        type="button"
        onClick={() =>
          coords &&
          logStop.mutate({
            workspaceId,
            tripId,
            name: name.trim(),
            lat: coords.lat,
            lng: coords.lng,
            kind,
            date,
            note: note.trim() || undefined,
          })
        }
        disabled={!canSave}
      >
        {logStop.isPending ? "Logging…" : "Log this stop"}
      </Button>
    </div>
  );
}

type Segment = {
  id: string;
  sortOrder: number;
  name: string;
  destinationName: string | null;
  startDate: string | null;
  distanceMiles: string | null;
};

function StopRow({
  seg,
  workspaceId,
  tripId,
  onChanged,
}: {
  seg: Segment;
  workspaceId: string;
  tripId: string;
  onChanged: () => void;
}) {
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(seg.destinationName ?? seg.name);
  const [date, setDate] = useState(seg.startDate ?? "");

  const update = useMutation(
    trpc.journey.updateStop.mutationOptions({
      onSuccess: () => {
        toast.success("Updated");
        setOpen(false);
        onChanged();
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const del = useMutation(
    trpc.journey.deleteStop.mutationOptions({
      onSuccess: () => {
        toast.success("Deleted");
        onChanged();
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const miles = seg.distanceMiles ? Math.round(Number(seg.distanceMiles)) : 0;

  return (
    <div className="rounded-lg border border-[#21262D] bg-[#161B22]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 p-3 text-left"
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-[#C9D1D9]">
            {seg.destinationName ?? seg.name}
          </div>
          <div className="font-mono text-xs text-[#8B949E]">
            {seg.startDate ?? "no date"} · {miles} mi
          </div>
        </div>
        <span className="text-[#8B949E]">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-2 border-t border-[#21262D] p-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() =>
                update.mutate({
                  workspaceId,
                  tripId,
                  segmentId: seg.id,
                  name: name.trim() || undefined,
                  date: date.trim() || undefined,
                })
              }
              disabled={update.isPending}
            >
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (confirm("Delete this stop?")) {
                  del.mutate({ workspaceId, tripId, segmentId: seg.id });
                }
              }}
              disabled={del.isPending}
              className="border-[#F85149] text-[#F85149] hover:bg-[#F85149]/10"
            >
              Delete
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
