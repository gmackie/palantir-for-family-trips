import { Button } from "@gmacko/ui/button";
import { TRPCError } from "@trpc/server";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireTripsWorkspace } from "../../_lib/server";

const PROVIDER_LABELS: Record<string, string> = {
  airbnb: "Airbnb",
  vrbo: "Vrbo",
  hotel: "Hotel",
  hostel: "Hostel",
  other: "Other",
};

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800",
  en_route: "bg-yellow-100 text-yellow-800",
  delayed: "bg-red-100 text-red-800",
  arrived: "bg-green-100 text-green-800",
  cancelled: "bg-gray-100 text-gray-800",
};

const TRANSPORT_TYPE_LABELS: Record<string, string> = {
  rental_car: "Rental Car",
  taxi: "Taxi",
  rideshare: "Rideshare",
  shuttle: "Shuttle",
  public_transit: "Public Transit",
};

function formatDate(date: Date | string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(date));
}

function formatCents(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

export default async function LodgingPage(props: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await props.params;
  const { caller, workspace } = await requireTripsWorkspace();

  try {
    const [trip, segments] = await Promise.all([
      caller.trips.get({ workspaceId: workspace.id, tripId }),
      caller.trips.listSegments({ workspaceId: workspace.id, tripId }),
    ]);

    // Fetch data for all segments in parallel
    const segmentData = await Promise.all(
      segments.map(async (segment) => {
        const [lodgingList, transits, transportGroups] = await Promise.all([
          caller.lodging.listForSegment({
            workspaceId: workspace.id,
            tripId,
            segmentId: segment.id,
          }),
          caller.lodging.listTransitsForSegment({
            workspaceId: workspace.id,
            tripId,
            segmentId: segment.id,
          }),
          caller.lodging.listTransportGroups({
            workspaceId: workspace.id,
            tripId,
            segmentId: segment.id,
          }),
        ]);

        return { segment, lodgingList, transits, transportGroups };
      }),
    );

    return (
      <main className="container mx-auto max-w-5xl px-4 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-muted-foreground text-sm uppercase tracking-[0.24em]">
              Lodging &amp; Travel
            </p>
            <h1 className="text-3xl font-black tracking-tight">{trip.name}</h1>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/trips/${tripId}`}>Dashboard</Link>
            </Button>
          </div>
        </div>

        {segmentData.map(
          ({ segment, lodgingList, transits, transportGroups }) => (
            <section key={segment.id} className="mb-10">
              <h2 className="text-muted-foreground mb-4 text-xs font-semibold uppercase tracking-[0.2em]">
                {segment.name}
              </h2>

              {/* ── Lodging Cards ────────────────────── */}
              <div className="mb-6">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Lodging</h3>
                  <Button variant="outline" size="sm" disabled>
                    Add lodging
                  </Button>
                </div>

                {lodgingList.length === 0 ? (
                  <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-sm">
                    No lodging added yet.
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {lodgingList.map((l) => (
                      <div
                        key={l.id}
                        className="bg-card rounded-xl border p-4 shadow-sm"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-semibold">{l.propertyName}</p>
                            {l.provider && (
                              <span className="bg-muted mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider">
                                {PROVIDER_LABELS[l.provider] ?? l.provider}
                              </span>
                            )}
                          </div>
                          {l.totalCostCents != null && (
                            <span className="font-mono text-sm font-medium">
                              {formatCents(l.totalCostCents, l.currency)}
                            </span>
                          )}
                        </div>
                        <div className="text-muted-foreground mt-2 space-y-0.5 text-xs">
                          <p>
                            {formatDate(l.checkInAt)} &ndash;{" "}
                            {formatDate(l.checkOutAt)}
                          </p>
                          {l.address && <p>{l.address}</p>}
                          {l.confirmationNumber && (
                            <p>
                              Conf:{" "}
                              <span className="font-mono">
                                {l.confirmationNumber}
                              </span>
                            </p>
                          )}
                          <p>
                            {l.guestCount} guest{l.guestCount !== 1 ? "s" : ""}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Arrivals Board ───────────────────── */}
              <div className="mb-6">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">
                    Arrivals &amp; Departures
                  </h3>
                  <Button variant="outline" size="sm" disabled>
                    Add transit
                  </Button>
                </div>

                {transits.length === 0 ? (
                  <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-sm">
                    No arrivals or departures added yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {transits.map((t) => (
                      <div
                        key={t.id}
                        className="bg-card flex items-center gap-4 rounded-lg border px-4 py-3"
                      >
                        <div className="text-muted-foreground w-16 shrink-0 text-center text-xs font-medium uppercase">
                          {t.direction ?? "transit"}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">
                            {t.carrier && <span>{t.carrier} </span>}
                            {t.transitNumber && (
                              <span className="font-mono">
                                {t.transitNumber}
                              </span>
                            )}
                            {!t.carrier && !t.transitNumber && (
                              <span className="text-muted-foreground">
                                {t.transitType ?? "Transit"}
                              </span>
                            )}
                          </p>
                          <p className="text-muted-foreground text-xs">
                            {t.departureStation && (
                              <span>{t.departureStation}</span>
                            )}
                            {t.departureStation && t.arrivalStation && " -> "}
                            {t.arrivalStation && (
                              <span>{t.arrivalStation}</span>
                            )}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-mono text-xs">
                            {formatDate(t.scheduledAt)}
                          </p>
                          <span
                            className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_COLORS[t.trackingStatus] ?? "bg-gray-100 text-gray-800"}`}
                          >
                            {t.trackingStatus.replace("_", " ")}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Ground Transport Groups ──────────── */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Ground Transport</h3>
                  <Button variant="outline" size="sm" disabled>
                    Add transport
                  </Button>
                </div>

                {transportGroups.length === 0 ? (
                  <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-sm">
                    No ground transport groups added yet.
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {transportGroups.map((g) => (
                      <div
                        key={g.id}
                        className="bg-card rounded-xl border p-4 shadow-sm"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-semibold">{g.label}</p>
                            {g.transportType && (
                              <span className="bg-muted mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider">
                                {TRANSPORT_TYPE_LABELS[g.transportType] ??
                                  g.transportType}
                              </span>
                            )}
                          </div>
                          {g.costCents != null && (
                            <span className="font-mono text-sm font-medium">
                              {formatCents(g.costCents, g.currency)}
                            </span>
                          )}
                        </div>
                        <div className="text-muted-foreground mt-2 space-y-0.5 text-xs">
                          {g.fromDescription && (
                            <p>From: {g.fromDescription}</p>
                          )}
                          {g.toDescription && <p>To: {g.toDescription}</p>}
                          {g.scheduledAt && <p>{formatDate(g.scheduledAt)}</p>}
                          <p>
                            {g.members.length} member
                            {g.members.length !== 1 ? "s" : ""}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          ),
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
