import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

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

function openVenmo(handle: string, amountDollars: number, note: string) {
  const url = `venmo://paycharge?txn=pay&recipients=${encodeURIComponent(handle)}&amount=${amountDollars.toFixed(2)}&note=${encodeURIComponent(note)}`;
  void Linking.openURL(url).catch(() => {
    void Linking.openURL(
      `https://venmo.com/${handle}?txn=pay&amount=${amountDollars.toFixed(2)}&note=${encodeURIComponent(note)}`,
    ).catch(() => Alert.alert("Could not open Venmo"));
  });
}

function PaymentButtons({
  toHandle,
  amountCents,
  note,
}: {
  toHandle: string | null;
  amountCents: number;
  note: string;
}) {
  const dollars = amountCents / 100;

  return (
    <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
      {toHandle && (
        <Pressable
          onPress={() => openVenmo(toHandle, dollars, note)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            backgroundColor: "#008CFF",
            borderRadius: R.md,
            paddingHorizontal: 14,
            paddingVertical: 10,
            minHeight: 44,
          }}
        >
          <Text style={{ color: C.white, fontSize: 14, fontWeight: "600" }}>
            Venmo
          </Text>
        </Pressable>
      )}
      <Pressable
        onPress={() => {
          const msg = `${note}: $${dollars.toFixed(2)}`;
          void Linking.openURL(`sms:&body=${encodeURIComponent(msg)}`);
        }}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: R.md,
          paddingHorizontal: 14,
          paddingVertical: 10,
          minHeight: 44,
        }}
      >
        <Ionicons name="chatbubble-outline" size={14} color={C.fg} />
        <Text style={{ color: C.fg, fontSize: 14, fontWeight: "500" }}>
          Text
        </Text>
      </Pressable>
    </View>
  );
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
        <ActivityIndicator size="large" color={C.muted} />
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

  const memberVenmo = (userId: string) => {
    const member = data.members.find((m) => m.userId === userId);
    return member?.venmoHandle ?? null;
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
          <View style={{ alignItems: "center", paddingVertical: 48, gap: 12 }}>
            <Ionicons name="checkmark-circle" size={48} color={C.success} />
            <Text style={{ color: C.fg, fontSize: 20, fontWeight: "bold" }}>
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
                  color: C.muted,
                  fontSize: 11,
                  fontWeight: "600",
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  marginBottom: 10,
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
                    backgroundColor: C.surface,
                    borderRadius: R.md,
                    padding: 14,
                    marginBottom: 8,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <Ionicons
                      name={
                        b.amountCents > 0
                          ? "arrow-up-circle"
                          : b.amountCents < 0
                            ? "arrow-down-circle"
                            : "checkmark-circle"
                      }
                      size={20}
                      color={
                        b.amountCents > 0
                          ? C.success
                          : b.amountCents < 0
                            ? C.critical
                            : C.muted
                      }
                    />
                    <Text style={{ color: C.fg, fontSize: 15 }}>
                      {memberName(b.userId)}
                    </Text>
                  </View>
                  <Text
                    style={{
                      color: b.amountCents >= 0 ? C.success : C.critical,
                      fontWeight: "600",
                      fontFamily: mono,
                      fontSize: 15,
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
                    color: C.muted,
                    fontSize: 11,
                    fontWeight: "600",
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    marginBottom: 10,
                  }}
                >
                  Payments
                </Text>
                {data.suggestedTransactions.map((tx, i) => {
                  const toVenmo = memberVenmo(tx.toUserId);
                  const fromName = memberName(tx.fromUserId);
                  const toName = memberName(tx.toUserId);
                  const note = `Sortey trip settlement: ${fromName} → ${toName}`;

                  return (
                    <View
                      key={`${tx.fromUserId}-${tx.toUserId}-${i}`}
                      style={{
                        borderWidth: 1,
                        borderColor: C.border,
                        backgroundColor: C.surface,
                        borderRadius: R.md,
                        padding: 16,
                        marginBottom: 10,
                      }}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <Ionicons
                          name="arrow-forward-circle"
                          size={20}
                          color={C.info}
                        />
                        <Text style={{ color: C.fg, fontSize: 15, flex: 1 }}>
                          <Text style={{ fontWeight: "600" }}>{fromName}</Text>
                          {" pays "}
                          <Text style={{ fontWeight: "600" }}>{toName}</Text>
                        </Text>
                      </View>
                      <Text
                        style={{
                          color: C.fg,
                          fontSize: 22,
                          fontWeight: "bold",
                          marginTop: 6,
                          fontFamily: mono,
                        }}
                      >
                        {formatCurrency(tx.amountCents)}
                      </Text>
                      {toVenmo && (
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 4,
                            marginTop: 4,
                          }}
                        >
                          <Text style={{ color: C.muted, fontSize: 12 }}>
                            @{toVenmo}
                          </Text>
                        </View>
                      )}
                      <PaymentButtons
                        toHandle={toVenmo}
                        amountCents={tx.amountCents}
                        note={note}
                      />
                    </View>
                  );
                })}
              </View>
            )}
          </>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}
