import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { trpc } from "~/utils/api";
import { C, mono, R } from "~/utils/design";

const STATUS_COLORS: Record<string, string> = {
  planning: C.warning,
  confirmed: C.info,
  en_route: C.warning,
  active: C.success,
  paused: C.warning,
  completed: C.muted,
};

function formatDate(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
    new Date(value),
  );
}

interface Trip {
  id: string;
  name: string;
  status: string;
  groupMode: boolean;
  destinationName: string | null;
  startDate: string | null;
  endDate: string | null;
}

export function RoadTripDetail({
  trip,
  tripId,
  workspaceId,
}: {
  trip: Trip;
  tripId: string;
  workspaceId: string;
}) {
  "use no memo";
  const router = useRouter();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(trip.name);
  const [editDest, setEditDest] = useState(trip.destinationName ?? "");
  const [editStart, setEditStart] = useState(trip.startDate ?? "");
  const [editEnd, setEditEnd] = useState(trip.endDate ?? "");

  const { data: routePreview } = useQuery(
    trpc.routePlanner.getRoutePreview.queryOptions({
      workspaceId,
      tripId,
    }),
  );

  const { data: fuelStats } = useQuery(
    trpc.fuelLogs.stats.queryOptions({ workspaceId, tripId }),
  );

  const { data: segments } = useQuery(
    trpc.trips.listSegments.queryOptions({ workspaceId, tripId }),
  );

  const { data: planDays } = useQuery(
    trpc.planner.listDays.queryOptions({ workspaceId, tripId }),
  );

  const { data: nextAnchor } = useQuery(
    trpc.anchors.next.queryOptions({ workspaceId, tripId }),
  );

  const todayStr = new Date().toISOString().slice(0, 10);
  const upcomingDay =
    planDays?.find((d) => d.date >= todayStr) ?? planDays?.[0] ?? null;

  const updateTrip = useMutation(
    trpc.trips.update.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.trips.get.queryFilter());
        setEditing(false);
      },
      onError: (err) => Alert.alert("Error", err.message),
    }),
  );

  const setStatus = useMutation(
    trpc.trips.setStatus.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.trips.get.queryFilter());
      },
      onError: (err) => Alert.alert("Error", err.message),
    }),
  );

  const totalMiles = routePreview?.totalMiles ?? null;
  const totalGallons = fuelStats?.totalGallons ?? null;

  let days: number | null = null;
  if (trip.startDate && trip.endDate) {
    const ms =
      new Date(trip.endDate).getTime() - new Date(trip.startDate).getTime();
    days = Math.max(1, Math.round(ms / 86400000));
  }

  const firstSeg = segments?.[0];
  const lastSeg = segments?.[segments.length - 1];
  const originName = firstSeg?.originName ?? null;
  const destName = lastSeg?.destinationName ?? trip.destinationName ?? null;

  const isSolo = !trip.groupMode;
  const isActive = trip.status === "en_route" || trip.status === "active";

  const hasRoute = (segments?.length ?? 0) > 0 && !!segments?.[0]?.originName;

  const tabs: Array<{
    key: string;
    label: string;
    icon: React.ComponentProps<typeof Ionicons>["name"];
    path: string;
    params?: Record<string, string>;
  }> = [
    {
      key: "log-stop",
      label: "Log Stop",
      icon: "location-outline",
      path: "log-stop",
    },
    {
      key: "journey",
      label: "Journey",
      icon: "list-outline",
      path: "journey-log",
    },
    { key: "drive", label: "Drive", icon: "car-sport-outline", path: "drive" },
    {
      key: "day-plan",
      label: "Day plan",
      icon: "map-outline",
      path: "day-plan",
    },
    {
      key: "amenities",
      label: "Sleep / POIs",
      icon: "bed-outline",
      path: "day-plan",
    },
    { key: "map", label: "Route", icon: "navigate-outline", path: "map" },
    {
      key: "segments",
      label: "Segments",
      icon: "calendar-outline",
      path: "segments",
    },
    {
      key: "lodging",
      label: "Lodging",
      icon: "bed-outline",
      path: "lodging",
    },
    {
      key: "expenses",
      label: "Expenses",
      icon: "receipt-outline",
      path: "expenses",
    },
    {
      key: "chat",
      label: "Chat",
      icon: "chatbubbles-outline",
      path: "chat",
    },
    {
      key: "fuel",
      label: "Fuel Log",
      icon: "speedometer-outline",
      path: "new-expense",
      params: { type: "gas" },
    },
    ...(!isSolo
      ? [
          {
            key: "settle",
            label: "Settle Up",
            icon: "swap-horizontal-outline" as const,
            path: "settle",
          },
        ]
      : []),
  ];

  const handleSave = () => {
    updateTrip.mutate({
      workspaceId,
      tripId,
      name: editName.trim() || trip.name,
      destinationName: editDest.trim() || trip.destinationName || "",
      startDate: editStart || undefined,
      endDate: editEnd || undefined,
    });
  };

  const handleEndTrip = () => {
    Alert.alert("End Trip", "Mark this trip as completed?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "End Trip",
        style: "destructive",
        onPress: () =>
          setStatus.mutate({ workspaceId, tripId, status: "completed" }),
      },
    ]);
  };

  const handleStartTrip = () => {
    setStatus.mutate({ workspaceId, tripId, status: "en_route" });
  };

  return (
    <ScrollView style={{ flex: 1, paddingHorizontal: 16, paddingTop: 16 }}>
      {/* Header badges */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <View
          style={{
            backgroundColor: C.warningBg,
            borderRadius: R.md,
            paddingHorizontal: 8,
            paddingVertical: 4,
          }}
        >
          <Text
            style={{
              color: C.warning,
              fontSize: 11,
              fontWeight: "bold",
              letterSpacing: 1,
            }}
          >
            ROAD TRIP
          </Text>
        </View>
        {isSolo && (
          <View
            style={{
              backgroundColor: C.infoBg,
              borderRadius: R.md,
              paddingHorizontal: 8,
              paddingVertical: 4,
            }}
          >
            <Text
              style={{
                color: C.info,
                fontSize: 11,
                fontWeight: "bold",
                letterSpacing: 1,
              }}
            >
              SOLO
            </Text>
          </View>
        )}
        <View
          style={{
            backgroundColor: STATUS_COLORS[trip.status] ?? C.muted,
            borderRadius: R.sm,
            paddingHorizontal: 10,
            paddingVertical: 3,
          }}
        >
          <Text
            style={{
              color: C.white,
              fontSize: 12,
              fontWeight: "600",
              textTransform: "uppercase",
            }}
          >
            {trip.status.replace("_", " ")}
          </Text>
        </View>
      </View>

      {/* Trip info -- editable or display */}
      {editing ? (
        <View style={{ marginBottom: 24 }}>
          <TextInput
            style={{
              color: C.fg,
              fontSize: 22,
              fontWeight: "bold",
              borderBottomWidth: 1,
              borderBottomColor: C.border,
              paddingVertical: 8,
              marginBottom: 12,
            }}
            value={editName}
            onChangeText={setEditName}
            placeholder="Trip name"
            placeholderTextColor={C.placeholder}
          />
          <Text style={{ color: C.muted, fontSize: 12, marginBottom: 4 }}>
            Destination
          </Text>
          <TextInput
            style={{
              color: C.fg,
              fontSize: 16,
              borderWidth: 1,
              borderColor: C.border,
              backgroundColor: C.input,
              borderRadius: R.md,
              paddingHorizontal: 12,
              paddingVertical: 10,
              marginBottom: 12,
            }}
            value={editDest}
            onChangeText={setEditDest}
            placeholder="City, State"
            placeholderTextColor={C.placeholder}
          />
          <View style={{ flexDirection: "row", gap: 12, marginBottom: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.muted, fontSize: 12, marginBottom: 4 }}>
                Start (YYYY-MM-DD)
              </Text>
              <TextInput
                style={{
                  color: C.fg,
                  fontSize: 15,
                  borderWidth: 1,
                  borderColor: C.border,
                  backgroundColor: C.input,
                  borderRadius: R.md,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  fontFamily: mono,
                }}
                value={editStart}
                onChangeText={setEditStart}
                placeholder="2026-06-05"
                placeholderTextColor={C.placeholder}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.muted, fontSize: 12, marginBottom: 4 }}>
                End (YYYY-MM-DD)
              </Text>
              <TextInput
                style={{
                  color: C.fg,
                  fontSize: 15,
                  borderWidth: 1,
                  borderColor: C.border,
                  backgroundColor: C.input,
                  borderRadius: R.md,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  fontFamily: mono,
                }}
                value={editEnd}
                onChangeText={setEditEnd}
                placeholder="2026-06-10"
                placeholderTextColor={C.placeholder}
              />
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Pressable
              onPress={handleSave}
              disabled={updateTrip.isPending}
              style={{
                flex: 1,
                backgroundColor: C.info,
                borderRadius: R.md,
                paddingVertical: 12,
                alignItems: "center",
                opacity: updateTrip.isPending ? 0.6 : 1,
              }}
            >
              <Text style={{ color: C.white, fontWeight: "600" }}>Save</Text>
            </Pressable>
            <Pressable
              onPress={() => setEditing(false)}
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: C.border,
                borderRadius: R.md,
                paddingVertical: 12,
                alignItems: "center",
              }}
            >
              <Text style={{ color: C.fg, fontWeight: "600" }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          onPress={() => {
            setEditName(trip.name);
            setEditDest(trip.destinationName ?? "");
            setEditStart(trip.startDate ?? "");
            setEditEnd(trip.endDate ?? "");
            setEditing(true);
          }}
          style={{ marginBottom: 24 }}
        >
          <Text
            style={{
              color: C.fg,
              fontSize: 24,
              fontWeight: "bold",
              marginBottom: 6,
            }}
          >
            {trip.name}
          </Text>

          {(originName || destName) && (
            <Text style={{ color: C.muted, fontSize: 16, marginBottom: 4 }}>
              {originName && destName
                ? `${originName} → ${destName}`
                : (destName ?? originName)}
            </Text>
          )}

          {(trip.startDate || trip.endDate) && (
            <Text style={{ color: C.muted, fontSize: 15, marginBottom: 2 }}>
              {formatDate(trip.startDate)}
              {trip.startDate && trip.endDate ? " – " : ""}
              {formatDate(trip.endDate)}
            </Text>
          )}

          <Text style={{ color: C.info, fontSize: 12, marginTop: 4 }}>
            Tap to edit
          </Text>
        </Pressable>
      )}

      {/* Stats strip */}
      <View style={{ flexDirection: "row", gap: 12, marginBottom: 16 }}>
        <StatCard
          label="Miles"
          value={
            totalMiles != null ? Math.round(totalMiles).toLocaleString() : "—"
          }
        />
        <StatCard
          label="Fuel"
          value={
            totalGallons != null && totalGallons > 0
              ? `${totalGallons.toFixed(1)} gal`
              : "—"
          }
        />
        <StatCard
          label="Days"
          value={
            planDays && planDays.length > 0
              ? String(planDays.length)
              : days != null
                ? String(days)
                : "—"
          }
        />
      </View>

      {/* Plan preview */}
      <Pressable
        onPress={() =>
          router.push({
            pathname: "/trip/[tripId]/day-plan" as any,
            params: { tripId },
          })
        }
        style={{
          backgroundColor: C.surface,
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: R.md,
          padding: 14,
          marginBottom: 20,
          gap: 6,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text
            style={{
              color: C.muted,
              fontSize: 10,
              fontWeight: "900",
              letterSpacing: 1.5,
            }}
          >
            DAY PLAN
          </Text>
          <Ionicons name="chevron-forward" size={16} color={C.muted} />
        </View>
        {upcomingDay ? (
          <>
            <Text style={{ color: C.fg, fontSize: 16, fontWeight: "700" }}>
              {upcomingDay.title ??
                upcomingDay.overnightName ??
                upcomingDay.date}
            </Text>
            <Text style={{ color: C.muted, fontSize: 13 }}>
              {upcomingDay.date}
              {upcomingDay.intent ? ` · ${upcomingDay.intent}` : ""}
              {upcomingDay.heroTitle ? ` · ★ ${upcomingDay.heroTitle}` : ""}
            </Text>
          </>
        ) : (
          <Text style={{ color: C.muted, fontSize: 14 }}>
            No plan yet — tap to build multi-day itinerary
          </Text>
        )}
        {nextAnchor && (
          <Text
            style={{
              color: nextAnchor.behind ? C.critical : C.warning,
              fontSize: 12,
              marginTop: 2,
              fontFamily: mono,
            }}
          >
            Next: {nextAnchor.anchor.title}
            {nextAnchor.daysUntil != null ? ` · ${nextAnchor.daysUntil}d` : ""}
            {nextAnchor.behind ? " · BEHIND" : ""}
          </Text>
        )}
      </Pressable>

      {/* Tab grid */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {tabs.map((tab) => (
          <Pressable
            key={tab.key}
            onPress={() =>
              router.push({
                pathname: `/trip/[tripId]/${tab.path}` as any,
                params: {
                  tripId,
                  ...("params" in tab ? tab.params : {}),
                },
              })
            }
            style={{
              width: "47%",
              backgroundColor: C.surface,
              borderRadius: R.md,
              borderWidth: 1,
              borderColor: C.border,
              paddingVertical: 20,
              paddingHorizontal: 16,
              alignItems: "center",
              gap: 8,
            }}
          >
            <Ionicons name={tab.icon} size={24} color={C.muted} />
            <Text style={{ color: C.fg, fontSize: 15, fontWeight: "600" }}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Plan / Replan route */}
      {trip.status !== "completed" && (
        <Pressable
          onPress={() =>
            router.push({
              pathname: "/trip/[tripId]/plan-route" as any,
              params: { tripId },
            })
          }
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            backgroundColor: hasRoute ? C.surface : C.info,
            borderWidth: hasRoute ? 1 : 0,
            borderColor: C.border,
            borderRadius: R.md,
            paddingVertical: 16,
            marginTop: 24,
          }}
        >
          <Ionicons
            name={hasRoute ? "refresh-outline" : "navigate-outline"}
            size={18}
            color={hasRoute ? C.fg : C.white}
          />
          <Text
            style={{
              color: hasRoute ? C.fg : C.white,
              fontSize: 16,
              fontWeight: "600",
            }}
          >
            {hasRoute ? "Replan Route" : "Plan Route"}
          </Text>
        </Pressable>
      )}

      {/* Trip actions */}
      <View style={{ marginTop: 12, gap: 12, marginBottom: 40 }}>
        {!isActive && trip.status !== "completed" && (
          <Pressable
            onPress={handleStartTrip}
            disabled={setStatus.isPending}
            style={{
              backgroundColor: hasRoute ? C.info : C.surface,
              borderWidth: hasRoute ? 0 : 1,
              borderColor: C.border,
              borderRadius: R.md,
              paddingVertical: 16,
              alignItems: "center",
              opacity: setStatus.isPending ? 0.6 : 1,
            }}
          >
            <Text
              style={{
                color: hasRoute ? C.white : C.muted,
                fontSize: 16,
                fontWeight: "600",
              }}
            >
              Start Trip
            </Text>
          </Pressable>
        )}

        {isActive && (
          <>
            <Pressable
              onPress={() =>
                router.push({
                  pathname: "/trip/[tripId]/segments" as any,
                  params: { tripId },
                })
              }
              style={{
                borderWidth: 1,
                borderColor: C.border,
                borderRadius: R.md,
                paddingVertical: 16,
                alignItems: "center",
              }}
            >
              <Text style={{ color: C.fg, fontSize: 16, fontWeight: "600" }}>
                Review Progress
              </Text>
            </Pressable>
            <Pressable
              onPress={handleEndTrip}
              disabled={setStatus.isPending}
              style={{
                borderWidth: 1,
                borderColor: C.critical,
                borderRadius: R.md,
                paddingVertical: 16,
                alignItems: "center",
                opacity: setStatus.isPending ? 0.6 : 1,
              }}
            >
              <Text
                style={{ color: C.critical, fontSize: 16, fontWeight: "600" }}
              >
                End Trip
              </Text>
            </Pressable>
          </>
        )}

        {trip.status === "completed" && (
          <View
            style={{
              borderWidth: 1,
              borderColor: C.border,
              borderRadius: R.md,
              paddingVertical: 16,
              alignItems: "center",
            }}
          >
            <Text style={{ color: C.muted, fontSize: 16, fontWeight: "600" }}>
              Trip Complete
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: C.surface,
        borderRadius: R.md,
        borderWidth: 1,
        borderColor: C.border,
        padding: 12,
        alignItems: "center",
      }}
    >
      <Text
        style={{
          color: C.muted,
          fontSize: 11,
          fontWeight: "600",
          textTransform: "uppercase",
          letterSpacing: 0.5,
          marginBottom: 4,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: C.fg,
          fontSize: 18,
          fontWeight: "bold",
          fontFamily: mono,
        }}
      >
        {value}
      </Text>
    </View>
  );
}
