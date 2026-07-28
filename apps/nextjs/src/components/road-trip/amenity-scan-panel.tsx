"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { PoiUpload } from "~/app/trips/[tripId]/journey/_components/poi-upload";
import { useTRPC } from "~/trpc/react";

function pill(text: string, tone: "ok" | "warn" | "mute") {
  const cls =
    tone === "ok"
      ? "text-[#3FB950] border-[#3FB950]/30"
      : tone === "warn"
        ? "text-[#D29922] border-[#D29922]/30"
        : "text-[#8B949E] border-[#30363D]";
  return (
    <span
      className={`rounded-[2px] border px-1.5 py-0.5 font-mono text-[9px] ${cls}`}
    >
      {text}
    </span>
  );
}

export function AmenityScanPanel(props: {
  workspaceId: string;
  tripId: string;
  onSelectDate?: (date: string) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const scan = useQuery({
    ...trpc.planner.scanAmenities.queryOptions({
      workspaceId: props.workspaceId,
      tripId: props.tripId,
      maxMiles: 25,
    }),
    enabled: open,
  });

  const autoAssign = useMutation(
    trpc.planner.autoAssignOvernights.mutationOptions({
      onSuccess: (r) => {
        void queryClient.invalidateQueries(trpc.planner.listDays.queryFilter());
        void queryClient.invalidateQueries(
          trpc.planner.getPlanMap.queryFilter(),
        );
        void queryClient.invalidateQueries(
          trpc.planner.scanAmenities.queryFilter(),
        );
        alert(
          `Assigned ${r.assigned} overnight(s). Skipped ${r.skipped}, none found ${r.none}.`,
        );
      },
      onError: (e) => alert(e.message),
    }),
  );

  const rows = scan.data ?? [];
  const warnCount = rows.reduce((n, r) => n + r.warnings.length, 0);

  return (
    <div className="border-t border-[#21262D]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-[#161B22]"
      >
        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#8B949E]">
          Amenities · long-term
        </span>
        <span className="font-mono text-[10px] text-[#484F58]">
          {open ? "hide" : "show"}
          {open && rows.length > 0
            ? ` · ${rows.length}d · ${warnCount} warn`
            : ""}
        </span>
      </button>

      {open && (
        <div className="space-y-3 px-3 pb-3">
          <PoiUpload workspaceId={props.workspaceId} tripId={props.tripId} />

          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              disabled={autoAssign.isPending}
              onClick={() => {
                if (
                  !confirm(
                    "Auto-assign best iOverlander sleep spot for each night (skips hotels)?",
                  )
                ) {
                  return;
                }
                autoAssign.mutate({
                  workspaceId: props.workspaceId,
                  tripId: props.tripId,
                  maxMiles: 20,
                });
              }}
              className="rounded-[2px] bg-[#3FB950]/15 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-[#3FB950] hover:bg-[#3FB950]/25 disabled:opacity-50"
            >
              {autoAssign.isPending ? "Assigning…" : "Auto-assign sleep"}
            </button>
            <button
              type="button"
              onClick={() => void scan.refetch()}
              className="rounded-[2px] border border-[#30363D] px-2 py-1 text-[10px] font-semibold text-[#8B949E] hover:text-[#C9D1D9]"
            >
              Rescan
            </button>
          </div>

          {scan.isLoading && (
            <p className="text-[10px] text-[#484F58]">Scanning corridor…</p>
          )}

          {!scan.isLoading && rows.length === 0 && (
            <p className="text-[10px] text-[#484F58]">
              No days with overnight coords. Build a map plan first, then import
              iOverlander CSV if the scan is empty.
            </p>
          )}

          <ul className="max-h-56 space-y-2 overflow-y-auto">
            {rows.map((r) => (
              <li
                key={r.date}
                className="rounded-[2px] border border-[#21262D] bg-[#0D1117] p-2"
              >
                <button
                  type="button"
                  onClick={() => props.onSelectDate?.(r.date)}
                  className="mb-1 flex w-full items-center justify-between text-left"
                >
                  <span className="font-mono text-[10px] text-[#8B949E]">
                    {r.date}
                  </span>
                  <span className="truncate text-[11px] font-semibold text-[#C9D1D9]">
                    {r.placeName}
                  </span>
                </button>
                <div className="flex flex-wrap gap-1">
                  {r.overnight
                    ? pill(
                        `sleep ${r.overnight.milesAway}mi`,
                        r.overnight.milesAway <= 10 ? "ok" : "warn",
                      )
                    : pill("no sleep", "warn")}
                  {r.fuel
                    ? pill(`fuel ${r.fuel.milesAway}mi`, "ok")
                    : pill("no fuel", "mute")}
                  {r.dump
                    ? pill(`dump ${r.dump.milesAway}mi`, "ok")
                    : pill("no dump", "mute")}
                  {r.water
                    ? pill(`water ${r.water.milesAway}mi`, "ok")
                    : pill("no water", "mute")}
                  {r.parking
                    ? pill(`park ${r.parking.milesAway}mi`, "ok")
                    : null}
                  {r.tolls.length > 0
                    ? pill(`toll×${r.tolls.length}`, "warn")
                    : null}
                </div>
                {r.overnight && (
                  <p className="mt-1 truncate text-[10px] text-[#8B949E]">
                    ★ {r.overnight.name} ({r.overnight.category})
                  </p>
                )}
                {r.warnings.map((w) => (
                  <p key={w} className="text-[10px] text-[#D29922]">
                    {w}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
