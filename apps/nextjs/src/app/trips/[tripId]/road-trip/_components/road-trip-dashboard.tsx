"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FuelLogPanel } from "~/components/road-trip/fuel-log-panel";
import { PoiInfoCard } from "~/components/road-trip/poi-info-card";
import { RouteGradientMap } from "~/components/road-trip/route-gradient-map";
import { TripStatsBar } from "~/components/road-trip/trip-stats-bar";
import { TripTikStrip } from "~/components/road-trip/triptik-strip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Trip = {
  id: string;
  workspaceId: string;
  name: string;
  status:
    | "planning"
    | "confirmed"
    | "active"
    | "en_route"
    | "paused"
    | "completed";
  tripMode: "destination" | "roadtrip";
  groupMode: boolean;
  claimMode: "organizer" | "tap";
  destinationName: string | null;
  destinationLat: string | null;
  destinationLng: string | null;
  defaultZoom: number;
  startDate: string | null;
  endDate: string | null;
  tz: string;
  createdAt: Date;
  updatedAt: Date | null;
};

type Segment = {
  id: string;
  tripId: string;
  name: string;
  sortOrder: number;
  routePolyline?: string | null;
  distanceMiles?: string | null;
  durationMinutes?: number | null;
  originName?: string | null;
  destinationName?: string | null;
};

type FuelLogEntry = {
  id: string;
  stationName: string | null;
  gallons: string;
  pricePerGallon: string;
  totalCents: number;
  odometerMiles: string | null;
  isCostco: boolean;
  loggedAt: Date;
  actualMpg: number | null;
};

type FuelStats = {
  totalFuelCents: number;
  totalGallons: number;
  avgPricePerGallon: number;
  avgMpg: number | null;
  costPerMile: number | null;
  fillCount: number;
};

type SelectedPoi = {
  id: string;
  name: string;
  category: string;
  source: string;
  lat: number;
  lng: number;
  data?: Record<string, unknown>;
  distanceFromRoute?: number;
};

type VanProfile = {
  id: string;
  name: string;
  vehicleType: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  fuelType: string;
  mpgEstimate: string | null;
  tankGallons: string | null;
  heightInches: number | null;
  lengthFeet: number | null;
};

type CorridorPoi = {
  id: string;
  name: string;
  category: string;
  source: string;
  lat: string;
  lng: string;
  data: unknown;
};

type InspectorTab = "fuel" | "van" | "pois";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  planning: "bg-[#D29922]/20 text-[#D29922]",
  confirmed: "bg-[#58A6FF]/20 text-[#58A6FF]",
  active: "bg-[#3FB950]/20 text-[#3FB950]",
  en_route: "bg-[#D29922]/20 text-[#D29922]",
  paused: "bg-[#8B949E]/20 text-[#8B949E]",
  completed: "bg-[#8B949E]/20 text-[#8B949E]",
};

const POI_ICONS: Record<string, string> = {
  fuel: "⛽",
  water: "💧",
  campsite: "⛺",
  dump_station: "🚽",
  rest_area: "🅿️",
  scenic: "🏔️",
  shower: "🚿",
  grocery: "🛒",
  propane: "🔥",
  laundry: "👕",
};

const TAB_LABELS: Record<InspectorTab, string> = {
  fuel: "Fuel Log",
  van: "Van Profile",
  pois: "POIs",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeTotalMiles(segments: Segment[]): number {
  return segments.reduce(
    (sum, seg) => sum + (seg.distanceMiles ? Number(seg.distanceMiles) : 0),
    0,
  );
}

function computeTripDays(trip: Trip): {
  currentDay: number;
  totalDays: number;
  daysRemaining: number;
} {
  if (!trip.startDate || !trip.endDate) {
    return { currentDay: 0, totalDays: 0, daysRemaining: 0 };
  }

  const start = new Date(trip.startDate);
  const end = new Date(trip.endDate);
  const now = new Date();

  const totalDays = Math.max(
    1,
    Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
  );

  if (now < start) {
    return { currentDay: 0, totalDays, daysRemaining: totalDays };
  }

  const elapsed = Math.ceil(
    (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
  );
  const currentDay = Math.min(elapsed, totalDays);
  const daysRemaining = Math.max(0, totalDays - currentDay);

  return { currentDay, totalDays, daysRemaining };
}

/**
 * Build a combined encoded polyline by concatenating all segment polylines.
 * If Google Maps geometry lib is available it decodes/re-encodes; otherwise
 * falls back to the first non-null polyline.
 */
function getCombinedPolyline(segments: Segment[]): string | null {
  const polys = segments
    .filter((s): s is Segment & { routePolyline: string } => !!s.routePolyline)
    .map((s) => s.routePolyline);

  if (polys.length === 0) return null;
  if (polys.length === 1) return polys[0]!;

  // When multiple segments exist, try to combine them using the geometry lib.
  if (
    typeof window !== "undefined" &&
    window.google?.maps?.geometry?.encoding
  ) {
    const { decodePath, encodePath } = window.google.maps.geometry.encoding;
    const combined = polys.flatMap((p) => decodePath(p).map((ll) => ll));
    return encodePath(combined);
  }

  // Fallback: use first polyline
  return polys[0]!;
}

function buildTripTikSegments(segments: Segment[]) {
  return segments.map((seg, i) => ({
    id: seg.id,
    name: seg.name,
    distanceMiles: seg.distanceMiles
      ? Math.round(Number(seg.distanceMiles))
      : 0,
    durationMinutes: seg.durationMinutes ?? 0,
    dayNumber: i + 1,
    items: [
      // Origin waypoint
      {
        id: `${seg.id}-origin`,
        type: "origin" as const,
        name: seg.originName ?? "Start",
        mileMarker: 0,
      },
      // Destination waypoint
      {
        id: `${seg.id}-dest`,
        type: "destination" as const,
        name: seg.destinationName ?? seg.name,
        mileMarker: seg.distanceMiles
          ? Math.round(Number(seg.distanceMiles))
          : 0,
      },
    ],
  }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RoadTripDashboard(props: {
  trip: Trip;
  segments: Segment[];
  fuelLogs: FuelLogEntry[];
  fuelStats: FuelStats;
  workspaceId: string;
  currentUserId: string;
  googleMapsApiKey?: string;
  vanProfiles?: VanProfile[];
  corridorPois?: CorridorPoi[];
  deleteTripAction: () => Promise<{ error?: string }>;
  setStatusAction: (status: Trip["status"]) => Promise<{ error?: string }>;
}) {
  const {
    trip,
    segments,
    fuelLogs,
    fuelStats,
    workspaceId,
    googleMapsApiKey,
    vanProfiles = [],
    corridorPois = [],
  } = props;

  const router = useRouter();
  const [isDeleting, startDeleteTransition] = useTransition();
  const [isUpdatingStatus, startStatusTransition] = useTransition();
  const [selectedPoi, setSelectedPoi] = useState<SelectedPoi | null>(null);
  const [activeTab, setActiveTab] = useState<InspectorTab>("fuel");
  const [poiFilter, setPoiFilter] = useState<string | null>(null);

  function handleDelete() {
    if (!confirm("Delete this trip? This cannot be undone.")) return;
    startDeleteTransition(async () => {
      const result = await props.deleteTripAction();
      if (result.error) {
        alert(result.error);
      } else {
        router.push("/trips");
      }
    });
  }

  function handleStatusChange(newStatus: Trip["status"]) {
    startStatusTransition(async () => {
      const result = await props.setStatusAction(newStatus);
      if (result.error) {
        alert(result.error);
      } else {
        router.refresh();
      }
    });
  }

  const totalMiles = computeTotalMiles(segments);
  const { currentDay, totalDays, daysRemaining } = computeTripDays(trip);
  const encodedPolyline = getCombinedPolyline(segments);
  const triptikSegments = buildTripTikSegments(segments);

  const completedMiles =
    totalDays > 0 && currentDay > 0
      ? Math.round((currentDay / totalDays) * totalMiles)
      : 0;

  const filteredPois = corridorPois
    .filter((p) => !poiFilter || p.category === poiFilter)
    .map((p) => ({
      id: p.id,
      lat: Number(p.lat),
      lng: Number(p.lng),
      category: p.category,
      name: p.name,
    }));

  return (
    <div className="flex h-screen flex-col text-[#C9D1D9]">
      {/* ── Header bar ── */}
      <header className="flex shrink-0 items-center gap-4 border-b border-[#21262D] px-4 py-2">
        <Link
          href="/trips"
          className="text-[#484F58] transition-colors hover:text-[#8B949E]"
          title="All trips"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <span className="text-[9px] font-black uppercase tracking-[0.3em] text-[#8B949E]">
          Road Trip
        </span>
        <span className="text-sm font-semibold text-white">{trip.name}</span>

        <span
          className={`rounded-[2px] px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${STATUS_COLORS[trip.status] ?? "bg-[#8B949E]/20 text-[#8B949E]"}`}
        >
          {trip.status.replace("_", " ")}
        </span>

        {trip.status === "planning" && (
          <button
            type="button"
            onClick={() => handleStatusChange("en_route")}
            disabled={isUpdatingStatus}
            className="rounded-[2px] bg-[#3FB950] px-3 py-1 text-[10px] font-black uppercase tracking-wider text-[#0A0C10] transition-colors hover:bg-[#56D364] disabled:opacity-50"
          >
            {isUpdatingStatus ? "..." : "Start Trip"}
          </button>
        )}
        {trip.status === "en_route" && (
          <button
            type="button"
            onClick={() => handleStatusChange("paused")}
            disabled={isUpdatingStatus}
            className="rounded-[2px] bg-[#D29922] px-3 py-1 text-[10px] font-black uppercase tracking-wider text-[#0A0C10] transition-colors hover:bg-[#E3B341] disabled:opacity-50"
          >
            {isUpdatingStatus ? "..." : "Pause"}
          </button>
        )}
        {trip.status === "paused" && (
          <button
            type="button"
            onClick={() => handleStatusChange("en_route")}
            disabled={isUpdatingStatus}
            className="rounded-[2px] bg-[#3FB950] px-3 py-1 text-[10px] font-black uppercase tracking-wider text-[#0A0C10] transition-colors hover:bg-[#56D364] disabled:opacity-50"
          >
            {isUpdatingStatus ? "..." : "Resume"}
          </button>
        )}
        {(trip.status === "en_route" || trip.status === "paused") && (
          <button
            type="button"
            onClick={() => handleStatusChange("completed")}
            disabled={isUpdatingStatus}
            className="rounded-[2px] border border-[#8B949E]/30 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-[#8B949E] transition-colors hover:bg-[#8B949E]/10 disabled:opacity-50"
          >
            {isUpdatingStatus ? "..." : "End Trip"}
          </button>
        )}

        <div className="ml-auto flex items-center gap-3">
          {trip.destinationName && (
            <span className="text-xs text-[#8B949E]">
              {trip.destinationName}
            </span>
          )}
          {totalMiles > 0 && (
            <span className="font-mono text-xs text-[#484F58]">
              {totalMiles.toLocaleString()} mi
            </span>
          )}
          {trip.startDate && trip.endDate && (
            <span className="font-mono text-xs text-[#484F58]">
              {trip.startDate} — {trip.endDate}
            </span>
          )}
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className="rounded-[2px] border border-[#F85149]/30 px-2 py-1 text-[10px] font-semibold text-[#F85149] transition-colors hover:bg-[#F85149]/10 disabled:opacity-50"
            title="Delete trip"
          >
            {isDeleting ? "..." : "Delete"}
          </button>
        </div>
      </header>

      {/* ── Main 3-column body ── */}
      <div className="flex min-h-0 flex-1">
        {/* Left panel: TripTik strip */}
        <aside className="w-[320px] shrink-0 overflow-hidden border-r border-[#21262D] bg-[#0D1117]">
          {triptikSegments.length > 0 ? (
            <TripTikStrip
              segments={triptikSegments}
              totalMiles={Math.round(totalMiles)}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-6">
              <p className="text-xs text-[#484F58]">No segments planned yet.</p>
              <Link
                href={`/trips/${trip.id}`}
                className="mt-2 text-xs text-[#58A6FF] hover:underline"
              >
                Add segments
              </Link>
            </div>
          )}
        </aside>

        {/* Center: Route gradient map */}
        <main className="relative min-w-0 flex-1">
          {encodedPolyline ? (
            <>
              <RouteGradientMap
                encodedPolyline={encodedPolyline}
                pois={filteredPois}
                onPoiClick={(poiId) => {
                  const poi = corridorPois.find((p) => p.id === poiId);
                  if (poi) {
                    setSelectedPoi({
                      id: poi.id,
                      name: poi.name,
                      category: poi.category,
                      source: poi.source,
                      lat: Number(poi.lat),
                      lng: Number(poi.lng),
                      data: (poi.data as Record<string, unknown>) ?? undefined,
                    });
                    setActiveTab("pois");
                  }
                }}
              />

              {/* POI info card overlay */}
              {selectedPoi && (
                <div className="absolute right-4 top-4 z-10">
                  <PoiInfoCard
                    poi={selectedPoi}
                    distanceFromRoute={selectedPoi.distanceFromRoute}
                    onClose={() => setSelectedPoi(null)}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center bg-[#0D1117]">
              <div className="rounded-[4px] border border-[#21262D] bg-[#161B22] px-8 py-6 text-center">
                <p className="text-sm font-semibold text-[#C9D1D9]">
                  No route planned
                </p>
                <p className="mt-1 text-xs text-[#8B949E]">
                  Add a route polyline to your segments to see the gradient map.
                </p>
                <Link
                  href={`/trips/${trip.id}`}
                  className="mt-3 inline-block text-xs text-[#58A6FF] hover:underline"
                >
                  Trip settings
                </Link>
              </div>
            </div>
          )}
        </main>

        {/* Right panel: Inspector */}
        <aside className="w-[360px] shrink-0 overflow-hidden border-l border-[#21262D] bg-[#0D1117]">
          {/* Tab bar */}
          <div className="flex border-b border-[#21262D]">
            {(["fuel", "van", "pois"] as InspectorTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.15em] transition-colors ${
                  tab === activeTab
                    ? "border-b-2 border-[#58A6FF] text-[#58A6FF]"
                    : "text-[#8B949E] hover:text-[#C9D1D9]"
                }`}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="h-[calc(100%-41px)] overflow-y-auto p-4">
            {activeTab === "fuel" && (
              <FuelLogPanel logs={fuelLogs} stats={fuelStats} />
            )}

            {activeTab === "van" && (
              <div className="space-y-3">
                <h3 className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
                  Van Profile
                </h3>
                {vanProfiles.length > 0 ? (
                  vanProfiles.map((vp) => (
                    <div
                      key={vp.id}
                      className="rounded-[2px] border border-[#21262D] bg-[#0D1117] p-3"
                    >
                      <p className="text-sm font-semibold text-[#C9D1D9]">
                        {vp.name}
                      </p>
                      {(vp.year || vp.make || vp.model) && (
                        <p className="text-xs text-[#8B949E]">
                          {[vp.year, vp.make, vp.model]
                            .filter(Boolean)
                            .join(" ")}
                        </p>
                      )}
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {vp.mpgEstimate && (
                          <div>
                            <p className="text-[9px] uppercase text-[#484F58]">
                              Est. MPG
                            </p>
                            <p className="font-mono text-sm text-[#C9D1D9]">
                              {Number(vp.mpgEstimate).toFixed(1)}
                            </p>
                          </div>
                        )}
                        {vp.tankGallons && (
                          <div>
                            <p className="text-[9px] uppercase text-[#484F58]">
                              Tank
                            </p>
                            <p className="font-mono text-sm text-[#C9D1D9]">
                              {Number(vp.tankGallons).toFixed(1)} gal
                            </p>
                          </div>
                        )}
                        {vp.mpgEstimate && vp.tankGallons && (
                          <div>
                            <p className="text-[9px] uppercase text-[#484F58]">
                              Range
                            </p>
                            <p className="font-mono text-sm text-[#3FB950]">
                              {Math.round(
                                Number(vp.mpgEstimate) * Number(vp.tankGallons),
                              )}{" "}
                              mi
                            </p>
                          </div>
                        )}
                        <div>
                          <p className="text-[9px] uppercase text-[#484F58]">
                            Fuel
                          </p>
                          <p className="font-mono text-sm text-[#C9D1D9]">
                            {vp.fuelType}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-[#484F58]">
                    No van profile yet. Create one in workspace settings.
                  </p>
                )}
              </div>
            )}

            {activeTab === "pois" && (
              <div className="space-y-3">
                <h3 className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
                  Corridor POIs ({corridorPois.length})
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    null,
                    "fuel",
                    "campsite",
                    "water",
                    "grocery",
                    "rest_area",
                    "dump_station",
                    "scenic",
                    "shower",
                  ].map((cat) => (
                    <button
                      key={cat ?? "all"}
                      onClick={() => setPoiFilter(cat)}
                      className={`rounded-[2px] px-2 py-1 text-[10px] font-semibold transition-colors ${
                        poiFilter === cat
                          ? "bg-[#58A6FF] text-[#0A0C10]"
                          : "bg-[#21262D] text-[#8B949E] hover:text-[#C9D1D9]"
                      }`}
                    >
                      {cat ?? "All"}
                    </button>
                  ))}
                </div>
                <div
                  className="space-y-1 overflow-y-auto"
                  style={{ maxHeight: "calc(100vh - 200px)" }}
                >
                  {corridorPois
                    .filter((p) => !poiFilter || p.category === poiFilter)
                    .slice(0, 50)
                    .map((poi) => (
                      <button
                        key={poi.id}
                        onClick={() =>
                          setSelectedPoi({
                            id: poi.id,
                            name: poi.name,
                            category: poi.category,
                            source: poi.source,
                            lat: Number(poi.lat),
                            lng: Number(poi.lng),
                            data:
                              (poi.data as Record<string, unknown>) ??
                              undefined,
                          })
                        }
                        className="flex w-full items-center gap-2 rounded-[2px] border border-[#21262D] bg-[#0D1117] px-3 py-2 text-left transition-colors hover:border-[#484F58]"
                      >
                        <span className="text-sm">
                          {POI_ICONS[poi.category] ?? "📍"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-[#C9D1D9]">
                            {poi.name}
                          </p>
                          <p className="text-[10px] text-[#484F58]">
                            {poi.category}
                          </p>
                        </div>
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* ── Bottom stats bar ── */}
      <TripStatsBar
        totalMiles={Math.round(totalMiles)}
        completedMiles={completedMiles}
        totalFuelCents={fuelStats.totalFuelCents}
        avgMpg={fuelStats.avgMpg}
        costPerMile={fuelStats.costPerMile}
        daysRemaining={daysRemaining}
        currentDay={currentDay}
        totalDays={totalDays}
      />
    </div>
  );
}
