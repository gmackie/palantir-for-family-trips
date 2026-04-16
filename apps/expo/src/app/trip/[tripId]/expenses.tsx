import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { trpc } from "~/utils/api";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

function formatCurrency(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function formatDate(value: Date | string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "short" }).format(
    new Date(value),
  );
}

const STATUS_BADGE: Record<string, { bg: string; text: string }> = {
  draft: { bg: "bg-yellow-100", text: "text-yellow-800" },
  finalized: { bg: "bg-green-100", text: "text-green-800" },
};

export default function ExpenseList() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const router = useRouter();
  const workspaceId = getActiveWorkspaceId() ?? "";

  const { data: expenses, isLoading } = useQuery(
    trpc.expenses.list.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
    }),
  );

  return (
    <SafeAreaView className="bg-background flex-1">
      <Stack.Screen options={{ title: "Expenses" }} />

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" />
        </View>
      ) : !expenses || expenses.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-muted-foreground mb-2 text-lg">
            No expenses yet
          </Text>
          <Text className="text-muted-foreground text-center text-sm">
            Add your first expense to start tracking costs.
          </Text>
        </View>
      ) : (
        <FlatList
          data={expenses}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
          ItemSeparatorComponent={() => <View className="h-3" />}
          renderItem={({ item }) => {
            const badge = STATUS_BADGE[item.status] ?? { bg: "bg-yellow-100", text: "text-yellow-800" };
            return (
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: "/trip/[tripId]/expense/[expenseId]",
                    params: { tripId: tripId ?? "", expenseId: item.id },
                  })
                }
                className="border-border bg-card rounded-lg border p-4"
              >
                <View className="mb-1 flex-row items-center justify-between">
                  <Text className="text-foreground text-base font-semibold">
                    {item.merchant}
                  </Text>
                  <Text className="text-foreground font-mono text-base font-medium">
                    {formatCurrency(item.totalCents, item.currency)}
                  </Text>
                </View>
                <View className="flex-row items-center gap-2">
                  <View className={`rounded-full px-2 py-0.5 ${badge.bg}`}>
                    <Text className={`text-xs font-medium capitalize ${badge.text}`}>
                      {item.status}
                    </Text>
                  </View>
                  <Text className="text-muted-foreground text-xs">
                    {formatDate(item.occurredAt)}
                  </Text>
                  <Text className="text-muted-foreground text-xs capitalize">
                    {item.category}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {/* Floating "New expense" button */}
      <View className="absolute bottom-8 left-0 right-0 items-center">
        <Pressable
          onPress={() =>
            router.push({
              pathname: "/trip/[tripId]/new-expense" as any,
              params: { tripId: tripId ?? "" },
            })
          }
          className="bg-primary rounded-full px-6 py-4 shadow-lg"
          style={{ minHeight: 48 }}
        >
          <Text className="text-primary-foreground font-semibold">
            + New Expense
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
