import { TRPCError } from "@trpc/server";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireTripsWorkspace } from "../../_lib/server";
import { AnchorsCard } from "./_components/anchors-card";
import { JourneyEditor } from "./_components/journey-editor";
import { PoiUpload } from "./_components/poi-upload";
import { TrackRecorder } from "./_components/track-recorder";
import { VanStateCard } from "./_components/van-state-card";

export default async function JourneyPage(props: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await props.params;
  const { caller, workspace } = await requireTripsWorkspace();

  let trip: Awaited<ReturnType<typeof caller.trips.get>>;
  try {
    trip = await caller.trips.get({ workspaceId: workspace.id, tripId });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[#C9D1D9]">Journey Log</h1>
          <p className="text-sm text-[#8B949E]">{trip.name}</p>
        </div>
        <Link
          href={`/trips/${tripId}/road-trip`}
          className="text-sm text-[#58A6FF] hover:underline"
        >
          ← Road trip
        </Link>
      </div>

      <AnchorsCard workspaceId={workspace.id} tripId={tripId} />

      <VanStateCard workspaceId={workspace.id} tripId={tripId} />

      <TrackRecorder workspaceId={workspace.id} tripId={tripId} />

      <PoiUpload workspaceId={workspace.id} tripId={tripId} />

      <JourneyEditor workspaceId={workspace.id} tripId={tripId} />
    </div>
  );
}
