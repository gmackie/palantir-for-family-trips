import { TRPCError } from "@trpc/server";
import { notFound } from "next/navigation";

import { requireTripsWorkspace } from "../../_lib/server";
import { SettlementView } from "./_components/settlement-view";

export default async function SettlePage(props: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await props.params;
  const { caller, workspace, session } = await requireTripsWorkspace();

  try {
    const [trip, summary, history] = await Promise.all([
      caller.trips.get({ workspaceId: workspace.id, tripId }),
      caller.settlements.summary({ workspaceId: workspace.id, tripId }),
      caller.settlements.history({ workspaceId: workspace.id, tripId }),
    ]);

    return (
      <main className="container mx-auto max-w-5xl px-4 py-10">
        <SettlementView
          tripId={tripId}
          tripName={trip.name}
          workspaceId={workspace.id}
          currentUserId={session.user.id}
          initialSummary={summary}
          initialHistory={history}
        />
      </main>
    );
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") {
      notFound();
    }

    throw error;
  }
}
