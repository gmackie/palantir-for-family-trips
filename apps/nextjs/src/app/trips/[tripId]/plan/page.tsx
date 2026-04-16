import { Button } from "@gmacko/ui/button";
import { TRPCError } from "@trpc/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { requireTripsWorkspace } from "../../_lib/server";

export default async function PlanningDashboardPage(props: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await props.params;
  const { caller, workspace, session } = await requireTripsWorkspace();

  try {
    const [trip, pollsList, proposalsList] = await Promise.all([
      caller.trips.get({ workspaceId: workspace.id, tripId }),
      caller.planning.listPolls({ workspaceId: workspace.id, tripId }),
      caller.planning.listProposals({ workspaceId: workspace.id, tripId }),
    ]);

    if (trip.status !== "planning") {
      redirect(`/trips/${tripId}`);
    }

    const isOrganizer = trip.createdByUserId === session.user.id;
    const openPolls = pollsList.filter((p) => p.status === "open");
    const recentProposals = proposalsList.slice(0, 5);

    return (
      <main className="container mx-auto max-w-5xl px-4 py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <p className="text-muted-foreground text-sm uppercase tracking-[0.24em]">
              Pre-Trip Planning
            </p>
            <h1 className="text-4xl font-black tracking-tight">{trip.name}</h1>
            <p className="text-muted-foreground text-sm sm:text-base">
              Collaboratively decide on dates, destinations, flights, and lodging
            </p>
          </div>

          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href={`/trips/${tripId}`}>Back to trip</Link>
            </Button>
            {isOrganizer && (
              <Button asChild>
                <Link href={`/trips/${tripId}/plan/lock-in`}>Lock it in</Link>
              </Button>
            )}
          </div>
        </div>

        {/* Active polls */}
        <section className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              Active Polls ({openPolls.length})
            </h2>
            <Button asChild variant="outline" size="sm">
              <Link href={`/trips/${tripId}/plan/polls`}>All polls</Link>
            </Button>
          </div>

          {openPolls.length === 0 ? (
            <div className="bg-card mt-4 rounded-2xl border p-6 text-center">
              <p className="text-muted-foreground text-sm">
                No active polls. Create one to start gathering votes.
              </p>
              <Button asChild className="mt-3" size="sm">
                <Link href={`/trips/${tripId}/plan/polls`}>Create a poll</Link>
              </Button>
            </div>
          ) : (
            <div className="mt-4 grid gap-3">
              {openPolls.map((poll) => (
                <Link
                  key={poll.id}
                  href={`/trips/${tripId}/plan/polls/${poll.id}`}
                  className="bg-card hover:bg-accent/50 flex items-center justify-between rounded-2xl border p-4 shadow-sm transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold">{poll.title}</h3>
                    <p className="text-muted-foreground text-xs">
                      {poll.options.length} option
                      {poll.options.length !== 1 ? "s" : ""} &middot;{" "}
                      {poll.pollType.replace("_", " ")}
                    </p>
                  </div>
                  <span className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ml-3 inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium">
                    open
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Recent proposals */}
        <section className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              Proposals ({proposalsList.length})
            </h2>
            <Button asChild variant="outline" size="sm">
              <Link href={`/trips/${tripId}/plan/proposals`}>
                All proposals
              </Link>
            </Button>
          </div>

          {recentProposals.length === 0 ? (
            <div className="bg-card mt-4 rounded-2xl border p-6 text-center">
              <p className="text-muted-foreground text-sm">
                No proposals yet. Suggest a flight, hotel, or activity.
              </p>
              <Button asChild className="mt-3" size="sm">
                <Link href={`/trips/${tripId}/plan/proposals`}>
                  Add a proposal
                </Link>
              </Button>
            </div>
          ) : (
            <div className="mt-4 grid gap-3">
              {recentProposals.map((proposal) => (
                <div
                  key={proposal.id}
                  className="bg-card flex items-center justify-between rounded-2xl border p-4 shadow-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-semibold">
                        {proposal.title}
                      </h3>
                      <span
                        className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          proposal.status === "selected"
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            : proposal.status === "rejected"
                              ? "bg-red-500/15 text-red-600 dark:text-red-400"
                              : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        {proposal.status}
                      </span>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {proposal.proposalType.replace("_", " ")}
                      {proposal.priceCents != null &&
                        ` - $${(proposal.priceCents / 100).toFixed(2)}`}
                    </p>
                  </div>
                  <div className="text-muted-foreground ml-3 flex gap-3 text-xs tabular-nums">
                    {proposal.reactionCounts.up != null && (
                      <span>{proposal.reactionCounts.up} up</span>
                    )}
                    {proposal.reactionCounts.down != null && (
                      <span>{proposal.reactionCounts.down} down</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    );
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") {
      notFound();
    }

    throw error;
  }
}
