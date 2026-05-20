import { appRouter, createTRPCContext } from "@gmacko/api";
import { TRPCError } from "@trpc/server";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { auth, getSession } from "~/auth/server";
import { requireTripsWorkspace } from "../../_lib/server";
import { RoadTripDashboard } from "./_components/road-trip-dashboard";
import { RoutePlannerForm } from "./_components/route-planner-form";

async function geocode(
  address: string,
  apiKey: string,
): Promise<{ lat: number; lng: number } | null> {
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    results?: Array<{ geometry: { location: { lat: number; lng: number } } }>;
  };
  const loc = data.results?.[0]?.geometry.location;
  return loc ?? null;
}

export default async function RoadTripPage(props: {
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

  const [segments, fuelLogs, fuelStats, vanProfiles] = await Promise.all([
    caller.trips
      .listSegments({ workspaceId: workspace.id, tripId })
      .catch(() => []),
    caller.fuelLogs.list({ workspaceId: workspace.id, tripId }).catch(() => []),
    caller.fuelLogs.stats({ workspaceId: workspace.id, tripId }).catch(() => ({
      totalFuelCents: 0,
      totalGallons: 0,
      avgPricePerGallon: 0,
      avgMpg: null as number | null,
      costPerMile: null as number | null,
      fillCount: 0,
    })),
    caller.vanProfiles.list({ workspaceId: workspace.id }).catch(() => []),
  ]);

  const hasRoute = segments.some(
    (s) => s.routePolyline && s.routePolyline.length > 0,
  );

  let corridorPois: Awaited<ReturnType<typeof caller.corridor.searchImported>> =
    [];

  if (hasRoute) {
    const midSegment = segments[Math.floor(segments.length / 2)];
    if (midSegment?.destinationLat && midSegment?.destinationLng) {
      corridorPois = await caller.corridor
        .searchImported({
          workspaceId: workspace.id,
          tripId,
          centerLat: Number(midSegment.destinationLat),
          centerLng: Number(midSegment.destinationLng),
          radiusMiles: 200,
          limit: 200,
        })
        .catch(() => []);
    }
  }

  async function planRouteAction(
    formData: FormData,
  ): Promise<{ error?: string; segmentCount?: number }> {
    "use server";

    const session = await getSession();
    if (!session?.user) return { error: "Not authenticated" };

    const requestHeaders = new Headers(await headers());
    const serverCaller = appRouter.createCaller(
      await createTRPCContext({
        headers: requestHeaders,
        authApi: auth.api,
      }),
    );

    const originName = formData.get("originName") as string;
    const destName = formData.get("destName") as string;
    const startDate = formData.get("startDate") as string;

    if (!originName || !destName || !startDate) {
      return { error: "All fields are required" };
    }

    const apiKey =
      process.env.GOOGLE_ROUTES_API_KEY ??
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) return { error: "Google Maps API key not configured" };

    const [originGeo, destGeo] = await Promise.all([
      geocode(originName, apiKey),
      geocode(destName, apiKey),
    ]);

    if (!originGeo) return { error: `Could not geocode "${originName}"` };
    if (!destGeo) return { error: `Could not geocode "${destName}"` };

    try {
      const result = await serverCaller.routePlanner.planRoute({
        workspaceId: workspace.id,
        tripId,
        origin: { name: originName, ...originGeo },
        destination: { name: destName, ...destGeo },
        startDate,
        autoSplit: true,
      });

      return { segmentCount: result.segmentCount };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Route planning failed";
      return { error: message };
    }
  }

  if (!hasRoute) {
    return (
      <div className="flex h-screen flex-col bg-[#0A0C10]">
        <RoutePlannerForm
          tripId={trip.id}
          workspaceId={workspace.id}
          planRouteAction={planRouteAction}
        />
      </div>
    );
  }

  return (
    <RoadTripDashboard
      trip={trip}
      segments={segments}
      fuelLogs={fuelLogs}
      fuelStats={fuelStats}
      workspaceId={workspace.id}
      currentUserId={session.user.id}
      googleMapsApiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ""}
      vanProfiles={vanProfiles}
      corridorPois={corridorPois}
    />
  );
}
