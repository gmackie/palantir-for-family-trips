import { Button } from "@gmacko/ui/button";
import { TRPCError } from "@trpc/server";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireTripsWorkspace } from "../../../_lib/server";
import { CreateProposalForm } from "./_components/create-proposal-form";
import { ProposalCard } from "./_components/proposal-card";

const PROPOSAL_TYPE_TABS = [
  { value: undefined, label: "All" },
  { value: "flight" as const, label: "Flights" },
  { value: "lodging" as const, label: "Lodging" },
  { value: "car_rental" as const, label: "Car Rental" },
  { value: "activity" as const, label: "Activities" },
  { value: "other" as const, label: "Other" },
] as const;

export default async function ProposalsListPage(props: {
  params: Promise<{ tripId: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const { tripId } = await props.params;
  const searchParams = await props.searchParams;
  const { caller, workspace } = await requireTripsWorkspace();

  const typeFilter = searchParams.type as
    | "flight"
    | "lodging"
    | "car_rental"
    | "activity"
    | "other"
    | undefined;

  try {
    const [trip, proposalsList] = await Promise.all([
      caller.trips.get({ workspaceId: workspace.id, tripId }),
      caller.planning.listProposals({
        workspaceId: workspace.id,
        tripId,
        proposalType: typeFilter,
      }),
    ]);

    return (
      <main className="container mx-auto max-w-5xl px-4 py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <p className="text-muted-foreground text-sm uppercase tracking-[0.24em]">
              Proposals
            </p>
            <h1 className="text-4xl font-black tracking-tight">{trip.name}</h1>
            <p className="text-muted-foreground text-sm sm:text-base">
              {proposalsList.length} proposal
              {proposalsList.length !== 1 ? "s" : ""}
            </p>
          </div>

          <Button asChild variant="outline">
            <Link href={`/trips/${tripId}/plan`}>Back to planning</Link>
          </Button>
        </div>

        {/* Filter tabs */}
        <div className="mt-6 flex flex-wrap gap-2">
          {PROPOSAL_TYPE_TABS.map((tab) => {
            const isActive = typeFilter === tab.value;
            const href =
              tab.value === undefined
                ? `/trips/${tripId}/plan/proposals`
                : `/trips/${tripId}/plan/proposals?type=${tab.value}`;

            return (
              <Link
                key={tab.label}
                href={href}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>

        {/* Create proposal form */}
        <section className="bg-card mt-6 rounded-3xl border p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">Add a proposal</h2>
          <CreateProposalForm tripId={tripId} workspaceId={workspace.id} />
        </section>

        {/* Proposal list */}
        <section className="mt-8">
          {proposalsList.length === 0 ? (
            <div className="bg-card rounded-3xl border p-10 text-center shadow-sm">
              <p className="text-muted-foreground text-sm">
                No proposals yet. Add one above.
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              {proposalsList.map((proposal) => (
                <ProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  tripId={tripId}
                  workspaceId={workspace.id}
                />
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
