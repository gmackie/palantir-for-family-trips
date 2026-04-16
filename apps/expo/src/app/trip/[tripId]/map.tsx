import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { trpc } from "~/utils/api";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

export default function MapScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const workspaceId = getActiveWorkspaceId() ?? "";

  const { data: trip } = useQuery(
    trpc.trips.get.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
    }),
  );

  return (
    <SafeAreaView className="bg-background flex-1">
      <Stack.Screen options={{ title: "Map" }} />
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-foreground mb-2 text-xl font-bold">
          Trip Map
        </Text>
        {trip?.destinationName && (
          <Text className="text-muted-foreground mb-4 text-center">
            {trip.destinationName}
          </Text>
        )}
        {trip?.destinationLat && trip?.destinationLng && (
          <Text className="text-muted-foreground font-mono text-sm">
            {trip.destinationLat}, {trip.destinationLng}
          </Text>
        )}
        <Text className="text-muted-foreground mt-6 text-center text-sm">
          Map integration coming soon. Pins and segment locations will appear
          here.
        </Text>
      </View>
    </SafeAreaView>
  );
}
