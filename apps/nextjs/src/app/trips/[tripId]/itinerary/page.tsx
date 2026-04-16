import { Button } from "@gmacko/ui/button";
import { TRPCError } from "@trpc/server";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireTripsWorkspace } from "../../_lib/server";

const PIN_TYPE_LABELS: Record<string, string> = {
  lodging: "🏨",
  activity: "🎯",
  meal: "🍽️",
  transit: "🚌",
  drinks: "🍻",
  tickets: "🎟️",
  custom: "📌",
};

const PIN_TYPE_COLORS: Record<string, string> = {
  lodging: "bg-blue-500",
  activity: "bg-green-500",
  meal: "bg-orange-500",
  transit: "bg-purple-500",
  drinks: "bg-amber-500",
  tickets: "bg-pink-500",
  custom: "bg-gray-500",
};

/** Waking hours for gap detection: 8am to 10pm. */
const WAKE_HOUR = 8;
const SLEEP_HOUR = 22;
const GAP_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

type TimelinePin = {
  id: string;
  type: string;
  title: string;
  startsAt: Date | null;
  endsAt: Date | null;
  attendees: string[];
};

function getDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function formatDateHeading(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/** Calculate bar position as a percentage within waking hours (8am-10pm = 14 hrs). */
function timeToPercent(date: Date): number {
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60;
  const clamped = Math.max(WAKE_HOUR, Math.min(SLEEP_HOUR, hours));
  return ((clamped - WAKE_HOUR) / (SLEEP_HOUR - WAKE_HOUR)) * 100;
}

type GapInfo = { afterPinTitle: string; gapMinutes: number; atPercent: number };

function detectGaps(dayPins: TimelinePin[]): GapInfo[] {
  const gaps: GapInfo[] = [];
  const timed = dayPins
    .filter((p) => p.startsAt)
    .sort(
      (a, b) =>
        new Date(a.startsAt!).getTime() - new Date(b.startsAt!).getTime(),
    );

  for (let i = 0; i < timed.length - 1; i++) {
    const current = timed[i]!;
    const next = timed[i + 1]!;
    const currentEnd = current.endsAt
      ? new Date(current.endsAt)
      : new Date(current.startsAt!);
    const nextStart = new Date(next.startsAt!);

    const endHour = currentEnd.getUTCHours();
    const startHour = nextStart.getUTCHours();

    // Only flag gaps during waking hours
    if (endHour < WAKE_HOUR || startHour > SLEEP_HOUR) continue;

    const gapMs = nextStart.getTime() - currentEnd.getTime();
    if (gapMs >= GAP_THRESHOLD_MS) {
      gaps.push({
        afterPinTitle: current.title,
        gapMinutes: Math.round(gapMs / 60_000),
        atPercent: timeToPercent(currentEnd),
      });
    }
  }

  return gaps;
}

export default async function ItineraryPage(props: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await props.params;
  const { caller, workspace } = await requireTripsWorkspace();

  try {
    const [trip, timelinePins] = await Promise.all([
      caller.trips.get({ workspaceId: workspace.id, tripId }),
      caller.pins.listForTimeline({ workspaceId: workspace.id, tripId }),
    ]);

    // Group pins by day
    const dayMap = new Map<string, TimelinePin[]>();

    // Build day range from trip dates
    if (trip.startDate && trip.endDate) {
      const start = new Date(trip.startDate + "T00:00:00Z");
      const end = new Date(trip.endDate + "T00:00:00Z");
      for (
        let d = new Date(start);
        d <= end;
        d = new Date(d.getTime() + 86_400_000)
      ) {
        dayMap.set(getDateKey(d), []);
      }
    }

    for (const pin of timelinePins) {
      if (!pin.startsAt) continue;
      const key = getDateKey(new Date(pin.startsAt));
      if (!dayMap.has(key)) {
        dayMap.set(key, []);
      }
      dayMap.get(key)!.push(pin as TimelinePin);
    }

    const sortedDays = [...dayMap.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );

    // Hour labels for the Gantt axis
    const hourLabels: number[] = [];
    for (let h = WAKE_HOUR; h <= SLEEP_HOUR; h += 2) {
      hourLabels.push(h);
    }

    return (
      <main className="container mx-auto max-w-6xl px-4 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-muted-foreground text-sm uppercase tracking-[0.24em]">
              Itinerary
            </p>
            <h1 className="text-3xl font-black tracking-tight">{trip.name}</h1>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/trips/${tripId}/map`}>Map</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/trips/${tripId}`}>Dashboard</Link>
            </Button>
          </div>
        </div>

        {sortedDays.length === 0 ? (
          <p className="text-muted-foreground py-10 text-center">
            No trip dates or pins found. Set trip dates and add pins to see the
            timeline.
          </p>
        ) : (
          <div className="space-y-6">
            {sortedDays.map(([dateStr, dayPins]) => {
              const gaps = detectGaps(dayPins);

              return (
                <section
                  key={dateStr}
                  className="bg-card overflow-hidden rounded-xl border"
                >
                  <div className="border-b px-4 py-3">
                    <h2 className="text-sm font-semibold">
                      {formatDateHeading(dateStr)}
                    </h2>
                  </div>

                  {/* Gantt axis */}
                  <div className="relative px-4 pb-4 pt-2">
                    {/* Hour markers */}
                    <div className="relative mb-2 h-5">
                      {hourLabels.map((h) => (
                        <span
                          key={h}
                          className="text-muted-foreground absolute font-mono text-[10px]"
                          style={{
                            left: `${((h - WAKE_HOUR) / (SLEEP_HOUR - WAKE_HOUR)) * 100}%`,
                            transform: "translateX(-50%)",
                          }}
                        >
                          {h > 12 ? `${h - 12}p` : h === 12 ? "12p" : `${h}a`}
                        </span>
                      ))}
                    </div>

                    {/* Background grid lines */}
                    <div className="bg-muted/30 relative min-h-[40px] rounded">
                      {hourLabels.map((h) => (
                        <div
                          key={h}
                          className="bg-border/40 absolute top-0 bottom-0 w-px"
                          style={{
                            left: `${((h - WAKE_HOUR) / (SLEEP_HOUR - WAKE_HOUR)) * 100}%`,
                          }}
                        />
                      ))}

                      {/* Pin bars */}
                      {dayPins.length === 0 ? (
                        <div className="text-muted-foreground flex h-10 items-center justify-center text-xs">
                          No events scheduled
                        </div>
                      ) : (
                        <div className="space-y-1 py-1">
                          {dayPins
                            .filter((p) => p.startsAt)
                            .sort(
                              (a, b) =>
                                new Date(a.startsAt!).getTime() -
                                new Date(b.startsAt!).getTime(),
                            )
                            .map((pin) => {
                              const startPct = timeToPercent(
                                new Date(pin.startsAt!),
                              );
                              const endPct = pin.endsAt
                                ? timeToPercent(new Date(pin.endsAt))
                                : startPct + 3; // minimal width if no end
                              const width = Math.max(endPct - startPct, 2);

                              return (
                                <div key={pin.id} className="relative h-7">
                                  <div
                                    className={`absolute top-0 h-full rounded px-1.5 text-[11px] leading-7 text-white ${PIN_TYPE_COLORS[pin.type] ?? "bg-gray-500"}`}
                                    style={{
                                      left: `${startPct}%`,
                                      width: `${width}%`,
                                      minWidth: "2rem",
                                    }}
                                    title={`${pin.title} (${formatTime(new Date(pin.startsAt!))}${pin.endsAt ? ` - ${formatTime(new Date(pin.endsAt))}` : ""})`}
                                  >
                                    <span className="truncate">
                                      {PIN_TYPE_LABELS[pin.type]}{" "}
                                      {pin.title}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      )}

                      {/* Gap indicators */}
                      {gaps.map((gap, idx) => (
                        <div
                          key={`gap-${idx}`}
                          className="absolute -bottom-1 flex items-center"
                          style={{ left: `${gap.atPercent}%` }}
                        >
                          <div className="h-3 w-3 rounded-full border-2 border-amber-500 bg-amber-100" />
                          <span className="ml-1 whitespace-nowrap text-[10px] font-medium text-amber-600">
                            {Math.round(gap.gapMinutes / 60)}h gap
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Pins without times listed below */}
                    {dayPins.filter((p) => !p.startsAt).length > 0 && (
                      <div className="mt-3 space-y-1">
                        <p className="text-muted-foreground text-[10px] uppercase tracking-widest">
                          Unscheduled
                        </p>
                        {dayPins
                          .filter((p) => !p.startsAt)
                          .map((pin) => (
                            <div
                              key={pin.id}
                              className="text-muted-foreground text-xs"
                            >
                              {PIN_TYPE_LABELS[pin.type]} {pin.title}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>
    );
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") {
      notFound();
    }
    throw error;
  }
}
