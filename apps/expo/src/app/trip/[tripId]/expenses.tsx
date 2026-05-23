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

const C = {
  bg: "#141116",
  fg: "#f9f7fb",
  muted: "#8c8691",
  card: "#1e1b24",
  border: "#2f2a33",
  primary: "#d66daa",
  primaryFg: "#141116",
} as const;

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
  draft: { bg: "#fef9c3", text: "#854d0e" },
  finalized: { bg: "#dcfce7", text: "#166534" },
};

export default function ExpenseList() {
  "use no memo";
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
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen options={{ title: "Expenses" }} />

      {isLoading ? (
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <ActivityIndicator size="large" />
        </View>
      ) : !expenses || expenses.length === 0 ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 24,
          }}
        >
          <Text style={{ color: C.muted, fontSize: 18, marginBottom: 8 }}>
            No expenses yet
          </Text>
          <Text style={{ color: C.muted, fontSize: 14, textAlign: "center" }}>
            Add your first expense to start tracking costs.
          </Text>
        </View>
      ) : (
        <FlatList
          data={expenses}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          renderItem={({ item }) => {
            const badge = STATUS_BADGE[item.status] ?? {
              bg: "#fef9c3",
              text: "#854d0e",
            };
            return (
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: "/trip/[tripId]/expense/[expenseId]",
                    params: { tripId: tripId ?? "", expenseId: item.id },
                  })
                }
                style={{
                  borderWidth: 1,
                  borderColor: C.border,
                  backgroundColor: C.card,
                  borderRadius: 8,
                  padding: 16,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 4,
                  }}
                >
                  <Text
                    style={{ color: C.fg, fontSize: 16, fontWeight: "600" }}
                  >
                    {item.merchant}
                  </Text>
                  <Text
                    style={{
                      color: C.fg,
                      fontSize: 16,
                      fontWeight: "500",
                      fontFamily: "Menlo",
                    }}
                  >
                    {formatCurrency(item.totalCents, item.currency)}
                  </Text>
                </View>
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                >
                  <View
                    style={{
                      backgroundColor: badge.bg,
                      borderRadius: 999,
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                    }}
                  >
                    <Text
                      style={{
                        color: badge.text,
                        fontSize: 12,
                        fontWeight: "500",
                        textTransform: "capitalize",
                      }}
                    >
                      {item.status}
                    </Text>
                  </View>
                  <Text style={{ color: C.muted, fontSize: 12 }}>
                    {formatDate(item.occurredAt)}
                  </Text>
                  <Text
                    style={{
                      color: C.muted,
                      fontSize: 12,
                      textTransform: "capitalize",
                    }}
                  >
                    {item.category}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <View
        style={{
          position: "absolute",
          bottom: 32,
          left: 0,
          right: 0,
          alignItems: "center",
        }}
      >
        <Pressable
          onPress={() =>
            router.push({
              pathname: "/trip/[tripId]/new-expense" as any,
              params: { tripId: tripId ?? "" },
            })
          }
          style={{
            backgroundColor: C.primary,
            borderRadius: 999,
            paddingHorizontal: 24,
            paddingVertical: 16,
            minHeight: 48,
          }}
        >
          <Text style={{ color: C.primaryFg, fontWeight: "600" }}>
            + New Expense
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
