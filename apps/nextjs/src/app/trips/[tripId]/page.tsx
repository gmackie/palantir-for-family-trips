import { Button } from "@gmacko/ui/button";
import { TRPCError } from "@trpc/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { requireTripsWorkspace } from "../_lib/server";

function formatTripDates(startDate: string | null, endDate: string | null) {
  if (!startDate || !endDate) return "Dates not set";
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

  let trip;
  try {
    trip = await caller.trips.get({
      workspaceId: workspace.id,
      tripId,
    });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  // Branch on trip status to show the right dashboard view
  if (trip.status === "planning") {
    redirect(`/trips/${tripId}/plan`);
  }

  if (trip.status === "active") {
    redirect(`/trips/${tripId}/dashboard`);
  }

  // Confirmed / Completed — nav grid
  const navLinks = [
    { label: "Dashboard", href: `/trips/${tripId}/dashboard`, desc: "Palantir-style command center" },
    { label: "Expenses", href: `/trips/${tripId}/expenses`, desc: "Track spending + split receipts" },
    { label: "Settle", href: `/trips/${tripId}/settle`, desc: "Who owes whom" },
    { label: "Map", href: `/trips/${tripId}/map`, desc: "Pins + transit routes" },
    { label: "Itinerary", href: `/trips/${tripId}/itinerary`, desc: "Timeline + gap detection" },
    { label: "Lodging", href: `/trips/${tripId}/lodging`, desc: "Accommodation + arrivals" },
    { label: "Plan", href: `/trips/${tripId}/plan`, desc: "Polls + proposals" },
    { label: "Settings", href: `/trips/${tripId}/settings`, desc: "Trip config + members" },
  ];

  const statusBadgeColor: Record<string, string> = {
    confirmed: "bg-blue-500/20 text-blue-400",
    active: "bg-green-500/20 text-green-400",
    completed: "bg-gray-500/20 text-gray-400",
  };

  return (
    <main className="container mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <p className="text-muted-foreground text-xs uppercase tracking-[0.24em]">
              Command Center
            </p>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium uppercase tracking-wider ${statusBadgeColor[trip.status] ?? "bg-gray-500/20 text-gray-400"}`}
            >
              {trip.status}
            </span>
          </div>
          <h1 className="text-4xl font-black tracking-tight">{trip.name}</h1>
          <p className="text-muted-foreground text-sm">
            {trip.destinationName ?? "Destination pending"}
            {trip.startDate && trip.endDate
              ? ` — ${formatTripDates(trip.startDate, trip.endDate)}`
              : ""}
          </p>
        </div>

        <Button asChild variant="outline" size="sm">
          <Link href="/trips">All trips</Link>
        </Button>
      </div>

      {trip.status === "completed" && (
        <div className="mt-6 rounded-2xl border border-green-500/30 bg-green-500/5 p-6 text-center">
          <p className="text-2xl font-bold">Trip complete!</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Review expenses and settle up below.
          </p>
        </div>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="bg-card group rounded-2xl border p-5 shadow-sm transition-colors hover:border-foreground/20"
          >
            <p className="text-lg font-semibold group-hover:underline">
              {link.label}
            </p>
            <p className="text-muted-foreground mt-1 text-sm">{link.desc}</p>
          </Link>
        ))}
      </div>

      <dl className="bg-card mt-6 grid gap-x-8 gap-y-3 rounded-2xl border p-5 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground text-xs uppercase tracking-wider">
            Status
          </dt>
          <dd className="mt-0.5 font-medium capitalize">{trip.status}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs uppercase tracking-wider">
            Group mode
          </dt>
          <dd className="mt-0.5 font-medium">
            {trip.groupMode ? "Enabled" : "Disabled"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs uppercase tracking-wider">
            Claim mode
          </dt>
          <dd className="mt-0.5 font-medium capitalize">{trip.claimMode}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs uppercase tracking-wider">
            Timezone
          </dt>
          <dd className="mt-0.5 font-medium">{trip.tz}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs uppercase tracking-wider">
            Workspace
          </dt>
          <dd className="mt-0.5 font-medium">{workspace.name}</dd>
        </div>
      </dl>
    </main>
  );
}
