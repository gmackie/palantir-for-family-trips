"use client";

import { importLibrary } from "@googlemaps/js-api-loader";
import { useCallback, useEffect, useRef, useState } from "react";

type TravelMode = "TRANSIT" | "WALKING" | "DRIVING";

interface DirectionStep {
  instruction: string;
  distance: string;
  duration: string;
  travelMode: string;
  transitLine?: string;
  transitColor?: string;
}

export interface DirectionsPanelProps {
  map: google.maps.Map | null;
  fromPin: { lat: number; lng: number; title: string } | null;
  toPin: { lat: number; lng: number; title: string } | null;
}

const MODE_LABELS: Record<TravelMode, string> = {
  TRANSIT: "Transit",
  WALKING: "Walking",
  DRIVING: "Driving",
};

export function DirectionsPanel({ map, fromPin, toPin }: DirectionsPanelProps) {
  const [mode, setMode] = useState<TravelMode>("TRANSIT");
  const [steps, setSteps] = useState<DirectionStep[]>([]);
  const [totalDuration, setTotalDuration] = useState("");
  const [totalDistance, setTotalDistance] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const serviceRef = useRef<google.maps.DirectionsService | null>(null);

  // Clean up renderer when unmounting or when map changes
  useEffect(() => {
    return () => {
      if (rendererRef.current) {
        rendererRef.current.setMap(null);
        rendererRef.current = null;
      }
    };
  }, [map]);

  const fetchDirections = useCallback(
    async (requestedMode: TravelMode) => {
      if (!map || !fromPin || !toPin) return;

      setLoading(true);
      setError(null);
      setSteps([]);

      try {
        const { DirectionsService, DirectionsRenderer } =
          (await importLibrary("routes")) as google.maps.RoutesLibrary;

        if (!serviceRef.current) {
          serviceRef.current = new DirectionsService();
        }

        // Clear old renderer
        if (rendererRef.current) {
          rendererRef.current.setMap(null);
        }

        const gmTravelMode: google.maps.TravelMode =
          requestedMode === "TRANSIT"
            ? google.maps.TravelMode.TRANSIT
            : requestedMode === "WALKING"
              ? google.maps.TravelMode.WALKING
              : google.maps.TravelMode.DRIVING;

        const result = await serviceRef.current.route({
          origin: { lat: fromPin.lat, lng: fromPin.lng },
          destination: { lat: toPin.lat, lng: toPin.lng },
          travelMode: gmTravelMode,
        });

        if (result.routes.length === 0) {
          throw new Error("No route found");
        }

        // Render on map
        const renderer = new DirectionsRenderer({
          map,
          directions: result,
          suppressMarkers: true,
          polylineOptions: {
            strokeColor: "#58a6ff",
            strokeWeight: 4,
            strokeOpacity: 0.8,
          },
        });
        rendererRef.current = renderer;

        // Extract steps
        const leg = result.routes[0]!.legs[0]!;
        setTotalDuration(leg.duration?.text ?? "");
        setTotalDistance(leg.distance?.text ?? "");

        const parsed: DirectionStep[] = leg.steps.map((step) => {
          const s: DirectionStep = {
            instruction: step.instructions ?? "",
            distance: step.distance?.text ?? "",
            duration: step.duration?.text ?? "",
            travelMode: step.travel_mode,
          };

          if (step.transit?.line) {
            s.transitLine = step.transit.line.short_name ?? step.transit.line.name ?? "";
            s.transitColor = step.transit.line.color ?? "#58a6ff";
          }

          return s;
        });

        setSteps(parsed);
        setLoading(false);
      } catch (err) {
        // If transit fails, auto-fallback to walking
        if (requestedMode === "TRANSIT") {
          setMode("WALKING");
          void fetchDirections("WALKING");
          return;
        }

        setError(
          err instanceof Error ? err.message : "Failed to get directions",
        );
        setLoading(false);
      }
    },
    [map, fromPin, toPin],
  );

  // Fetch directions when inputs change
  useEffect(() => {
    if (fromPin && toPin && map) {
      void fetchDirections(mode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromPin?.lat, fromPin?.lng, toPin?.lat, toPin?.lng, map, mode]);

  if (!fromPin || !toPin) return null;

  return (
    <div className="bg-card mt-4 rounded-xl border p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-widest">
            Directions
          </h3>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {fromPin.title} → {toPin.title}
          </p>
        </div>
        <div className="flex gap-1">
          {(Object.keys(MODE_LABELS) as TravelMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                mode === m
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <p className="text-muted-foreground animate-pulse py-4 text-center text-sm">
          Finding route...
        </p>
      )}

      {error && (
        <p className="text-destructive py-4 text-center text-sm">{error}</p>
      )}

      {!loading && !error && steps.length > 0 && (
        <>
          <div className="mb-3 flex gap-4 text-sm">
            <span className="font-mono font-medium">{totalDuration}</span>
            <span className="text-muted-foreground font-mono">
              {totalDistance}
            </span>
          </div>
          <ol className="space-y-2">
            {steps.map((step, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="text-muted-foreground mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  {step.transitLine && (
                    <span
                      className="mr-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
                      style={{
                        backgroundColor: step.transitColor ?? "#58a6ff",
                      }}
                    >
                      {step.transitLine}
                    </span>
                  )}
                  <span
                    className="text-foreground"
                    dangerouslySetInnerHTML={{ __html: step.instruction }}
                  />
                  <span className="text-muted-foreground ml-2 text-xs">
                    {step.duration} · {step.distance}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
