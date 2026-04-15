import { Button } from "@gmacko/ui/button";
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

export default async function TripsPage() {
  const { caller, workspace } = await requireTripsWorkspace();
  const trips = await caller.trips.list({
    workspaceId: workspace.id,
  });

  return (
    <main className="container mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm uppercase tracking-[0.24em]">
            Trips
          </p>
          <h1 className="text-4xl font-black tracking-tight">
            Trip command center
          </h1>
          <p className="text-muted-foreground max-w-2xl text-sm sm:text-base">
            Active workspace: {workspace.name}. Create a trip, invite people,
            and branch into planning or command-center mode from there.
          </p>
        </div>

        <Button asChild>
          <Link href="/trips/new">Create Trip</Link>
        </Button>
      </div>

      {trips.length === 0 ? (
        <section className="bg-card mt-10 rounded-3xl border p-8 shadow-sm">
          <h2 className="text-2xl font-semibold">No trips yet</h2>
          <p className="text-muted-foreground mt-3 max-w-xl text-sm sm:text-base">
            Start with the destination and dates. You can refine members,
            segments, and claim mode after the trip exists.
          </p>
          <div className="mt-6">
            <Button asChild variant="outline">
              <Link href="/trips/new">Set up the first trip</Link>
            </Button>
          </div>
        </section>
      ) : (
        <section className="mt-10 grid gap-4 md:grid-cols-2">
          {trips.map((trip) => (
            <Link
              key={trip.id}
              href={`/trips/${trip.id}`}
              className="bg-card hover:border-primary/50 block rounded-3xl border p-6 shadow-sm transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold">{trip.name}</h2>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {trip.destinationName ?? "Destination pending"}
                  </p>
                </div>
                <span className="bg-muted rounded-full px-3 py-1 text-xs font-medium capitalize">
                  {trip.status}
                </span>
              </div>

              <dl className="mt-6 space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Dates</dt>
                  <dd className="text-right">
                    {formatTripDates(trip.startDate, trip.endDate)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Time zone</dt>
                  <dd>{trip.tz}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Claim mode</dt>
                  <dd className="capitalize">{trip.claimMode}</dd>
                </div>
              </dl>
            </Link>
          ))}
        </section>
      )}
    </main>
  );
}
