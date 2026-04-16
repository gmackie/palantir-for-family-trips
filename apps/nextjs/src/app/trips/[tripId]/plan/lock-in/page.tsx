"use client";

import { Button } from "@gmacko/ui/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { useTRPC } from "~/trpc/react";

export default function LockInPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const router = useRouter();
  const trpc = useTRPC();
  const [error, setError] = useState<string | null>(null);

  const workspaceQuery = useQuery(
    trpc.settings.getWorkspaceContext.queryOptions(),
  );
  const workspaceId = workspaceQuery.data?.workspace?.id;

  const tripQuery = useQuery(
    trpc.trips.get.queryOptions(
      { workspaceId: workspaceId!, tripId },
      { enabled: !!workspaceId },
    ),
  );

  const pollsQuery = useQuery(
    trpc.planning.listPolls.queryOptions(
      { workspaceId: workspaceId!, tripId },
      { enabled: !!workspaceId },
    ),
  );

  const proposalsQuery = useQuery(
    trpc.planning.listProposals.queryOptions(
      { workspaceId: workspaceId!, tripId },
      { enabled: !!workspaceId },
    ),
  );

  const confirmTrip = useMutation(
    trpc.planning.confirmTrip.mutationOptions(),
  );

  const isLoading =
    workspaceQuery.isLoading ||
    tripQuery.isLoading ||
    pollsQuery.isLoading ||
    proposalsQuery.isLoading;

  if (isLoading) {
    return (
      <main className="container mx-auto max-w-3xl px-4 py-10">
        <p className="text-muted-foreground text-sm">Loading...</p>
      </main>
    );
  }

  const trip = tripQuery.data;
  const polls = pollsQuery.data ?? [];
  const proposalsList = proposalsQuery.data ?? [];

  if (!trip || !workspaceId) {
    return (
      <main className="container mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-red-600">Trip not found.</p>
      </main>
    );
  }

  if (trip.status !== "planning") {
    return (
      <main className="container mx-auto max-w-3xl px-4 py-10">
        <p className="text-muted-foreground text-sm">
          This trip has already been confirmed.
        </p>
        <Button asChild className="mt-4" variant="outline">
          <Link href={`/trips/${tripId}`}>Back to trip</Link>
        </Button>
      </main>
    );
  }

  const selectedProposals = proposalsList.filter(
    (p) => p.status === "selected" || p.status === "booked",
  );
  const closedPolls = polls.filter((p) => p.status === "closed");
  const openPolls = polls.filter((p) => p.status === "open");

  // Find winning options in closed polls (most votes)
  const pollWinners = closedPolls.map((poll) => {
    const winner = [...poll.options].sort(
      (a, b) => b.voteCount - a.voteCount,
    )[0];
    return { poll, winner };
  });

  async function handleConfirm() {
    if (!workspaceId) return;
    setError(null);

    try {
      await confirmTrip.mutateAsync({ workspaceId, tripId });
      router.push(`/trips/${tripId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm trip");
    }
  }

  return (
    <main className="container mx-auto max-w-3xl px-4 py-10">
      <div className="space-y-2">
        <p className="text-muted-foreground text-sm uppercase tracking-[0.24em]">
          Lock It In
        </p>
        <h1 className="text-4xl font-black tracking-tight">{trip.name}</h1>
        <p className="text-muted-foreground text-sm sm:text-base">
          Review the planning results and confirm the trip
        </p>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Trip details */}
      <section className="bg-card mt-8 rounded-3xl border p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Trip Details</h2>
        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Destination</dt>
            <dd>{trip.destinationName ?? "Not set"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Dates</dt>
            <dd>
              {trip.startDate && trip.endDate
                ? `${trip.startDate} to ${trip.endDate}`
                : "Not set"}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Timezone</dt>
            <dd>{trip.tz}</dd>
          </div>
        </dl>
      </section>

      {/* Poll results */}
      {pollWinners.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">Poll Results</h2>
          <div className="mt-3 grid gap-3">
            {pollWinners.map(({ poll, winner }) => (
              <div
                key={poll.id}
                className="bg-card rounded-2xl border p-4 shadow-sm"
              >
                <h3 className="text-sm font-semibold">{poll.title}</h3>
                {winner ? (
                  <p className="text-muted-foreground mt-1 text-xs">
                    Winner:{" "}
                    <span className="text-foreground font-medium">
                      {winner.label}
                    </span>{" "}
                    ({winner.voteCount} vote{winner.voteCount !== 1 ? "s" : ""})
                  </p>
                ) : (
                  <p className="text-muted-foreground mt-1 text-xs">
                    No votes recorded
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Open polls warning */}
      {openPolls.length > 0 && (
        <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            {openPolls.length} poll{openPolls.length !== 1 ? "s are" : " is"}{" "}
            still open. Confirming the trip will close all open polls.
          </p>
        </div>
      )}

      {/* Selected proposals */}
      {selectedProposals.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">Selected Proposals</h2>
          <div className="mt-3 grid gap-3">
            {selectedProposals.map((proposal) => (
              <div
                key={proposal.id}
                className="bg-card rounded-2xl border p-4 shadow-sm"
              >
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{proposal.title}</h3>
                  <span className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 rounded-full px-2 py-0.5 text-xs font-medium">
                    {proposal.status}
                  </span>
                </div>
                <p className="text-muted-foreground mt-1 text-xs">
                  {proposal.proposalType.replace("_", " ")}
                  {proposal.priceCents != null &&
                    ` - $${(proposal.priceCents / 100).toFixed(2)}`}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Confirm button */}
      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button asChild variant="outline">
          <Link href={`/trips/${tripId}/plan`}>Back to planning</Link>
        </Button>
        <Button
          onClick={handleConfirm}
          disabled={confirmTrip.isPending}
        >
          {confirmTrip.isPending ? "Confirming..." : "Confirm trip"}
        </Button>
      </div>
    </main>
  );
}
