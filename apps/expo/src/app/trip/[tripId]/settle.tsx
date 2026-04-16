import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { trpc } from "~/utils/api";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function truncateId(id: string) {
  return id.slice(0, 8) + "...";
}

export default function SettleScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const workspaceId = getActiveWorkspaceId() ?? "";

  const { data, isLoading } = useQuery(
    trpc.settlements.summary.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
    }),
  );

  if (isLoading) {
    return (
      <SafeAreaView className="bg-background flex-1">
        <Stack.Screen options={{ title: "Settle Up" }} />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!data) {
    return (
      <SafeAreaView className="bg-background flex-1">
        <Stack.Screen options={{ title: "Settle Up" }} />
        <View className="flex-1 items-center justify-center">
          <Text className="text-muted-foreground">
            Could not load settlement data.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const memberName = (userId: string) => {
    const member = data.members.find((m) => m.userId === userId);
    return member?.displayName ?? truncateId(userId);
  };

  return (
    <SafeAreaView className="bg-background flex-1">
      <Stack.Screen options={{ title: "Settle Up" }} />
      <ScrollView className="flex-1 px-4 pt-4">
        {data.allSettled ? (
          <View className="items-center py-12">
            <Text className="text-foreground mb-2 text-xl font-bold">
              All settled!
            </Text>
            <Text className="text-muted-foreground text-center">
              Everyone is even. No payments needed.
            </Text>
          </View>
        ) : (
          <>
            {/* Balances */}
            <View className="mb-6">
              <Text className="text-foreground mb-3 text-lg font-semibold">
                Balances
              </Text>
              {data.balances.map((b) => (
                <View
                  key={b.userId}
                  className="border-border mb-2 flex-row items-center justify-between rounded-lg border p-3"
                >
                  <Text className="text-foreground">
                    {memberName(b.userId)}
                  </Text>
                  <Text
                    className={`font-mono font-medium ${
                      b.amountCents >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {b.amountCents >= 0 ? "+" : ""}
                    {formatCurrency(b.amountCents)}
                  </Text>
                </View>
              ))}
            </View>

            {/* Suggested transactions */}
            {data.suggestedTransactions.length > 0 && (
              <View className="mb-6">
                <Text className="text-foreground mb-3 text-lg font-semibold">
                  Suggested Payments
                </Text>
                {data.suggestedTransactions.map((tx, i) => (
                  <View
                    key={`${tx.fromUserId}-${tx.toUserId}-${i}`}
                    className="border-border bg-card mb-2 rounded-lg border p-4"
                  >
                    <Text className="text-foreground text-base">
                      <Text className="font-semibold">
                        {memberName(tx.fromUserId)}
                      </Text>
                      {" pays "}
                      <Text className="font-semibold">
                        {memberName(tx.toUserId)}
                      </Text>
                    </Text>
                    <Text className="text-primary mt-1 font-mono text-lg font-bold">
                      {formatCurrency(tx.amountCents)}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
