"use client";

import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

const PIN_TYPE_COLORS: Record<string, string> = {
  lodging: "bg-[#58A6FF]",
  activity: "bg-[#3FB950]",
  meal: "bg-[#D29922]",
  transit: "bg-[#BC8CFF]",
  drinks: "bg-[#D29922]",
  tickets: "bg-[#F778BA]",
  custom: "bg-[#8B949E]",
};

function getDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function timeToPercent(date: Date): number {
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60;
  const clamped = Math.max(6, Math.min(23, hours));
  return ((clamped - 6) / 17) * 100;
}

export function TimelineBar(props: {
  tripId: string;
  workspaceId: string;
  startDate: string | null;
  endDate: string | null;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const { tripId, workspaceId, startDate, endDate, isOpen, onToggle } = props;
  const trpc = useTRPC();

  const { data: pins } = useQuery(
    trpc.pins.list.queryOptions({ workspaceId, tripId }),
  );

  // Build day list
  const days: string[] = [];
  if (startDate && endDate) {
    const start = new Date(startDate + "T00:00:00Z");
    const end = new Date(endDate + "T00:00:00Z");
    for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86_400_000)) {
      days.push(getDateKey(d));
    }
  }

  // Group pins by day
  const pinsByDay = new Map<string, Array<{ id: string; type: string; title: string; startsAt: Date | string | null; endsAt: Date | string | null }>>();
  for (const day of days) {
    pinsByDay.set(day, []);
  }
  if (pins) {
    for (const pin of pins) {
      if (!pin.startsAt) continue;
      const key = getDateKey(new Date(pin.startsAt));
      const arr = pinsByDay.get(key);
      if (arr) arr.push(pin);
    }
  }

  const todayKey = new Date().toISOString().slice(0, 10);

  return (
    <div className="border-t border-[#21262D] bg-[#0D1117]">
      {/* Toggle header */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-4 py-1.5 text-left hover:bg-[#161B22] transition-colors"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className={`text-[#8B949E] transition-transform ${isOpen ? "rotate-180" : ""}`}
        >
          <path d="M2 3l3 4 3-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#8B949E]">
          Timeline
        </span>
        {days.length > 0 && (
          <span className="text-[9px] text-[#484F58]">
            {days.length} days
          </span>
        )}
      </button>

      {/* Timeline content */}
      {isOpen && (
        <div className="overflow-x-auto px-4 pb-3">
          {days.length === 0 ? (
            <p className="py-2 text-xs text-[#484F58]">
              Set trip dates to see the timeline.
            </p>
          ) : (
            <div className="flex gap-1" style={{ minWidth: `${days.length * 120}px` }}>
              {days.map((day) => {
                const dayPins = pinsByDay.get(day) ?? [];
                const isToday = day === todayKey;
                const dayLabel = new Date(day + "T00:00:00Z").toLocaleDateString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  timeZone: "UTC",
                });

                return (
                  <div
                    key={day}
                    className={`flex-1 min-w-[100px] rounded-[2px] border p-1.5 ${
                      isToday
                        ? "border-[#58A6FF]/40 bg-[#58A6FF]/5"
                        : "border-[#21262D] bg-[#161B22]"
                    }`}
                  >
                    <p className={`text-[9px] font-bold ${isToday ? "text-[#58A6FF]" : "text-[#8B949E]"}`}>
                      {dayLabel}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-0.5">
                      {dayPins.map((pin) => (
                        <div
                          key={pin.id}
                          title={`${pin.title}${pin.startsAt ? ` (${new Date(pin.startsAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })})` : ""}`}
                          className={`h-2.5 w-2.5 rounded-[1px] ${PIN_TYPE_COLORS[pin.type] ?? "bg-[#8B949E]"}`}
                        />
                      ))}
                      {dayPins.length === 0 && (
                        <span className="text-[8px] text-[#484F58]">--</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
