import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Text, View } from "react-native";

import { GroupTripDetail } from "~/components/trip/group-trip-detail";
import { RoadTripDetail } from "~/components/trip/road-trip-detail";
import { trpc } from "~/utils/api";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

export default function TripDetail() {
  "use no memo";
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const workspaceId = getActiveWorkspaceId() ?? "";

  const { data: trip, isLoading } = useQuery(
    trpc.trips.get.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
    }),
  );

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: "#141116" }}>
        <Stack.Screen options={{ title: "Trip" }} />
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <ActivityIndicator size="large" />
        </View>
      </View>
    );
  }

  if (!trip) {
    return (
      <View style={{ flex: 1, backgroundColor: "#141116" }}>
        <Stack.Screen options={{ title: "Trip" }} />
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ color: "#8c8691" }}>Trip not found</Text>
        </View>
      </View>
    );
  }

  const isRoadTrip = (trip as any).tripMode === "roadtrip";

  return (
    <View style={{ flex: 1, backgroundColor: "#141116" }}>
      <Stack.Screen options={{ title: trip.name }} />
      {isRoadTrip ? (
        <RoadTripDetail trip={trip} tripId={tripId ?? ""} />
      ) : (
        <GroupTripDetail trip={trip} tripId={tripId ?? ""} />
      )}
    </View>
  );
}
