import { TRPCError } from "@trpc/server";
import { notFound } from "next/navigation";

import { requireTripsWorkspace } from "../../_lib/server";
import { ChatPanel } from "./_components/chat-panel";

export default async function TripChatPage(props: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await props.params;
  const { caller, session, workspace } = await requireTripsWorkspace();

  try {
    // Resolves access (404s non-members, same as the other trip subroutes) and
    // confirms the trip exists before mounting the realtime panel.
    await caller.trips.get({ workspaceId: workspace.id, tripId });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") {
      notFound();
    }
    throw error;
  }

  return (
    <main className="mx-auto flex h-[calc(100vh-2rem)] max-w-3xl flex-col px-4 py-4">
      <ChatPanel
        workspaceId={workspace.id}
        tripId={tripId}
        currentUserId={session.user.id}
      />
    </main>
  );
}
