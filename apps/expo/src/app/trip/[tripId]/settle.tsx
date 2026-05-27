import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import { trpc } from "~/utils/api";
import { C, mono, R } from "~/utils/design";
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
  "use no memo";
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
      <View
        style={{
          flex: 1,
          backgroundColor: C.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Stack.Screen
          options={{
            title: "Settle Up",
            headerStyle: { backgroundColor: C.bg },
            headerTintColor: C.fg,
          }}
        />
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!data) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: C.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Stack.Screen
          options={{
            title: "Settle Up",
            headerStyle: { backgroundColor: C.bg },
            headerTintColor: C.fg,
          }}
        />
        <Text style={{ color: C.muted }}>Could not load settlement data.</Text>
      </View>
    );
  }

  const memberName = (userId: string) => {
    const member = data.members.find((m) => m.userId === userId);
    return member?.displayName ?? truncateId(userId);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: "Settle Up",
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.fg,
        }}
      />
      <ScrollView style={{ flex: 1, paddingHorizontal: 16, paddingTop: 16 }}>
        {data.allSettled ? (
          <View style={{ alignItems: "center", paddingVertical: 48 }}>
            <Text
              style={{
                color: C.fg,
                fontSize: 20,
                fontWeight: "bold",
                marginBottom: 8,
              }}
            >
              All settled!
            </Text>
            <Text style={{ color: C.muted, textAlign: "center" }}>
              Everyone is even. No payments needed.
            </Text>
          </View>
        ) : (
          <>
            {/* Balances */}
            <View style={{ marginBottom: 24 }}>
              <Text
                style={{
                  color: C.fg,
                  fontSize: 18,
                  fontWeight: "600",
                  marginBottom: 12,
                }}
              >
                Balances
              </Text>
              {data.balances.map((b) => (
                <View
                  key={b.userId}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    borderWidth: 1,
                    borderColor: C.border,
                    borderRadius: R.md,
                    padding: 12,
                    marginBottom: 8,
                  }}
                >
                  <Text style={{ color: C.fg }}>{memberName(b.userId)}</Text>
                  <Text
                    style={{
                      color: b.amountCents >= 0 ? C.success : C.critical,
                      fontWeight: "500",
                      fontFamily: mono,
                    }}
                  >
                    {b.amountCents >= 0 ? "+" : ""}
                    {formatCurrency(b.amountCents)}
                  </Text>
                </View>
              ))}
            </View>

            {/* Suggested transactions */}
            {data.suggestedTransactions.length > 0 && (
              <View style={{ marginBottom: 24 }}>
                <Text
                  style={{
                    color: C.fg,
                    fontSize: 18,
                    fontWeight: "600",
                    marginBottom: 12,
                  }}
                >
                  Suggested Payments
                </Text>
                {data.suggestedTransactions.map((tx, i) => (
                  <View
                    key={`${tx.fromUserId}-${tx.toUserId}-${i}`}
                    style={{
                      borderWidth: 1,
                      borderColor: C.border,
                      backgroundColor: C.surface,
                      borderRadius: R.md,
                      padding: 16,
                      marginBottom: 8,
                    }}
                  >
                    <Text style={{ color: C.fg, fontSize: 15 }}>
                      <Text style={{ fontWeight: "600" }}>
                        {memberName(tx.fromUserId)}
                      </Text>
                      {" pays "}
                      <Text style={{ fontWeight: "600" }}>
                        {memberName(tx.toUserId)}
                      </Text>
                    </Text>
                    <Text
                      style={{
                        color: C.info,
                        fontSize: 18,
                        fontWeight: "bold",
                        marginTop: 4,
                        fontFamily: mono,
                      }}
                    >
                      {formatCurrency(tx.amountCents)}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}
