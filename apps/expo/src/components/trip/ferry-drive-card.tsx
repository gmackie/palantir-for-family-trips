import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";

import type { RouterOutputs } from "~/utils/api";
import { trpc } from "~/utils/api";
import { C, mono, R } from "~/utils/design";

type FerryCrossing = RouterOutputs["ferries"]["listForTrip"][number];

// ---- formatting helpers -------------------------------------------------

/** "14:05" in 24h, locale-stable for monospace alignment. */
function fmtClock(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** "Jul 9" — short day label so the time line stays unambiguous. */
function fmtDay(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(d);
}

// ---- next-crossing selection -------------------------------------------

/**
 * Pick the next upcoming crossing: the earliest `scheduledDepartureAt` strictly
 * in the future. Crossings without a scheduled time can't be "next" (no
 * deadline to count down to) so they're skipped. The list already arrives
 * sorted by departure asc, but we re-derive against `now` so a stale leading
 * (past) crossing is never shown.
 */
function pickNextCrossing(
  crossings: FerryCrossing[],
  now: Date,
): FerryCrossing | null {
  let best: FerryCrossing | null = null;
  for (const c of crossings) {
    if (!c.scheduledDepartureAt) continue;
    const dep = new Date(c.scheduledDepartureAt);
    if (dep.getTime() <= now.getTime()) continue;
    if (!best) {
      best = c;
      continue;
    }
    const bestDep = new Date(best.scheduledDepartureAt as Date);
    if (dep.getTime() < bestDep.getTime()) best = c;
  }
  return best;
}

/**
 * "Be in line by" time: scheduled departure minus the operator's arrival
 * cutoff. This is intentionally NOT the full "leave-by" (which would also
 * subtract drive-time-to-terminal) — drive time isn't available on this
 * screen, so we only show the terminal queue deadline and label it honestly.
 */
function beInLineBy(crossing: FerryCrossing): Date | null {
  if (!crossing.scheduledDepartureAt) return null;
  const dep = new Date(crossing.scheduledDepartureAt);
  return new Date(dep.getTime() - crossing.arrivalCutoffMinutes * 60_000);
}

// ---- card ---------------------------------------------------------------

export function FerryDriveCard({
  tripId,
  workspaceId,
}: {
  tripId: string;
  workspaceId: string;
}) {
  "use no memo";
  const { data } = useQuery(
    trpc.ferries.listForTrip.queryOptions(
      { workspaceId, tripId },
      // Same cadence as the rest of Driving Mode; a ferry schedule is static
      // but re-running keeps the "next" pick honest as crossings pass.
      { refetchInterval: 10_000 },
    ),
  );

  const next = data ? pickNextCrossing(data, new Date()) : null;

  // Driving Mode stays clean: render nothing when there's no upcoming ferry.
  if (!next) return null;

  const dep = next.scheduledDepartureAt
    ? new Date(next.scheduledDepartureAt)
    : null;
  const lineBy = beInLineBy(next);

  const route =
    next.departureTerminal && next.arrivalTerminal
      ? `${next.departureTerminal} → ${next.arrivalTerminal}`
      : (next.departureTerminal ?? next.arrivalTerminal ?? "Ferry crossing");

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: C.info,
        backgroundColor: C.surface,
        borderRadius: R.md,
        padding: 18,
        gap: 12,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Ionicons name="boat-outline" size={16} color={C.info} />
        <Text
          style={{
            color: C.muted,
            fontSize: 12,
            fontWeight: "700",
            textTransform: "uppercase",
            letterSpacing: 1.2,
          }}
        >
          Next Ferry
        </Text>
        {next.vehicleReservation && (
          <View
            style={{
              marginLeft: "auto",
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              borderWidth: 1,
              borderColor: C.success,
              backgroundColor: C.successBg,
              borderRadius: R.sm,
              paddingHorizontal: 8,
              paddingVertical: 3,
            }}
          >
            <Ionicons name="car-outline" size={12} color={C.success} />
            <Text
              style={{
                color: C.success,
                fontSize: 11,
                fontWeight: "700",
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              Vehicle
            </Text>
          </View>
        )}
      </View>

      {next.operator && (
        <Text
          style={{ color: C.fg, fontSize: 18, fontWeight: "700" }}
          numberOfLines={1}
        >
          {next.operator}
        </Text>
      )}

      <Text style={{ color: C.fg, fontSize: 16 }} numberOfLines={1}>
        {route}
      </Text>

      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 24,
        }}
      >
        <View>
          <Text
            style={{
              color: C.fg,
              fontSize: 32,
              fontWeight: "800",
              fontFamily: mono,
              fontVariant: ["tabular-nums"],
              lineHeight: 36,
            }}
          >
            {dep ? fmtClock(dep) : "--:--"}
          </Text>
          <Text
            style={{
              color: C.muted,
              fontSize: 12,
              fontWeight: "600",
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            {dep ? `Departs · ${fmtDay(dep)}` : "Departs"}
          </Text>
        </View>

        {lineBy && (
          <View style={{ paddingBottom: 2 }}>
            <Text
              style={{
                color: C.warning,
                fontSize: 24,
                fontWeight: "700",
                fontFamily: mono,
                fontVariant: ["tabular-nums"],
              }}
            >
              {fmtClock(lineBy)}
            </Text>
            <Text
              style={{
                color: C.muted,
                fontSize: 12,
                fontWeight: "600",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Be in line by
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}
