"use client";

import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

export function DayBriefingCard(props: {
  workspaceId: string;
  tripId: string;
  date: string;
}) {
  const trpc = useTRPC();
  const briefing = useQuery(
    trpc.daymap.briefing.queryOptions({
      workspaceId: props.workspaceId,
      tripId: props.tripId,
      date: props.date,
    }),
  );

  const b = briefing.data;
  if (briefing.isLoading) {
    return (
      <div className="border-b border-[#21262D] px-3 py-2">
        <p className="text-[10px] text-[#484F58]">Loading briefing…</p>
      </div>
    );
  }
  if (!b) {
    return (
      <div className="border-b border-[#21262D] px-3 py-2">
        <p className="text-[10px] text-[#484F58]">
          No briefing yet — need a plan day or route position.
        </p>
      </div>
    );
  }

  return (
    <div className="max-h-44 space-y-1.5 overflow-y-auto border-b border-[#21262D] px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
          Briefing · {props.date.slice(5)}
        </p>
        {b.plannedDay && (
          <span className="rounded-[2px] border border-[#58A6FF]/30 px-1.5 py-0.5 text-[8px] font-black uppercase text-[#58A6FF]">
            {b.plannedDay.intent}
          </span>
        )}
      </div>
      {b.drive && (
        <p className="font-mono text-[10px] text-[#C9D1D9]">
          {b.drive.fromName} → {b.drive.toName} · {b.drive.miles} mi · ~
          {b.drive.hours}h
        </p>
      )}
      {b.weather && (
        <p className="text-[10px] text-[#8B949E]">
          {b.weather.label} · {b.weather.highF}°/{b.weather.lowF}° · precip{" "}
          {b.weather.precipProbability}%
        </p>
      )}
      <ul className="space-y-1">
        {b.schedule.slice(0, 4).map((s, i) => (
          <li key={`${s.part}-${i}`} className="text-[11px] text-[#C9D1D9]">
            <span className="font-mono text-[9px] uppercase text-[#484F58]">
              {s.part}
            </span>{" "}
            <span className="font-semibold">{s.title}</span>
            {s.detail ? (
              <span className="text-[#8B949E]"> — {s.detail}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {b.notes.slice(0, 3).map((n) => (
        <p key={n} className="text-[10px] text-[#D29922]">
          {n}
        </p>
      ))}
    </div>
  );
}
