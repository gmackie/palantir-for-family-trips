"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useTRPC } from "~/trpc/react";

const CAT_LABEL: Record<string, string> = {
  wild_camping: "Wild",
  campsite: "Campground",
  parking_overnight: "ON park",
  rest_area: "Rest",
  parking: "Parking",
  dump_station: "Dump",
  water: "Water",
  fuel: "Fuel",
  propane: "Propane",
  shower: "Shower",
  laundry: "Laundry",
  toll: "Toll",
  grocery: "Grocery",
};

const AMENITY_TABS: Array<{
  key: "sleep" | "service" | "fuel" | "parking" | "road";
  label: string;
  categories: string[] | null;
}> = [
  { key: "sleep", label: "Sleep", categories: null },
  {
    key: "service",
    label: "Service",
    categories: ["dump_station", "water", "propane", "shower", "laundry"],
  },
  {
    key: "fuel",
    label: "Fuel",
    categories: ["fuel"],
  },
  {
    key: "parking",
    label: "Park",
    categories: ["parking", "parking_overnight", "rest_area"],
  },
  {
    key: "road",
    label: "Road",
    categories: ["toll", "rest_area", "parking"],
  },
];

export function OvernightSuggest(props: {
  workspaceId: string;
  tripId: string;
  date: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<(typeof AMENITY_TABS)[number]["key"]>("sleep");
  const [msg, setMsg] = useState<string | null>(null);

  const sleepQuery = useQuery({
    ...trpc.planner.suggestOvernights.queryOptions({
      workspaceId: props.workspaceId,
      tripId: props.tripId,
      date: props.date,
      maxMiles: 25,
      limit: 12,
    }),
    enabled: tab === "sleep",
  });

  const tabDef = AMENITY_TABS.find((t) => t.key === tab)!;
  const amenityQuery = useQuery({
    ...trpc.planner.suggestAmenities.queryOptions({
      workspaceId: props.workspaceId,
      tripId: props.tripId,
      date: props.date,
      categories: tabDef.categories ?? ["fuel"],
      maxMiles: 20,
      limit: 15,
    }),
    enabled: tab !== "sleep" && !!tabDef.categories,
  });

  const applyOvernight = useMutation(
    trpc.planner.applyOvernight.mutationOptions({
      onSuccess: () => {
        setMsg("Overnight set");
        void queryClient.invalidateQueries(trpc.planner.listDays.queryFilter());
        void queryClient.invalidateQueries(
          trpc.planner.getPlanMap.queryFilter(),
        );
        void queryClient.invalidateQueries(
          trpc.planner.suggestOvernights.queryFilter(),
        );
      },
      onError: (e) => setMsg(e.message),
    }),
  );

  const center =
    tab === "sleep" ? sleepQuery.data?.center : amenityQuery.data?.center;
  const suggestions =
    tab === "sleep"
      ? (sleepQuery.data?.suggestions ?? [])
      : (amenityQuery.data?.suggestions ?? []);
  const loading =
    tab === "sleep" ? sleepQuery.isLoading : amenityQuery.isLoading;

  return (
    <div className="space-y-2 border-t border-[#21262D] pt-2">
      <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#8B949E]">
        Nearby POIs · iOverlander
      </p>
      {center && (
        <p className="font-mono text-[10px] text-[#484F58]">
          Near {center.name} ({center.lat.toFixed(2)}, {center.lng.toFixed(2)})
        </p>
      )}
      {!center && !loading && (
        <p className="text-[10px] text-[#484F58]">
          Day needs overnight coords — build the full plan first, or set lat/lng
          on the day.
        </p>
      )}

      <div className="flex flex-wrap gap-1">
        {AMENITY_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-[2px] px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${
              tab === t.key
                ? "bg-[#58A6FF]/20 text-[#58A6FF]"
                : "text-[#8B949E] hover:text-[#C9D1D9]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-[10px] text-[#484F58]">Searching POIs…</p>}

      <ul className="max-h-36 space-y-1 overflow-y-auto">
        {suggestions.map((s) => (
          <li
            key={s.id}
            className="flex items-start justify-between gap-2 rounded-[2px] border border-[#21262D] bg-[#0D1117] px-2 py-1.5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-semibold text-[#C9D1D9]">
                {s.name}
              </p>
              <p className="font-mono text-[9px] text-[#8B949E]">
                {CAT_LABEL[s.category] ?? s.category} · {s.milesAway} mi ·{" "}
                {s.source}
              </p>
            </div>
            {tab === "sleep" && (
              <button
                type="button"
                disabled={applyOvernight.isPending}
                onClick={() =>
                  applyOvernight.mutate({
                    workspaceId: props.workspaceId,
                    tripId: props.tripId,
                    date: props.date,
                    poiId: s.id,
                  })
                }
                className="shrink-0 rounded-[2px] border border-[#3FB950]/40 px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#3FB950] hover:bg-[#3FB950]/10 disabled:opacity-50"
              >
                Sleep
              </button>
            )}
          </li>
        ))}
        {!loading && suggestions.length === 0 && center && (
          <li className="text-[10px] text-[#484F58]">
            No POIs in range. Import an iOverlander CSV for this workspace if
            you haven&apos;t.
          </li>
        )}
      </ul>
      {msg && <p className="font-mono text-[10px] text-[#8B949E]">{msg}</p>}
    </div>
  );
}
