import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";

import { trpc } from "~/utils/api";
import { C, mono, R } from "~/utils/design";

// ---- route-gradient ramp ------------------------------------------------

// Hours-from-now encoding: near (left) is warm/bright, far (right) cools off.
// Mirrors the web RouteGradientMap's rainbow ramp, condensed to a glanceable
// bar for Driving Mode.
const RAMP_STOPS = ["#F85149", "#D29922", "#3FB950", "#58A6FF"] as const;
const RAMP_SEGMENTS = 24;

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpColor(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r},${g},${bl})`;
}

/** Color for a normalized position t in [0,1] across the ramp. */
function rampColor(t: number): string {
  const scaled = Math.min(Math.max(t, 0), 1) * (RAMP_STOPS.length - 1);
  const i = Math.min(Math.floor(scaled), RAMP_STOPS.length - 2);
  return lerpColor(RAMP_STOPS[i]!, RAMP_STOPS[i + 1]!, scaled - i);
}

function fmtMile(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

// ---- card ---------------------------------------------------------------

/**
 * Route Ahead — a glanceable port of the web Route Gradient into Driving Mode.
 * Shows the trip as a warm→cool gradient bar with Fuel Zone (⛽) and Overnight
 * Zone (🌅) markers placed by mile marker, plus the next predicted fuel stop.
 *
 * Renders nothing when there is no planned route, so Driving Mode stays clean.
 */
export function RouteAheadCard({
  tripId,
  workspaceId,
}: {
  tripId: string;
  workspaceId: string;
}) {
  "use no memo";
  const { data: zones } = useQuery(
    trpc.routePlanner.predictZones.queryOptions(
      { workspaceId, tripId },
      { refetchInterval: 30_000 },
    ),
  );
  const { data: preview } = useQuery(
    trpc.routePlanner.getRoutePreview.queryOptions({ workspaceId, tripId }),
  );

  const totalMiles = preview?.totalMiles ?? 0;
  if (totalMiles <= 0) return null;

  const fuelZones = zones?.fuelZones ?? [];
  const overnightZones = zones?.overnightZones ?? [];

  type Marker = {
    key: string;
    emoji: string;
    mileMarker: number;
    color: string;
  };
  const markers: Marker[] = [
    ...overnightZones.map((z, i) => ({
      key: `o${i}`,
      emoji: "🌅",
      mileMarker: z.mileMarker,
      color: C.warning,
    })),
    ...fuelZones.map((z, i) => ({
      key: `f${i}`,
      emoji: "⛽",
      mileMarker: z.mileMarker,
      color: C.info,
    })),
  ].sort((a, b) => a.mileMarker - b.mileMarker);

  const nextFuel = fuelZones[0] ?? null;

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: C.border,
        backgroundColor: C.surface,
        borderRadius: R.md,
        padding: 18,
        gap: 14,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name="navigate-outline" size={16} color={C.info} />
        <Text
          style={{
            color: C.muted,
            fontSize: 12,
            fontWeight: "700",
            textTransform: "uppercase",
            letterSpacing: 1.2,
          }}
        >
          Route Ahead
        </Text>
        <Text
          style={{
            marginLeft: "auto",
            color: C.muted,
            fontSize: 13,
            fontFamily: mono,
            fontVariant: ["tabular-nums"],
          }}
        >
          {fmtMile(totalMiles)} mi
        </Text>
      </View>

      {/* Gradient bar with zone markers overlaid. */}
      <View style={{ height: 52 }}>
        {/* Markers row */}
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: 22,
          }}
        >
          {markers.map((m) => {
            const pct =
              Math.min(Math.max(m.mileMarker / totalMiles, 0), 1) * 100;
            return (
              <View
                key={m.key}
                style={{
                  position: "absolute",
                  left: `${pct}%`,
                  marginLeft: -11,
                  alignItems: "center",
                  width: 22,
                }}
              >
                <Text style={{ fontSize: 14 }}>{m.emoji}</Text>
                <View
                  style={{
                    width: 2,
                    height: 6,
                    backgroundColor: m.color,
                  }}
                />
              </View>
            );
          })}
        </View>

        {/* The gradient ramp */}
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 26,
            height: 10,
            flexDirection: "row",
            borderRadius: R.sm,
            overflow: "hidden",
          }}
        >
          {Array.from({ length: RAMP_SEGMENTS }, (_, i) => (
            <View
              key={i}
              style={{
                flex: 1,
                backgroundColor: rampColor(i / (RAMP_SEGMENTS - 1)),
              }}
            />
          ))}
        </View>

        {/* Mile endpoints */}
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 40,
            flexDirection: "row",
            justifyContent: "space-between",
          }}
        >
          <Text
            style={{
              color: C.muted,
              fontSize: 11,
              fontFamily: mono,
              fontVariant: ["tabular-nums"],
            }}
          >
            0
          </Text>
          <Text
            style={{
              color: C.muted,
              fontSize: 11,
              fontFamily: mono,
              fontVariant: ["tabular-nums"],
            }}
          >
            {fmtMile(totalMiles)}
          </Text>
        </View>
      </View>

      {/* Glanceable summary */}
      {nextFuel ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontSize: 14 }}>⛽</Text>
          <Text style={{ color: C.fg, fontSize: 15, fontWeight: "600" }}>
            Next fuel zone
          </Text>
          <Text
            style={{
              marginLeft: "auto",
              color: C.info,
              fontSize: 16,
              fontWeight: "700",
              fontFamily: mono,
              fontVariant: ["tabular-nums"],
            }}
          >
            mile {fmtMile(nextFuel.mileMarker)}
          </Text>
        </View>
      ) : zones?.hasVanModel === false ? (
        <Text style={{ color: C.muted, fontSize: 13 }}>
          Add the van's MPG + tank size to predict fuel zones.
        </Text>
      ) : (
        <Text style={{ color: C.muted, fontSize: 13 }}>
          {overnightZones.length > 0
            ? `${overnightZones.length} overnight ${overnightZones.length === 1 ? "stop" : "stops"} ahead.`
            : "No fuel stops needed for this route."}
        </Text>
      )}
    </View>
  );
}
