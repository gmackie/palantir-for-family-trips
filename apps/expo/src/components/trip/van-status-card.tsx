import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";

import type { RouterOutputs } from "~/utils/api";
import { trpc } from "~/utils/api";
import { C, mono, R } from "~/utils/design";

type VanSnapshot = NonNullable<RouterOutputs["vanTelemetry"]["getSnapshot"]>;
type VanReading = VanSnapshot[number];

// ---- reading selection --------------------------------------------------

/** First reading whose `metric` matches, or null when the snapshot lacks it. */
function pickMetric(readings: VanSnapshot, metric: string): VanReading | null {
  for (const r of readings) {
    if (r.metric === metric) return r;
  }
  return null;
}

/**
 * Semantic color for battery state-of-charge. Charge is "good news at the top":
 * green when comfortably full, amber as it drains, red when critically low. The
 * thresholds (50 / 20) are intentionally generous for a van house battery where
 * dropping below ~20% risks the night's lights and fridge.
 */
function batteryTone(soc: number): string {
  if (soc > 50) return C.success;
  if (soc >= 20) return C.warning;
  return C.critical;
}

/** Trim a trailing ".0" so whole numbers read cleanly in the dense layout. */
function fmtValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// ---- metric row ---------------------------------------------------------

function MetricRow({
  label,
  reading,
  valueColor,
}: {
  label: string;
  reading: VanReading;
  valueColor?: string;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "baseline",
        justifyContent: "space-between",
      }}
    >
      <Text
        style={{
          color: C.muted,
          fontSize: 12,
          fontWeight: "600",
          textTransform: "uppercase",
          letterSpacing: 1,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: valueColor ?? C.fg,
          fontSize: 22,
          fontWeight: "700",
          fontFamily: mono,
          fontVariant: ["tabular-nums"],
        }}
      >
        {fmtValue(reading.value)}
        <Text style={{ fontSize: 14, color: C.muted }}>
          {reading.unit ? ` ${reading.unit}` : ""}
        </Text>
      </Text>
    </View>
  );
}

// ---- card ---------------------------------------------------------------

export function VanStatusCard({
  tripId,
  workspaceId,
}: {
  tripId: string;
  workspaceId: string;
}) {
  "use no memo";
  const { data } = useQuery(
    trpc.vanTelemetry.getSnapshot.queryOptions(
      { workspaceId, tripId },
      // Same 10s cadence as the rest of Driving Mode; telemetry is a single
      // snapshot the screen's poll keeps fresh.
      { refetchInterval: 10_000 },
    ),
  );

  // The procedure returns `null` when the flag is off, the van isn't rig-linked,
  // or the provider fails. Render nothing in any of those cases so Driving Mode
  // stays clean — the card is invisible unless telemetry is enabled + linked.
  if (!data || data.length === 0) return null;

  const battery = pickMetric(data, "battery_soc");
  const insideTemp = pickMetric(data, "inside_temp");
  // driftport names fresh-water tank level `fresh_level`; fall back to a plain
  // `water_level` metric if a different rig reports it that way.
  const water =
    pickMetric(data, "fresh_level") ?? pickMetric(data, "water_level");

  // If none of the headline metrics are present there is nothing worth a card.
  if (!battery && !insideTemp && !water) return null;

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: C.border,
        backgroundColor: C.surface,
        borderRadius: R.md,
        padding: 18,
        gap: 12,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name="battery-charging-outline" size={16} color={C.info} />
        <Text
          style={{
            color: C.muted,
            fontSize: 12,
            fontWeight: "700",
            textTransform: "uppercase",
            letterSpacing: 1.2,
          }}
        >
          Van Status
        </Text>
      </View>

      <View style={{ gap: 10 }}>
        {battery && (
          <MetricRow
            label="Battery"
            reading={battery}
            valueColor={batteryTone(battery.value)}
          />
        )}
        {insideTemp && <MetricRow label="Inside" reading={insideTemp} />}
        {water && <MetricRow label="Water" reading={water} />}
      </View>
    </View>
  );
}
