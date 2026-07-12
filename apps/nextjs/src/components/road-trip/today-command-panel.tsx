"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useTRPC } from "~/trpc/react";

/**
 * Web Today Command — same payload as mobile; replan preview + apply.
 */
export function TodayCommandPanel(props: {
  tripId: string;
  workspaceId: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState<
    "behind" | "side_trip" | "stayed" | "manual"
  >("behind");
  const [showReplan, setShowReplan] = useState(false);

  const { data, isLoading } = useQuery(
    trpc.planner.todayCommand.queryOptions({
      workspaceId: props.workspaceId,
      tripId: props.tripId,
    }),
  );

  const { data: preview } = useQuery(
    trpc.planner.replanPreview.queryOptions(
      {
        workspaceId: props.workspaceId,
        tripId: props.tripId,
        reason,
        mode: "soft_route",
      },
      { enabled: showReplan },
    ),
  );

  const apply = useMutation(
    trpc.planner.applyReplan.mutationOptions({
      onSuccess: () => {
        setShowReplan(false);
        void queryClient.invalidateQueries(
          trpc.planner.todayCommand.queryFilter(),
        );
        void queryClient.invalidateQueries(trpc.planner.listDays.queryFilter());
      },
    }),
  );

  const setStatus = useMutation(
    trpc.planner.setDayStatus.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(
          trpc.planner.todayCommand.queryFilter(),
        );
      },
    }),
  );

  if (isLoading || !data) {
    return (
      <div className="border-border text-muted-foreground border p-4 text-sm">
        Loading today…
      </div>
    );
  }

  const late = data.leaveBy?.late === true;

  return (
    <section className="border-border space-y-3 border bg-[#0D1117] p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-foreground text-sm font-bold tracking-wide uppercase">
          Today · {data.date}
        </h2>
        <span className="text-muted-foreground font-mono text-xs">
          {data.day?.intent ?? "—"} · {data.runState}
        </span>
      </div>

      {late && (
        <p className="text-xs font-semibold text-[#D29922]">
          LATE vs leave-by — cut or replan
        </p>
      )}

      <div>
        <p className="text-foreground text-lg font-bold">
          {data.day?.title ?? "No day plan"}
        </p>
        {data.day?.heroTitle && (
          <p className="text-sm font-semibold text-[#3FB950]">
            ★ {data.day.heroTitle}
          </p>
        )}
        {data.day?.cutIfBehind && (
          <p className="text-xs text-[#D29922]">
            Cut if behind: {data.day.cutIfBehind}
          </p>
        )}
      </div>

      {data.leaveBy && (
        <div className="border-border border p-3">
          <p className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
            Leave-by
          </p>
          <p
            className={`font-mono text-2xl font-bold ${late ? "text-[#D29922]" : "text-foreground"}`}
          >
            {data.leaveBy.leaveByLocal}
          </p>
          <p className="text-muted-foreground text-xs">{data.leaveBy.reason}</p>
        </div>
      )}

      <div>
        <p className="text-muted-foreground text-[10px] font-bold uppercase">
          Tonight
        </p>
        <p className="text-foreground text-sm font-semibold">
          {data.day?.overnightName ?? "—"}
        </p>
      </div>

      {(data.serviceQueue?.length ?? 0) > 0 && (
        <div className="border-border space-y-1 border p-3">
          <p className="text-muted-foreground text-[10px] font-bold uppercase">
            Service queue
          </p>
          <ol className="text-foreground list-decimal space-y-1 pl-4 text-xs">
            {data.serviceQueue.map((s) => (
              <li key={`${s.kind}-${s.name}`}>
                <span className="font-semibold uppercase">{s.kind}</span> ·{" "}
                {s.name}{" "}
                <span className="text-muted-foreground font-mono">
                  ({s.milesAway} mi)
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {data.tomorrow && (
        <p className="text-muted-foreground text-xs">
          Tomorrow · {data.tomorrow.title ?? data.tomorrow.date}
          {data.tomorrow.driveMilesEstimate != null
            ? ` · ~${data.tomorrow.driveMilesEstimate} mi`
            : ""}
        </p>
      )}

      {(data.recentDays?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1">
          {data.recentDays.map((d) => (
            <span
              key={d.date}
              className={`border px-2 py-1 font-mono text-[10px] ${
                d.isToday
                  ? "border-[#58A6FF] text-[#58A6FF]"
                  : "border-border text-muted-foreground"
              }`}
            >
              {d.date.slice(5)} · {d.status}
            </span>
          ))}
        </div>
      )}

      {data.lastFuel && (
        <p className="text-muted-foreground font-mono text-[10px]">
          Last fill
          {data.lastFuel.odometerMiles != null
            ? ` · odo ${Math.round(data.lastFuel.odometerMiles)}`
            : ""}
          {data.lastFuel.gallons != null
            ? ` · ${data.lastFuel.gallons} gal`
            : ""}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="border border-[#3FB950]/50 px-3 py-1.5 text-xs font-semibold text-[#3FB950]"
          onClick={() =>
            setStatus.mutate({
              workspaceId: props.workspaceId,
              tripId: props.tripId,
              date: data.date,
              status: "done",
            })
          }
        >
          Mark done
        </button>
        <button
          type="button"
          className="border border-[#58A6FF]/50 px-3 py-1.5 text-xs font-semibold text-[#58A6FF]"
          onClick={() => setShowReplan((s) => !s)}
        >
          {showReplan ? "Hide replan" : "Replan…"}
        </button>
      </div>

      {showReplan && (
        <div className="border-border space-y-2 border p-3">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["behind", "Behind"],
                ["side_trip", "Side trip"],
                ["stayed", "Stayed"],
                ["manual", "Manual"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setReason(k)}
                className={`border px-2 py-1 text-xs font-semibold ${
                  reason === k
                    ? "border-[#58A6FF] text-[#58A6FF]"
                    : "border-border text-muted-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {preview && (
            <>
              <p className="text-foreground text-sm">{preview.summary}</p>
              {preview.warnings.map((w) => (
                <p key={w} className="text-xs text-[#D29922]">
                  ⚠ {w}
                </p>
              ))}
              <ul className="text-muted-foreground font-mono text-xs">
                {preview.draftDays.slice(0, 10).map((d) => (
                  <li key={d.date}>
                    {d.date} · {d.intent} · {d.title ?? "—"}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={apply.isPending}
                className="border border-[#58A6FF] bg-[#58A6FF]/10 px-3 py-2 text-xs font-bold text-[#58A6FF]"
                onClick={() =>
                  apply.mutate({
                    workspaceId: props.workspaceId,
                    tripId: props.tripId,
                    reason,
                    mode: "soft_route",
                    fromDate: preview.fromDate,
                    autoAssignOvernights: true,
                  })
                }
              >
                {apply.isPending ? "Applying…" : "Accept replan"}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
