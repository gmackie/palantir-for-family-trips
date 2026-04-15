import { Button } from "@gmacko/ui/button";
import { TRPCError } from "@trpc/server";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireTripsWorkspace } from "../_lib/server";

function formatTripDates(startDate: string | null, endDate: string | null) {
  if (!startDate || !endDate) {
    return "Dates not set";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).formatRange(new Date(startDate), new Date(endDate));
}

export default async function TripDashboardPage(props: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await props.params;
  const { caller, workspace } = await requireTripsWorkspace();

  try {
    const trip = await caller.trips.get({
      workspaceId: workspace.id,
      tripId,
    });

    return (
      <main className="container mx-auto max-w-5xl px-4 py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <p className="text-muted-foreground text-sm uppercase tracking-[0.24em]">
              Trip Overview
            </p>
            <h1 className="text-4xl font-black tracking-tight">{trip.name}</h1>
            <p className="text-muted-foreground text-sm sm:text-base">
              {trip.destinationName ?? "Destination pending"} in {trip.tz}
            </p>
          </div>

          <Button asChild variant="outline">
            <Link href="/trips">Back to trips</Link>
          </Button>
        </div>

        <section className="bg-card mt-8 grid gap-4 rounded-3xl border p-6 shadow-sm md:grid-cols-2">
          <div>
            <h2 className="text-lg font-semibold">Command surface</h2>
            <p className="text-muted-foreground mt-2 text-sm">
              Group mode is {trip.groupMode ? "enabled" : "disabled"} and claim
              mode defaults to {trip.claimMode}.
            </p>
          </div>

          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="capitalize">{trip.status}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Dates</dt>
              <dd className="text-right">
                {formatTripDates(trip.startDate, trip.endDate)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Workspace</dt>
              <dd>{workspace.name}</dd>
            </div>
          </dl>
        </section>

        <div className="mt-6">
          <Button asChild>
            <Link href={`/trips/${trip.id}/settings`}>Open settings</Link>
          </Button>
        </div>
      </main>
    );
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") {
      notFound();
    }

    throw error;
  }
}
