import Link from "next/link";

import { requireTripsWorkspace } from "./_lib/server";

function formatTripDates(startDate: string | null, endDate: string | null) {
  if (!startDate || !endDate) {
    return "Dates not set";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).formatRange(new Date(startDate), new Date(endDate));
}

function statusColor(status: string) {
  switch (status) {
    case "planning":
      return "border-[#D29922]/40 bg-[#D29922]/10 text-[#D29922]";
    case "confirmed":
      return "border-[#58A6FF]/40 bg-[#58A6FF]/10 text-[#58A6FF]";
    case "active":
      return "border-[#3FB950]/40 bg-[#3FB950]/10 text-[#3FB950]";
    case "completed":
      return "border-[#484F58]/40 bg-[#484F58]/10 text-[#484F58]";
    default:
      return "border-[#484F58]/40 bg-[#484F58]/10 text-[#484F58]";
  }
}

function mapThumbnailUrl(lat: string, lng: string) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=11&size=600x300&scale=2&maptype=roadmap&style=element:geometry%7Ccolor:0x161B22&style=element:labels.text.fill%7Ccolor:0x8B949E&style=element:labels.text.stroke%7Ccolor:0x0A0C10&style=feature:road%7Celement:geometry%7Ccolor:0x21262D&style=feature:water%7Celement:geometry%7Ccolor:0x0A0C10&key=${apiKey}`;
}

export default async function TripsPage() {
  const { caller, workspace } = await requireTripsWorkspace();
  const trips = await caller.trips.list({
    workspaceId: workspace.id,
  });

  return (
    <main className="min-h-screen bg-[#0A0C10] px-4 py-10 sm:px-8">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
              Command Center
            </p>
            <h1 className="text-4xl font-black tracking-tight text-[#C9D1D9]">
              Your Trips
            </h1>
          </div>
          <Link
            href="/trips/new"
            className="inline-flex h-9 items-center rounded-[2px] border border-[#58A6FF] bg-[#58A6FF]/10 px-5 text-sm font-semibold text-[#58A6FF] transition-colors hover:bg-[#58A6FF]/20"
          >
            Create Trip
          </Link>
        </div>

        {/* Trip grid or empty state */}
        {trips.length === 0 ? (
          <section className="mt-10 rounded-[4px] border border-[#21262D] bg-[#161B22] p-8">
            <h2 className="text-xl font-bold text-[#C9D1D9]">No trips yet</h2>
            <p className="mt-2 max-w-xl text-sm text-[#8B949E]">
              Start with the destination and dates. You can refine members,
              segments, and claim mode after the trip exists.
            </p>
            <div className="mt-6">
              <Link
                href="/trips/new"
                className="inline-flex h-9 items-center rounded-[2px] border border-[#58A6FF] bg-[#58A6FF]/10 px-5 text-sm font-semibold text-[#58A6FF] transition-colors hover:bg-[#58A6FF]/20"
              >
                Create your first trip
              </Link>
            </div>
          </section>
        ) : (
          <section className="mt-10 grid gap-4 md:grid-cols-2">
            {trips.map((trip) => (
              <Link
                key={trip.id}
                href={`/trips/${trip.id}`}
                className="group block overflow-hidden rounded-[4px] border border-[#21262D] bg-[#161B22] transition-colors hover:border-[#484F58]"
              >
                {/* Map thumbnail */}
                {trip.destinationLat && trip.destinationLng ? (
                  (() => {
                    const url = mapThumbnailUrl(
                      trip.destinationLat,
                      trip.destinationLng,
                    );
                    return url ? (
                      <img
                        src={url}
                        alt={`Map of ${trip.destinationName ?? "destination"}`}
                        className="h-[120px] w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-[120px] w-full items-center justify-center bg-[#0D1117] text-sm text-[#484F58]">
                        {trip.destinationName ?? "Unknown destination"}
                      </div>
                    );
                  })()
                ) : (
                  <div className="flex h-[120px] w-full items-center justify-center bg-[#0D1117] text-sm text-[#484F58]">
                    {trip.destinationName ?? "Destination pending"}
                  </div>
                )}

                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-bold text-[#C9D1D9]">
                        {trip.name}
                      </h2>
                      <p className="mt-0.5 text-xs text-[#8B949E]">
                        {trip.destinationName ?? "Destination pending"}
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-[2px] border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${statusColor(trip.status)}`}
                    >
                      {trip.status}
                    </span>
                  </div>

                  <div className="mt-4 flex items-center gap-4 text-xs text-[#8B949E]">
                    <span className="font-[family-name:var(--font-geist-mono)] tabular-nums">
                      {formatTripDates(trip.startDate, trip.endDate)}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
