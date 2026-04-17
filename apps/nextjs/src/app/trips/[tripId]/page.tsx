import { TRPCError } from "@trpc/server";
import { notFound } from "next/navigation";

import { requireTripsWorkspace } from "../_lib/server";
import { TripDashboard } from "./_components/trip-dashboard";

export default async function TripDashboardPage(props: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await props.params;
  const { caller, workspace, session } = await requireTripsWorkspace();

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

  // Load segments in parallel
  const segments = await caller.trips
    .listSegments({ workspaceId: workspace.id, tripId })
    .catch(() => [] as Array<{ id: string; tripId: string; name: string; sortOrder: number }>);

  return (
    <TripDashboard
      trip={trip}
      segments={segments}
      workspaceId={workspace.id}
      currentUserId={session.user.id}
      googleMapsApiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ""}
    />
  );
}
