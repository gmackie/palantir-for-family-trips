import { Button } from "@gmacko/ui/button";
import { TRPCError } from "@trpc/server";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireTripsWorkspace } from "../../../_lib/server";
import { CreatePollForm } from "./_components/create-poll-form";

export default async function PollsListPage(props: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await props.params;
  const { caller, workspace } = await requireTripsWorkspace();

  try {
    const [trip, pollsList] = await Promise.all([
      caller.trips.get({ workspaceId: workspace.id, tripId }),
      caller.planning.listPolls({ workspaceId: workspace.id, tripId }),
    ]);

    return (
      <main className="container mx-auto max-w-5xl px-4 py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <p className="text-muted-foreground text-sm uppercase tracking-[0.24em]">
              Polls
            </p>
            <h1 className="text-4xl font-black tracking-tight">{trip.name}</h1>
            <p className="text-muted-foreground text-sm sm:text-base">
              {pollsList.length} poll{pollsList.length !== 1 ? "s" : ""}
            </p>
          </div>

          <Button asChild variant="outline">
            <Link href={`/trips/${tripId}/plan`}>Back to planning</Link>
          </Button>
        </div>

        {/* Create poll form */}
        <section className="bg-card mt-8 rounded-3xl border p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">Create a new poll</h2>
          <CreatePollForm tripId={tripId} workspaceId={workspace.id} />
        </section>

        {/* Poll list */}
        <section className="mt-8">
          {pollsList.length === 0 ? (
            <div className="bg-card rounded-3xl border p-10 text-center shadow-sm">
              <p className="text-muted-foreground text-sm">
                No polls yet. Create one above to start.
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              {pollsList.map((poll) => (
                <Link
                  key={poll.id}
                  href={`/trips/${tripId}/plan/polls/${poll.id}`}
                  className="bg-card hover:bg-accent/50 rounded-2xl border p-5 shadow-sm transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-base font-semibold">
                          {poll.title}
                        </h3>
                        <span
                          className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            poll.status === "open"
                              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                              : "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400"
                          }`}
                        >
                          {poll.status}
                        </span>
                      </div>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {poll.pollType.replace("_", " ")} &middot;{" "}
                        {poll.options.length} option
                        {poll.options.length !== 1 ? "s" : ""}
                        {poll.options.reduce((sum, o) => sum + o.voteCount, 0) >
                          0 &&
                          ` · ${poll.options.reduce((sum, o) => sum + o.voteCount, 0)} vote${poll.options.reduce((sum, o) => sum + o.voteCount, 0) !== 1 ? "s" : ""}`}
                      </p>
                    </div>
                  </div>
                </Link>
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
