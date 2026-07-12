import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as Location from "expo-location";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { trpc } from "~/utils/api";
import { C, mono, R } from "~/utils/design";

/**
 * Side-trip prompt for Driving Mode. Polls GPS + planned route; when the
 * vehicle is >2 mi off the polyline, offer to log a stop / open map (pause
 * guidance by leaving the planned corridor intentionally).
 */
export function SideTripCard({
  tripId,
  workspaceId,
  onLogStop,
  onOpenMap,
  onReplan,
  onExplore,
}: {
  tripId: string;
  workspaceId: string;
  onLogStop: () => void;
  onOpenMap: () => void;
  /** Open Today replan with side_trip reason */
  onReplan?: () => void;
  /** Mark run_state side_trip */
  onExplore?: () => void;
}) {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function sample() {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== "granted") {
          const req = await Location.requestForegroundPermissionsAsync();
          if (req.status !== "granted") return;
        }
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) {
          setCoords({
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
          });
        }
      } catch {
        // GPS optional — card stays hidden.
      }
    }

    void sample();
    timer = setInterval(() => void sample(), 30_000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  // Reset dismiss when we return on-route so a later deviation can re-prompt.
  const { data } = useQuery(
    trpc.routePlanner.assessSideTrip.queryOptions(
      {
        workspaceId,
        tripId,
        lat: coords?.lat ?? 0,
        lng: coords?.lng ?? 0,
      },
      {
        enabled: Boolean(workspaceId && tripId && coords),
        refetchInterval: 30_000,
      },
    ),
  );

  useEffect(() => {
    if (data && !data.offRoute) setDismissed(false);
  }, [data?.offRoute, data]);

  if (!data || data.unavailable || !data.offRoute || dismissed) {
    return null;
  }

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: C.warning + "99",
        backgroundColor: C.surface,
        borderRadius: R.md,
        padding: 16,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name="git-branch-outline" size={16} color={C.warning} />
        <Text
          style={{
            color: C.muted,
            fontSize: 12,
            fontWeight: "700",
            textTransform: "uppercase",
            letterSpacing: 1.2,
          }}
        >
          Side trip?
        </Text>
      </View>
      <Text style={{ color: C.fg, fontSize: 15, fontWeight: "600" }}>
        You&apos;re about{" "}
        <Text style={{ fontFamily: mono }}>
          {data.milesFromRoute.toFixed(1)} mi
        </Text>{" "}
        off the planned route.
      </Text>
      <Text style={{ color: C.muted, fontSize: 13, lineHeight: 18 }}>
        Pause guidance to explore, log a stop, or open the map. Resume later
        from Day plan / replan when you rejoin the corridor.
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {onExplore ? (
          <Pressable
            onPress={onExplore}
            style={{
              backgroundColor: C.warning + "22",
              borderWidth: 1,
              borderColor: C.warning + "66",
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}
          >
            <Text style={{ color: C.warning, fontWeight: "700", fontSize: 13 }}>
              Explore
            </Text>
          </Pressable>
        ) : null}
        {onReplan ? (
          <Pressable
            onPress={onReplan}
            style={{
              borderWidth: 1,
              borderColor: C.info + "66",
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}
          >
            <Text style={{ color: C.info, fontWeight: "700", fontSize: 13 }}>
              Replan from here
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onLogStop}
          style={{
            borderWidth: 1,
            borderColor: C.border,
            paddingHorizontal: 12,
            paddingVertical: 8,
          }}
        >
          <Text style={{ color: C.fg, fontWeight: "600", fontSize: 13 }}>
            Log stop
          </Text>
        </Pressable>
        <Pressable
          onPress={onOpenMap}
          style={{
            borderWidth: 1,
            borderColor: C.border,
            paddingHorizontal: 12,
            paddingVertical: 8,
          }}
        >
          <Text style={{ color: C.fg, fontWeight: "600", fontSize: 13 }}>
            Map
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setDismissed(true)}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 8,
          }}
        >
          <Text style={{ color: C.muted, fontSize: 13 }}>Dismiss</Text>
        </Pressable>
      </View>
    </View>
  );
}
