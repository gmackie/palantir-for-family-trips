"use client";

import { useEffect, useRef } from "react";

const INTENT_STYLE: Record<string, string> = {
  play: "border-[#3FB950]/50 text-[#3FB950] bg-[#3FB950]/10",
  drive: "border-[#58A6FF]/50 text-[#58A6FF] bg-[#58A6FF]/10",
  position: "border-[#D29922]/50 text-[#D29922] bg-[#D29922]/10",
  event: "border-[#A371F7]/50 text-[#A371F7] bg-[#A371F7]/10",
  recovery: "border-[#8B949E]/50 text-[#8B949E] bg-[#8B949E]/10",
};

export type DayChip = {
  date: string;
  intent: string;
  title: string | null;
  overnightName: string | null;
  heroTitle: string | null;
  /** Short amenity flags e.g. sleep/fuel/toll */
  amenityFlags?: string[];
  hasWarnings?: boolean;
};

function formatChipDate(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

export function DayChips(props: {
  days: DayChip[];
  selectedDate: string | null;
  onSelect: (date: string) => void;
}) {
  const today = todayUtc();
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!props.selectedDate || !scrollerRef.current) return;
    const el = scrollerRef.current.querySelector(
      `[data-chip-date="${props.selectedDate}"]`,
    );
    if (el instanceof HTMLElement) {
      el.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      });
    }
  }, [props.selectedDate, props.days.length]);

  if (props.days.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-[#0A0C10] via-[#0A0C10]/95 to-transparent pb-2 pt-8">
      <div
        ref={scrollerRef}
        className="pointer-events-auto flex gap-1.5 overflow-x-auto px-3 pb-1 scroll-smooth"
      >
        {props.days.map((d) => {
          const selected = props.selectedDate === d.date;
          const isToday = d.date === today;
          const isPast = d.date < today;
          const label = d.title ?? d.overnightName ?? d.date;
          return (
            <button
              key={d.date}
              type="button"
              data-chip-date={d.date}
              onClick={() => props.onSelect(d.date)}
              className={`shrink-0 rounded-[3px] border px-2.5 py-1.5 text-left transition-colors ${
                selected
                  ? "border-[#58A6FF] bg-[#58A6FF]/15 ring-1 ring-[#58A6FF]/40"
                  : (INTENT_STYLE[d.intent] ?? INTENT_STYLE.drive)
              } ${isPast && !selected ? "opacity-50" : ""}`}
            >
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[9px] text-[#8B949E]">
                  {formatChipDate(d.date)}
                </span>
                {isToday && (
                  <span className="text-[8px] font-black uppercase text-[#D29922]">
                    now
                  </span>
                )}
              </div>
              <p className="max-w-[110px] truncate text-[11px] font-semibold text-[#C9D1D9]">
                {label}
              </p>
              <p className="text-[8px] font-black uppercase tracking-wider opacity-80">
                {d.intent}
              </p>
              {(d.amenityFlags?.length || d.hasWarnings) && (
                <p
                  className={`mt-0.5 font-mono text-[8px] ${
                    d.hasWarnings ? "text-[#D29922]" : "text-[#484F58]"
                  }`}
                >
                  {d.hasWarnings ? "⚠ " : ""}
                  {(d.amenityFlags ?? []).slice(0, 3).join(" · ")}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
