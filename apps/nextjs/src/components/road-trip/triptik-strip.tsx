"use client";

import { useState } from "react";

interface TripTikItem {
  id: string;
  type: "origin" | "fuel_zone" | "poi" | "overnight_zone" | "destination";
  name: string;
  mileMarker: number;
  estimatedTime?: string;
  category?: string;
  details?: string;
}

interface TripTikSegment {
  id: string;
  name: string;
  distanceMiles: number;
  durationMinutes: number;
  dayNumber: number;
  items: TripTikItem[];
}

interface TripTikStripProps {
  segments: TripTikSegment[];
  totalMiles: number;
  currentDayIndex?: number;
  onItemClick?: (itemId: string) => void;
  onDayChange?: (dayIndex: number) => void;
}

const TYPE_ICONS: Record<string, string> = {
  origin: "🟢",
  fuel_zone: "⛽",
  poi: "📍",
  overnight_zone: "🌅",
  destination: "🔴",
};

const TYPE_COLORS: Record<string, string> = {
  origin: "border-[#3FB950]",
  fuel_zone: "border-[#D29922]",
  poi: "border-[#58A6FF]",
  overnight_zone: "border-[#D29922]",
  destination: "border-[#F85149]",
};

export function TripTikStrip({
  segments,
  totalMiles,
  currentDayIndex = 0,
  onItemClick,
  onDayChange,
}: TripTikStripProps) {
  const [activeDay, setActiveDay] = useState(currentDayIndex);

  const handleDayChange = (index: number) => {
    setActiveDay(index);
    onDayChange?.(index);
  };

  const activeSegment = segments[activeDay];

  return (
    <div className="flex h-full flex-col">
      {/* Day selector */}
      <div className="flex gap-1 overflow-x-auto border-b border-[#21262D] p-2">
        {segments.map((seg, i) => (
          <button
            key={seg.id}
            onClick={() => handleDayChange(i)}
            className={`shrink-0 rounded-[2px] px-3 py-1.5 text-xs font-semibold transition-colors ${
              i === activeDay
                ? "bg-[#58A6FF]/10 text-[#58A6FF] border border-[#58A6FF]/30"
                : "text-[#8B949E] hover:text-[#C9D1D9] border border-transparent"
            }`}
          >
            Day {seg.dayNumber}
          </button>
        ))}
      </div>

      {/* Segment header */}
      {activeSegment && (
        <div className="border-b border-[#21262D] px-4 py-3">
          <h3 className="text-sm font-bold text-[#C9D1D9]">
            {activeSegment.name}
          </h3>
          <p className="font-mono text-xs text-[#8B949E]">
            {activeSegment.distanceMiles} mi &middot;{" "}
            {Math.floor(activeSegment.durationMinutes / 60)}h
            {activeSegment.durationMinutes % 60}m
          </p>
        </div>
      )}

      {/* Timeline items */}
      <div className="flex-1 overflow-y-auto">
        {activeSegment?.items.map((item, i) => (
          <button
            key={item.id}
            onClick={() => onItemClick?.(item.id)}
            className="flex w-full items-start gap-3 border-b border-[#21262D]/50 px-4 py-3 text-left transition-colors hover:bg-[#161B22]"
          >
            {/* Timeline line + dot */}
            <div className="flex flex-col items-center pt-0.5">
              <span className="text-base">{TYPE_ICONS[item.type] ?? "📍"}</span>
              {i < (activeSegment?.items.length ?? 0) - 1 && (
                <div className="mt-1 h-8 w-px bg-[#21262D]" />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium text-[#C9D1D9]">
                {item.name}
              </p>
              <div className="flex items-center gap-2 text-xs text-[#8B949E]">
                <span className="font-mono">
                  mi {item.mileMarker.toLocaleString()}
                </span>
                {item.estimatedTime && (
                  <>
                    <span>&middot;</span>
                    <span className="font-mono">{item.estimatedTime}</span>
                  </>
                )}
              </div>
              {item.details && (
                <p className="mt-0.5 text-xs text-[#484F58]">{item.details}</p>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Trip progress footer */}
      <div className="border-t border-[#21262D] px-4 py-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-[#8B949E]">Total</span>
          <span className="font-mono font-semibold text-[#C9D1D9]">
            {totalMiles.toLocaleString()} mi
          </span>
        </div>
      </div>
    </div>
  );
}
