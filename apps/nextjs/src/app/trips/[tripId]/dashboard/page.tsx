import { Button } from "@gmacko/ui/button";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireTripsWorkspace } from "../../_lib/server";

function formatTime(date: Date | string | null) {
  if (!date) return "--:--";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatDate(date: string | null) {
  if (!date) return "TBD";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(date));
}

function statusColor(status: string) {
  switch (status) {
    case "scheduled": return "text-blue-400";
    case "en_route": return "text-yellow-400";
    case "delayed": return "text-red-400";
    case "arrived": return "text-green-400";
    case "cancelled": return "text-gray-500";
    default: return "text-gray-400";
  }
}

function pinTypeIcon(type: string) {
  switch (type) {
    case "lodging": return "🏠";
    case "activity": return "🎯";
    case "meal": return "🍽️";
    case "transit": return "🚇";
    case "drinks": return "🍺";
    case "tickets": return "🎫";
    default: return "📍";
  }
}

export default async function TripDashboardPage(props: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await props.params;
  const { caller, workspace } = await requireTripsWorkspace();

  let trip;
  try {
    trip = await caller.trips.get({ workspaceId: workspace.id, tripId });
  } catch {
    notFound();
  }

  // Fetch segments first (needed to scope transit/lodging queries)
  const segmentsList = await caller.trips.listSegments({ workspaceId: workspace.id, tripId }).catch(() => []);
  const firstSegmentId = (segmentsList as any[])?.[0]?.id as string | undefined;

  // Load remaining data in parallel
  const [expenses, pins, transits, lodgings, settlementSummary] = await Promise.all([
    caller.expenses.list({ workspaceId: workspace.id, tripId }),
    caller.pins.list({ workspaceId: workspace.id, tripId }),
    firstSegmentId
      ? caller.lodging.listTransitsForSegment({ workspaceId: workspace.id, tripId, segmentId: firstSegmentId })
      : Promise.resolve([]),
    firstSegmentId
      ? caller.lodging.listForSegment({ workspaceId: workspace.id, tripId, segmentId: firstSegmentId })
      : Promise.resolve([]),
    caller.settlements.summary({ workspaceId: workspace.id, tripId }),
  ].map(p => p.catch(() => null)));

  const totalExpenses = (expenses as any[])?.reduce((s: number, e: any) => s + (e.totalCents ?? 0), 0) ?? 0;
  const mealPins = ((pins as any[]) ?? []).filter((p: any) => p.type === "meal");
  const activityPins = ((pins as any[]) ?? []).filter((p: any) => p.type === "activity");
  const upcomingTransits = ((transits as any[]) ?? []).slice(0, 6);
  const allSettled = (settlementSummary as any)?.allSettled ?? false;

  return (
    <main className="min-h-screen bg-[#0A0C10] text-[#C9D1D9] font-mono">
      {/* Top bar */}
      <header className="border-b border-[#21262D] px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-xs uppercase tracking-[0.3em] text-[#8B949E]">Command Center</span>
          <span className="text-sm font-semibold text-white">{trip.name}</span>
          <span className={`text-xs px-2 py-0.5 rounded uppercase tracking-wider ${
            trip.status === "active" ? "bg-green-500/20 text-green-400" :
            trip.status === "confirmed" ? "bg-blue-500/20 text-blue-400" :
            "bg-gray-500/20 text-gray-400"
          }`}>
            {trip.status}
          </span>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/trips/${tripId}`}>Back</Link>
        </Button>
      </header>

      <div className="grid grid-cols-12 gap-px bg-[#21262D] min-h-[calc(100vh-49px)]">
        {/* Left panel: Arrivals + Lodging */}
        <section className="col-span-3 bg-[#0D1117] p-4 space-y-6 overflow-auto">
          <div>
            <h2 className="text-xs uppercase tracking-[0.2em] text-[#8B949E] mb-3">Arrivals Board</h2>
            {upcomingTransits.length === 0 ? (
              <p className="text-xs text-[#484F58]">No transits recorded</p>
            ) : (
              <div className="space-y-2">
                {upcomingTransits.map((t: any) => (
                  <div key={t.id} className="border border-[#21262D] rounded-lg p-3 bg-[#161B22]">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-white">{t.carrier ?? ""} {t.transitNumber ?? ""}</span>
                      <span className={`text-xs uppercase font-semibold ${statusColor(t.trackingStatus)}`}>
                        {t.trackingStatus}
                      </span>
                    </div>
                    <div className="text-xs text-[#8B949E] mt-1">
                      {t.departureStation ?? "?"} → {t.arrivalStation ?? "?"}
                    </div>
                    <div className="text-xs text-[#484F58] mt-1 font-mono">
                      Scheduled: {formatTime(t.scheduledAt)}
                      {t.estimatedAt && t.estimatedAt !== t.scheduledAt && (
                        <span className="text-yellow-400 ml-2">ETA: {formatTime(t.estimatedAt)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h2 className="text-xs uppercase tracking-[0.2em] text-[#8B949E] mb-3">Lodging</h2>
            {((lodgings as any[]) ?? []).length === 0 ? (
              <p className="text-xs text-[#484F58]">No lodging recorded</p>
            ) : (
              <div className="space-y-2">
                {((lodgings as any[]) ?? []).map((l: any) => (
                  <div key={l.id} className="border border-[#21262D] rounded-lg p-3 bg-[#161B22]">
                    <p className="text-sm font-semibold text-white">🏠 {l.propertyName}</p>
                    <p className="text-xs text-[#8B949E] mt-1">{l.address ?? "Address pending"}</p>
                    <p className="text-xs text-[#484F58] mt-1 font-mono">
                      Check-in: {formatTime(l.checkInAt)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Center: Map area + Activities */}
        <section className="col-span-6 bg-[#0D1117] p-4 space-y-4 overflow-auto">
          <div>
            <h2 className="text-xs uppercase tracking-[0.2em] text-[#8B949E] mb-3">
              Area Map — {trip.destinationName ?? "Destination pending"}
            </h2>
            <div className="border border-[#21262D] rounded-xl bg-[#161B22] h-64 flex items-center justify-center">
              <Link href={`/trips/${tripId}/map`} className="text-blue-400 hover:underline text-sm">
                Open interactive map →
              </Link>
            </div>
          </div>

          <div>
            <h2 className="text-xs uppercase tracking-[0.2em] text-[#8B949E] mb-3">Activities ({activityPins.length})</h2>
            <div className="grid grid-cols-2 gap-2">
              {activityPins.slice(0, 6).map((pin: any) => (
                <div key={pin.id} className="border border-[#21262D] rounded-lg p-3 bg-[#161B22]">
                  <p className="text-sm text-white">{pinTypeIcon(pin.type)} {pin.title}</p>
                  {pin.startsAt && (
                    <p className="text-xs text-[#484F58] mt-1 font-mono">{formatTime(pin.startsAt)}</p>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-xs uppercase tracking-[0.2em] text-[#8B949E] mb-3">Meals ({mealPins.length})</h2>
            <div className="grid grid-cols-2 gap-2">
              {mealPins.slice(0, 4).map((pin: any) => (
                <div key={pin.id} className="border border-[#21262D] rounded-lg p-3 bg-[#161B22]">
                  <p className="text-sm text-white">{pinTypeIcon(pin.type)} {pin.title}</p>
                  {pin.startsAt && (
                    <p className="text-xs text-[#484F58] mt-1 font-mono">{formatTime(pin.startsAt)}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Right panel: Expenses + Settlement */}
        <section className="col-span-3 bg-[#0D1117] p-4 space-y-6 overflow-auto">
          <div>
            <h2 className="text-xs uppercase tracking-[0.2em] text-[#8B949E] mb-3">Expenses</h2>
            <div className="border border-[#21262D] rounded-lg p-4 bg-[#161B22]">
              <p className="text-2xl font-mono font-bold text-white">
                ${(totalExpenses / 100).toFixed(2)}
              </p>
              <p className="text-xs text-[#484F58] mt-1">{(expenses as any[])?.length ?? 0} expenses recorded</p>
              <Link href={`/trips/${tripId}/expenses`} className="text-xs text-blue-400 hover:underline mt-2 block">
                View all →
              </Link>
            </div>
          </div>

          <div>
            <h2 className="text-xs uppercase tracking-[0.2em] text-[#8B949E] mb-3">Settlement</h2>
            <div className="border border-[#21262D] rounded-lg p-4 bg-[#161B22]">
              {allSettled ? (
                <p className="text-green-400 font-semibold">Everyone's square!</p>
              ) : (
                <>
                  <p className="text-sm text-white">
                    {(settlementSummary as any)?.suggestedTransactions?.length ?? 0} payments needed
                  </p>
                  <Link href={`/trips/${tripId}/settle`} className="text-xs text-blue-400 hover:underline mt-2 block">
                    Settle up →
                  </Link>
                </>
              )}
            </div>
          </div>

          <div>
            <h2 className="text-xs uppercase tracking-[0.2em] text-[#8B949E] mb-3">Quick Links</h2>
            <div className="space-y-2">
              {[
                { href: `/trips/${tripId}/plan`, label: "Planning" },
                { href: `/trips/${tripId}/itinerary`, label: "Itinerary" },
                { href: `/trips/${tripId}/lodging`, label: "Lodging + Arrivals" },
                { href: `/trips/${tripId}/settings`, label: "Trip Settings" },
              ].map((link) => (
                <Link key={link.href} href={link.href}
                  className="block text-sm text-[#8B949E] hover:text-white transition-colors">
                  {link.label} →
                </Link>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
