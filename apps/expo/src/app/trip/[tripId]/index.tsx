import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { trpc } from "~/utils/api";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

const STATUS_COLORS: Record<string, string> = {
  planning: "bg-yellow-500",
  confirmed: "bg-blue-500",
  active: "bg-green-500",
  completed: "bg-gray-500",
};

function formatDate(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
    new Date(value),
  );
}

const TABS = [
  { key: "expenses", label: "Expenses", path: "expenses" },
  { key: "settle", label: "Settle", path: "settle" },
  { key: "plan", label: "Plan", path: "polls" },
  { key: "map", label: "Map", path: "map" },
] as const;

export default function TripDetail() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const router = useRouter();
  const workspaceId = getActiveWorkspaceId() ?? "";

  const { data: trip, isLoading } = useQuery(
    trpc.trips.get.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
    }),
  );

  if (isLoading) {
    return (
      <SafeAreaView className="bg-background flex-1">
        <Stack.Screen options={{ title: "Trip" }} />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!trip) {
    return (
      <SafeAreaView className="bg-background flex-1">
        <Stack.Screen options={{ title: "Trip" }} />
        <View className="flex-1 items-center justify-center">
          <Text className="text-muted-foreground">Trip not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="bg-background flex-1">
      <Stack.Screen options={{ title: trip.name }} />
      <ScrollView className="flex-1 px-4 pt-4">
        {/* Trip header */}
        <View className="mb-6">
          <View className="mb-2 flex-row items-center gap-3">
            <Text className="text-foreground text-2xl font-bold">
              {trip.name}
            </Text>
            <View
              className={`rounded-full px-2 py-0.5 ${STATUS_COLORS[trip.status] ?? "bg-gray-400"}`}
            >
              <Text className="text-xs font-medium capitalize text-white">
                {trip.status}
              </Text>
            </View>
          </View>

          {trip.destinationName && (
            <Text className="text-muted-foreground mb-1 text-base">
              {trip.destinationName}
            </Text>
          )}

          {(trip.startDate || trip.endDate) && (
            <Text className="text-muted-foreground text-sm">
              {formatDate(trip.startDate)}
              {trip.startDate && trip.endDate ? " - " : ""}
              {formatDate(trip.endDate)}
            </Text>
          )}
        </View>

        {/* Tab navigation */}
        <View className="flex-row gap-3">
          {TABS.map((tab) => (
            <Pressable
              key={tab.key}
              onPress={() =>
                router.push({
                  pathname: `/trip/[tripId]/${tab.path}` as any,
                  params: { tripId: tripId ?? "" },
                })
              }
              className="bg-primary flex-1 items-center rounded-lg px-3 py-4"
              style={{ minHeight: 56 }}
            >
              <Text className="text-primary-foreground font-semibold">
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
