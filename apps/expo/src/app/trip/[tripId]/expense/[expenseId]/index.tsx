import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

function formatCurrency(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function formatDate(value: Date | string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function ExpenseDetail() {
  const { tripId, expenseId } = useLocalSearchParams<{
    tripId: string;
    expenseId: string;
  }>();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const workspaceId = getActiveWorkspaceId() ?? "";
  const currentUserId = session?.user?.id;

  const { data, isLoading } = useQuery(
    trpc.expenses.get.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
      expenseId: expenseId ?? "",
    }),
  );

  const claimMutation = useMutation(
    trpc.expenses.claimLineItem.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(
          trpc.expenses.get.queryFilter(),
        );
      },
    }),
  );

  const unclaimMutation = useMutation(
    trpc.expenses.unclaimLineItem.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(
          trpc.expenses.get.queryFilter(),
        );
      },
    }),
  );

  if (isLoading) {
    return (
      <SafeAreaView className="bg-background flex-1">
        <Stack.Screen options={{ title: "Expense" }} />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!data) {
    return (
      <SafeAreaView className="bg-background flex-1">
        <Stack.Screen options={{ title: "Expense" }} />
        <View className="flex-1 items-center justify-center">
          <Text className="text-muted-foreground">Expense not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const { expense, lineItems, shares } = data;
  const isClaimed = (lineItemId: string) =>
    lineItems
      .find((li) => li.id === lineItemId)
      ?.claimantUserIds.includes(currentUserId ?? "");

  return (
    <SafeAreaView className="bg-background flex-1">
      <Stack.Screen options={{ title: expense.merchant }} />
      <ScrollView className="flex-1 px-4 pt-4">
        {/* Expense header */}
        <View className="border-border bg-card mb-4 rounded-lg border p-4">
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-foreground text-xl font-bold">
              {expense.merchant}
            </Text>
            <View
              className={`rounded-full px-2 py-0.5 ${
                expense.status === "finalized"
                  ? "bg-green-100"
                  : "bg-yellow-100"
              }`}
            >
              <Text
                className={`text-xs font-medium capitalize ${
                  expense.status === "finalized"
                    ? "text-green-800"
                    : "text-yellow-800"
                }`}
              >
                {expense.status}
              </Text>
            </View>
          </View>

          <Text className="text-muted-foreground mb-1 text-sm capitalize">
            {expense.category}
          </Text>
          <Text className="text-muted-foreground mb-3 text-xs">
            {formatDate(expense.occurredAt)}
          </Text>

          <View className="flex-row justify-between">
            <View>
              <Text className="text-muted-foreground text-xs">Subtotal</Text>
              <Text className="text-foreground font-mono">
                {formatCurrency(expense.subtotalCents, expense.currency)}
              </Text>
            </View>
            <View>
              <Text className="text-muted-foreground text-xs">Tax</Text>
              <Text className="text-foreground font-mono">
                {formatCurrency(expense.taxCents, expense.currency)}
              </Text>
            </View>
            <View>
              <Text className="text-muted-foreground text-xs">Tip</Text>
              <Text className="text-foreground font-mono">
                {formatCurrency(expense.tipCents, expense.currency)}
              </Text>
            </View>
            <View>
              <Text className="text-muted-foreground text-xs">Total</Text>
              <Text className="text-foreground font-mono font-bold">
                {formatCurrency(expense.totalCents, expense.currency)}
              </Text>
            </View>
          </View>
        </View>

        {/* Line items with claim buttons */}
        {lineItems.length > 0 && (
          <View className="mb-4">
            <Text className="text-foreground mb-3 text-lg font-semibold">
              Line Items
            </Text>
            {lineItems.map((item) => {
              const claimed = isClaimed(item.id);
              const claimCount = item.claimantUserIds.length;
              return (
                <View
                  key={item.id}
                  className="border-border bg-card mb-2 flex-row items-center justify-between rounded-lg border p-3"
                >
                  <View className="flex-1">
                    <Text className="text-foreground text-base font-medium">
                      {item.name}
                    </Text>
                    <Text className="text-muted-foreground text-xs">
                      Qty: {item.quantity} |{" "}
                      {formatCurrency(item.lineTotalCents, expense.currency)}
                      {claimCount > 0
                        ? ` | ${claimCount} claimed`
                        : ""}
                    </Text>
                  </View>

                  {expense.status === "finalized" && (
                    <Pressable
                      onPress={() => {
                        if (claimed) {
                          unclaimMutation.mutate({
                            workspaceId,
                            tripId: tripId ?? "",
                            expenseId: expenseId ?? "",
                            lineItemId: item.id,
                          });
                        } else {
                          claimMutation.mutate({
                            workspaceId,
                            tripId: tripId ?? "",
                            expenseId: expenseId ?? "",
                            lineItemId: item.id,
                          });
                        }
                      }}
                      disabled={
                        claimMutation.isPending || unclaimMutation.isPending
                      }
                      className={`rounded-md px-4 py-2 ${
                        claimed ? "bg-green-500" : "bg-primary"
                      }`}
                      style={{ minHeight: 44, minWidth: 80, justifyContent: "center", alignItems: "center" }}
                    >
                      <Text className="text-center font-medium text-white">
                        {claimed ? "Claimed" : "Claim"}
                      </Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* Share summary */}
        {shares && shares.shares.length > 0 && (
          <View className="border-border bg-card mb-8 rounded-lg border p-4">
            <Text className="text-foreground mb-3 text-lg font-semibold">
              Share Summary
            </Text>
            {shares.shares.map(
              (share: { userId: string; totalCents: number }) => (
                <View
                  key={share.userId}
                  className="mb-2 flex-row items-center justify-between"
                >
                  <Text className="text-foreground text-sm">
                    {share.userId === currentUserId
                      ? "You"
                      : share.userId.slice(0, 8) + "..."}
                  </Text>
                  <Text className="text-foreground font-mono text-sm font-medium">
                    {formatCurrency(share.totalCents, expense.currency)}
                  </Text>
                </View>
              ),
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
