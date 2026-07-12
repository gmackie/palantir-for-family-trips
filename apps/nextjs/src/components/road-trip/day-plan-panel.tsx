"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { AmenityScanPanel } from "~/components/road-trip/amenity-scan-panel";
import { DayBriefingCard } from "~/components/road-trip/day-briefing-card";
import { OvernightSuggest } from "~/components/road-trip/overnight-suggest";
import { useTRPC } from "~/trpc/react";

const INTENTS = ["play", "drive", "position", "event", "recovery"] as const;
const OVERNIGHT_KINDS = ["dispersed", "campground", "hotel", "unknown"] as const;

const INTENT_STYLE: Record<string, string> = {
  play: "bg-[#3FB950]/15 text-[#3FB950] border-[#3FB950]/30",
  drive: "bg-[#58A6FF]/15 text-[#58A6FF] border-[#58A6FF]/30",
  position: "bg-[#D29922]/15 text-[#D29922] border-[#D29922]/30",
  event: "bg-[#A371F7]/15 text-[#A371F7] border-[#A371F7]/30",
  recovery: "bg-[#8B949E]/15 text-[#8B949E] border-[#8B949E]/30",
};

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatShort(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

type DayIntent = (typeof INTENTS)[number];
type OvernightKind = (typeof OVERNIGHT_KINDS)[number];

type DayRow = {
  id: string;
  date: string;
  intent: string;
  title: string | null;
  overnightName: string | null;
  overnightKind: string | null;
  heroTitle: string | null;
  heroDetail: string | null;
  cutIfBehind: string | null;
  note: string | null;
};

function dayPayload(
  d: DayRow,
  patch: Partial<{
    intent: DayIntent;
    title: string | null;
    overnightName: string | null;
    overnightKind: OvernightKind | null;
    heroTitle: string | null;
    heroDetail: string | null;
    cutIfBehind: string | null;
    note: string | null;
  }>,
) {
  return {
    date: d.date,
    intent: (patch.intent ?? d.intent) as DayIntent,
    title: patch.title !== undefined ? patch.title : d.title,
    overnightName:
      patch.overnightName !== undefined ? patch.overnightName : d.overnightName,
    overnightKind: (patch.overnightKind !== undefined
      ? patch.overnightKind
      : d.overnightKind) as OvernightKind | null,
    heroTitle: patch.heroTitle !== undefined ? patch.heroTitle : d.heroTitle,
    heroDetail:
      patch.heroDetail !== undefined ? patch.heroDetail : d.heroDetail,
    cutIfBehind:
      patch.cutIfBehind !== undefined ? patch.cutIfBehind : d.cutIfBehind,
    note: patch.note !== undefined ? patch.note : d.note,
  };
}

export function DayPlanPanel(props: {
  workspaceId: string;
  tripId: string;
  /** Controlled selection from map marker clicks. */
  selectedDate?: string | null;
  onSelectedDateChange?: (date: string | null) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [internalSelected, setInternalSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "upcoming">("all");
  const [actionsOpen, setActionsOpen] = useState(false);
  const [seedFrom, setSeedFrom] = useState("2026-07-11");
  const [seedTo, setSeedTo] = useState("2026-07-15");
  const [msg, setMsg] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedDate = props.selectedDate ?? internalSelected;
  const setSelectedDate = (d: string | null) => {
    setInternalSelected(d);
    props.onSelectedDateChange?.(d);
  };

  const daysQuery = useQuery(
    trpc.planner.listDays.queryOptions({
      workspaceId: props.workspaceId,
      tripId: props.tripId,
    }),
  );
  const anchorsQuery = useQuery(
    trpc.anchors.list.queryOptions({
      workspaceId: props.workspaceId,
      tripId: props.tripId,
    }),
  );
  const nextAnchorQuery = useQuery(
    trpc.anchors.next.queryOptions({
      workspaceId: props.workspaceId,
      tripId: props.tripId,
    }),
  );
  const planMapQuery = useQuery(
    trpc.planner.getPlanMap.queryOptions({
      workspaceId: props.workspaceId,
      tripId: props.tripId,
    }),
  );

  const invalidate = () => {
    void queryClient.invalidateQueries(trpc.planner.listDays.queryFilter());
    void queryClient.invalidateQueries(trpc.planner.getPlanMap.queryFilter());
    void queryClient.invalidateQueries(trpc.anchors.list.queryFilter());
    void queryClient.invalidateQueries(trpc.anchors.next.queryFilter());
    void queryClient.invalidateQueries(trpc.trips.listSegments.queryFilter());
    router.refresh();
  };

  const seedRange = useMutation(
    trpc.planner.seedRange.mutationOptions({
      onSuccess: (r) => {
        setMsg(`Seeded ${r.created} day(s)`);
        invalidate();
      },
      onError: (e) => setMsg(e.message),
    }),
  );

  const applyDraft = useMutation(
    trpc.planner.applyDraft.mutationOptions({
      onSuccess: (r) => {
        setMsg(`Applied ${r.upserted} day(s)`);
        invalidate();
      },
      onError: (e) => setMsg(e.message),
    }),
  );

  const planItinerary = useMutation(
    trpc.planner.planItinerary.mutationOptions({
      onSuccess: (r) => {
        const kept =
          r.keptPastDays > 0 ? ` · kept ${r.keptPastDays} past` : "";
        const gps = r.usedLiveOrigin ? " · GPS origin" : "";
        const sleep =
          r.overnightsAssigned > 0
            ? ` · ${r.overnightsAssigned} sleep assigned`
            : "";
        setMsg(
          `Plan: ${r.dayCount} days · ${r.segmentCount} legs · ${r.totalMiles} mi · ${r.anchorCount} anchors${kept}${gps}${sleep}`,
        );
        invalidate();
        void queryClient.invalidateQueries(
          trpc.planner.scanAmenities.queryFilter(),
        );
      },
      onError: (e) => setMsg(e.message),
    }),
  );

  const today = todayUtc();
  const [gpsBusy, setGpsBusy] = useState(false);

  async function replanFromGps() {
    setGpsBusy(true);
    setMsg(null);
    try {
      if (!navigator.geolocation) {
        setMsg("Geolocation not available in this browser");
        return;
      }
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15_000,
        });
      });
      if (
        !confirm(
          `Replan from GPS (${pos.coords.latitude.toFixed(3)}, ${pos.coords.longitude.toFixed(3)}) starting ${today}?\n\nPast days stay. Next leg routes from your live position.`,
        )
      ) {
        return;
      }
      planItinerary.mutate({
        workspaceId: props.workspaceId,
        tripId: props.tripId,
        template: "open_sauce_full",
        replaceExisting: true,
        fromDate: today,
        origin: {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          name: "Current location",
        },
      });
    } catch (e) {
      setMsg(
        e instanceof GeolocationPositionError
          ? `GPS: ${e.message}`
          : e instanceof Error
            ? e.message
            : "Could not read GPS",
      );
    } finally {
      setGpsBusy(false);
    }
  }

  const upsertDay = useMutation(
    trpc.planner.upsertDay.mutationOptions({
      onSuccess: () => invalidate(),
      onError: (e) => setMsg(e.message),
    }),
  );

  const deleteDay = useMutation(
    trpc.planner.deleteDay.mutationOptions({
      onSuccess: () => {
        setSelectedDate(null);
        invalidate();
      },
      onError: (e) => setMsg(e.message),
    }),
  );

  const createAnchor = useMutation(
    trpc.anchors.create.mutationOptions({
      onSuccess: () => {
        setMsg("Anchor added");
        invalidate();
      },
      onError: (e) => setMsg(e.message),
    }),
  );

  const deleteAnchor = useMutation(
    trpc.anchors.delete.mutationOptions({
      onSuccess: () => invalidate(),
      onError: (e) => setMsg(e.message),
    }),
  );

  const days = (daysQuery.data ?? []) as DayRow[];
  const filtered = useMemo(() => {
    if (filter === "upcoming") return days.filter((d) => d.date >= today);
    return days;
  }, [days, filter, today]);

  const selected =
    days.find((d) => d.date === selectedDate) ??
    days.find((d) => d.date >= today) ??
    days[0];

  // Scroll selected day into view
  useEffect(() => {
    if (!selected?.date || !listRef.current) return;
    const el = listRef.current.querySelector(
      `[data-day-date="${selected.date}"]`,
    );
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected?.date]);

  async function loadOpenSauceTemplate() {
    setMsg(null);
    try {
      const draft = await queryClient.fetchQuery(
        trpc.planner.replanDraft.queryOptions({
          workspaceId: props.workspaceId,
          tripId: props.tripId,
          fromDate: "2026-07-11",
          untilDate: "2026-07-15",
          template: "open_sauce_approach",
        }),
      );
      applyDraft.mutate({
        workspaceId: props.workspaceId,
        tripId: props.tripId,
        days: draft,
      });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to load template");
    }
  }

  function save(d: DayRow, patch: Parameters<typeof dayPayload>[1]) {
    upsertDay.mutate({
      workspaceId: props.workspaceId,
      tripId: props.tripId,
      ...dayPayload(d, patch),
    });
  }

  const next = nextAnchorQuery.data;
  const planMiles = planMapQuery.data?.totalMiles;
  const dayCount = days.length;
  const playCount = days.filter((d) => d.intent === "play").length;

  return (
    <div className="flex h-full flex-col text-[#C9D1D9]">
      {/* Header + pacing */}
      <div className="border-b border-[#21262D] px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#8B949E]">
            Day plan
          </p>
          <button
            type="button"
            onClick={() => setActionsOpen((o) => !o)}
            className="text-[9px] font-bold uppercase tracking-wider text-[#58A6FF] hover:underline"
          >
            {actionsOpen ? "Hide tools" : "Tools"}
          </button>
        </div>
        <p className="mt-1 font-mono text-[10px] text-[#8B949E]">
          {dayCount}d
          {playCount > 0 ? ` · ${playCount} play` : ""}
          {planMiles != null && planMiles > 0
            ? ` · ${Math.round(planMiles).toLocaleString()} mi`
            : ""}
        </p>
        {next && (
          <p
            className={`mt-1 font-mono text-[10px] ${next.behind ? "text-[#F85149]" : "text-[#D29922]"}`}
          >
            Next: {next.anchor.title}
            {next.daysUntil != null ? ` · ${next.daysUntil}d` : ""}
            {next.milesAway != null ? ` · ${next.milesAway}mi` : ""}
            {next.milesPerDay != null ? ` · ~${next.milesPerDay}/d` : ""}
            {next.behind ? " · BEHIND" : ""}
          </p>
        )}
      </div>

      {/* Collapsible tools */}
      {actionsOpen && (
        <div className="space-y-2 border-b border-[#21262D] p-3">
          <button
            type="button"
            disabled={planItinerary.isPending}
            onClick={() => {
              if (
                !confirm(
                  "Build full multi-day plan (Hood → coast → Open Sauce → Yosemite → Bryce → Moab)?\n\nReplaces segments, days, and anchors, then routes every leg.",
                )
              ) {
                return;
              }
              planItinerary.mutate({
                workspaceId: props.workspaceId,
                tripId: props.tripId,
                template: "open_sauce_full",
                replaceExisting: true,
              });
            }}
            className="w-full rounded-[2px] bg-[#3FB950] px-2 py-2 text-[10px] font-black uppercase tracking-wider text-[#0A0C10] hover:bg-[#56D364] disabled:opacity-50"
          >
            {planItinerary.isPending
              ? "Routing…"
              : "Build full map plan (→ Moab)"}
          </button>
          <button
            type="button"
            disabled={planItinerary.isPending}
            onClick={() => {
              if (
                !confirm(
                  `Replan from today (${today}) forward?\n\nPast days stay as-is. Remaining template stops are re-routed from ${today}.`,
                )
              ) {
                return;
              }
              planItinerary.mutate({
                workspaceId: props.workspaceId,
                tripId: props.tripId,
                template: "open_sauce_full",
                replaceExisting: true,
                fromDate: today,
              });
            }}
            className="w-full rounded-[2px] border border-[#D29922]/40 bg-[#D29922]/10 px-2 py-1.5 text-[10px] font-black uppercase tracking-wider text-[#D29922] hover:bg-[#D29922]/20 disabled:opacity-50"
          >
            Replan from today
          </button>
          <button
            type="button"
            disabled={planItinerary.isPending || gpsBusy}
            onClick={() => void replanFromGps()}
            className="w-full rounded-[2px] border border-[#58A6FF]/40 bg-[#58A6FF]/10 px-2 py-1.5 text-[10px] font-black uppercase tracking-wider text-[#58A6FF] hover:bg-[#58A6FF]/20 disabled:opacity-50"
          >
            {gpsBusy ? "Reading GPS…" : "Replan from GPS"}
          </button>
          <button
            type="button"
            disabled={applyDraft.isPending}
            onClick={() => void loadOpenSauceTemplate()}
            className="w-full rounded-[2px] bg-[#58A6FF]/10 px-2 py-1.5 text-[10px] font-black uppercase tracking-wider text-[#58A6FF] hover:bg-[#58A6FF]/20 disabled:opacity-50"
          >
            Days only: Jul 11–15
          </button>
          <div className="flex flex-wrap items-center gap-1">
            <input
              type="date"
              value={seedFrom}
              onChange={(e) => setSeedFrom(e.target.value)}
              className="rounded-[2px] border border-[#30363D] bg-[#0D1117] px-1 py-0.5 font-mono text-[10px] text-[#C9D1D9]"
            />
            <span className="text-[10px] text-[#484F58]">→</span>
            <input
              type="date"
              value={seedTo}
              onChange={(e) => setSeedTo(e.target.value)}
              className="rounded-[2px] border border-[#30363D] bg-[#0D1117] px-1 py-0.5 font-mono text-[10px] text-[#C9D1D9]"
            />
            <button
              type="button"
              disabled={seedRange.isPending}
              onClick={() =>
                seedRange.mutate({
                  workspaceId: props.workspaceId,
                  tripId: props.tripId,
                  fromDate: seedFrom,
                  untilDate: seedTo,
                })
              }
              className="rounded-[2px] border border-[#30363D] px-2 py-0.5 text-[10px] font-semibold text-[#8B949E] hover:border-[#58A6FF]/40 hover:text-[#58A6FF] disabled:opacity-50"
            >
              Seed empty
            </button>
          </div>
          {msg && (
            <p className="font-mono text-[10px] text-[#8B949E]">{msg}</p>
          )}
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-1 border-b border-[#21262D] px-2 py-1.5">
        {(["all", "upcoming"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-[2px] px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${
              filter === f
                ? "bg-[#58A6FF]/15 text-[#58A6FF]"
                : "text-[#8B949E] hover:text-[#C9D1D9]"
            }`}
          >
            {f}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setFilter("all");
            setSelectedDate(today);
          }}
          className="ml-auto rounded-[2px] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#D29922] hover:bg-[#D29922]/10"
        >
          Today
        </button>
      </div>

      {selected && (
        <DayBriefingCard
          workspaceId={props.workspaceId}
          tripId={props.tripId}
          date={selected.date}
        />
      )}

      {/* Day list */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        {daysQuery.isLoading ? (
          <p className="p-4 text-xs text-[#484F58]">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="p-4">
            <p className="text-xs text-[#484F58]">
              No trip days yet. Open Tools → build the full map plan.
            </p>
            <button
              type="button"
              onClick={() => setActionsOpen(true)}
              className="mt-2 text-[10px] font-bold text-[#58A6FF] hover:underline"
            >
              Open tools
            </button>
          </div>
        ) : (
          filtered.map((d) => {
            const isToday = d.date === today;
            const isPast = d.date < today;
            const isSel = selected?.id === d.id;
            return (
              <button
                key={d.id}
                type="button"
                data-day-date={d.date}
                onClick={() => setSelectedDate(d.date)}
                className={`flex w-full flex-col gap-0.5 border-b border-[#21262D]/50 px-3 py-2.5 text-left transition-colors hover:bg-[#161B22] ${
                  isSel ? "bg-[#161B22] ring-1 ring-inset ring-[#58A6FF]/40" : ""
                } ${isPast ? "opacity-55" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-[#8B949E]">
                    {formatShort(d.date)}
                  </span>
                  {isToday && (
                    <span className="rounded-[2px] bg-[#D29922]/20 px-1 text-[8px] font-black uppercase text-[#D29922]">
                      Today
                    </span>
                  )}
                  <span
                    className={`rounded-[2px] border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${INTENT_STYLE[d.intent] ?? INTENT_STYLE.drive}`}
                  >
                    {d.intent}
                  </span>
                </div>
                <p className="truncate text-sm font-medium text-[#C9D1D9]">
                  {d.title ?? d.overnightName ?? "Untitled day"}
                </p>
                {d.heroTitle && (
                  <p className="truncate text-[11px] text-[#8B949E]">
                    ★ {d.heroTitle}
                  </p>
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Selected day editor */}
      {selected && (
        <div className="max-h-[42%] space-y-2 overflow-y-auto border-t border-[#21262D] p-3">
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#8B949E]">
              Edit · {formatShort(selected.date)}
            </p>
            <button
              type="button"
              disabled={deleteDay.isPending}
              onClick={() => {
                if (!confirm(`Delete ${selected.date}?`)) return;
                deleteDay.mutate({
                  workspaceId: props.workspaceId,
                  tripId: props.tripId,
                  dayId: selected.id,
                });
              }}
              className="text-[9px] font-bold uppercase text-[#F85149] hover:underline disabled:opacity-50"
            >
              Delete
            </button>
          </div>

          <label className="block text-[10px] text-[#8B949E]">
            Intent
            <select
              value={selected.intent}
              onChange={(e) =>
                save(selected, { intent: e.target.value as DayIntent })
              }
              className="mt-0.5 w-full rounded-[2px] border border-[#30363D] bg-[#0D1117] px-2 py-1 text-xs text-[#C9D1D9]"
            >
              {INTENTS.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </label>

          {(
            [
              ["Title / area", "title", selected.title],
              ["Overnight place", "overnightName", selected.overnightName],
              ["Hero", "heroTitle", selected.heroTitle],
              ["Hero detail", "heroDetail", selected.heroDetail],
              ["Cut if behind", "cutIfBehind", selected.cutIfBehind],
              ["Note", "note", selected.note],
            ] as const
          ).map(([label, key, value]) => (
            <label key={key} className="block text-[10px] text-[#8B949E]">
              {label}
              <input
                defaultValue={value ?? ""}
                key={`${selected.id}-${key}`}
                onBlur={(e) => {
                  const v = e.target.value.trim() || null;
                  if (v === value) return;
                  save(selected, { [key]: v });
                }}
                className="mt-0.5 w-full rounded-[2px] border border-[#30363D] bg-[#0D1117] px-2 py-1 text-xs text-[#C9D1D9]"
              />
            </label>
          ))}

          <label className="block text-[10px] text-[#8B949E]">
            Overnight kind
            <select
              value={selected.overnightKind ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                save(selected, {
                  overnightKind: v
                    ? (v as OvernightKind)
                    : null,
                });
              }}
              className="mt-0.5 w-full rounded-[2px] border border-[#30363D] bg-[#0D1117] px-2 py-1 text-xs text-[#C9D1D9]"
            >
              <option value="">—</option>
              {OVERNIGHT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>

          <OvernightSuggest
            workspaceId={props.workspaceId}
            tripId={props.tripId}
            date={selected.date}
          />
        </div>
      )}

      <AmenityScanPanel
        workspaceId={props.workspaceId}
        tripId={props.tripId}
        onSelectDate={(date) => setSelectedDate(date)}
      />

      {/* Anchors */}
      <div className="border-t border-[#21262D] p-3">
        <p className="mb-1 text-[9px] font-black uppercase tracking-[0.2em] text-[#8B949E]">
          Anchors
        </p>
        {(anchorsQuery.data ?? []).length === 0 ? (
          <p className="text-[10px] text-[#484F58]">
            None — build full plan or add below
          </p>
        ) : (
          <ul className="max-h-24 space-y-1 overflow-y-auto">
            {(anchorsQuery.data ?? []).map((a) => (
              <li
                key={String(a.id)}
                className="flex items-start justify-between gap-2 font-mono text-[10px] text-[#C9D1D9]"
              >
                <span>
                  <span className="text-[#A371F7]">{String(a.kind)}</span>{" "}
                  {String(a.title)}{" "}
                  <span className="text-[#484F58]">
                    {String(a.startDate)}
                    {a.endDate && a.endDate !== a.startDate
                      ? `–${String(a.endDate)}`
                      : ""}
                  </span>
                </span>
                <button
                  type="button"
                  className="shrink-0 text-[#F85149]/80 hover:text-[#F85149]"
                  onClick={() =>
                    deleteAnchor.mutate({
                      workspaceId: props.workspaceId,
                      tripId: props.tripId,
                      anchorId: String(a.id),
                    })
                  }
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
