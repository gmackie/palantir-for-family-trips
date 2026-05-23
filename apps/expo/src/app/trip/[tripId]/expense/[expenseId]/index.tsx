import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

const C = {
  bg: "#141116",
  fg: "#f9f7fb",
  muted: "#8c8691",
  card: "#1e1b24",
  border: "#2f2a33",
  primary: "#d66daa",
  primaryFg: "#141116",
  green: "#3FB950",
  greenBg: "rgba(63,185,80,0.2)",
  yellowBg: "rgba(234,179,8,0.2)",
  yellow: "#eab308",
  accent: "#58A6FF",
  chipBg: "#30363D",
  chipText: "#C9D1D9",
  modalBg: "#161B22",
} as const;

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
  "use no memo";
  const { tripId, expenseId } = useLocalSearchParams<{
    tripId: string;
    expenseId: string;
  }>();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const workspaceId = getActiveWorkspaceId() ?? "";
  const currentUserId = session?.user?.id;

  const [assigningItemId, setAssigningItemId] = useState<string | null>(null);

  const { data, isLoading } = useQuery(
    trpc.expenses.get.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
      expenseId: expenseId ?? "",
    }),
  );

  const { data: members } = useQuery(
    trpc.trips.listMembers.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
    }),
  );

  const invalidate = () => {
    void queryClient.invalidateQueries(trpc.expenses.get.queryFilter());
  };

  const claimMutation = useMutation(
    trpc.expenses.claimLineItem.mutationOptions({ onSuccess: invalidate }),
  );

  const unclaimMutation = useMutation(
    trpc.expenses.unclaimLineItem.mutationOptions({ onSuccess: invalidate }),
  );

  const finalizeMutation = useMutation(
    trpc.expenses.finalize.mutationOptions({
      onSuccess: () => {
        invalidate();
        void queryClient.invalidateQueries(trpc.expenses.list.queryFilter());
      },
      onError: (err) => Alert.alert("Error", err.message),
    }),
  );

  const assignMutation = useMutation(
    trpc.expenses.assignLineItem.mutationOptions({
      onSuccess: () => {
        invalidate();
        setAssigningItemId(null);
      },
      onError: (err) => Alert.alert("Error", err.message),
    }),
  );

  const memberName = (userId: string) => {
    const member = members?.find((m) => m.userId === userId);
    return member?.displayName ?? userId.slice(0, 8) + "...";
  };

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
            title: "Expense",
            headerStyle: { backgroundColor: C.bg },
            headerTintColor: C.fg,
          }}
        />
        <ActivityIndicator size="large" color={C.accent} />
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
            title: "Expense",
            headerStyle: { backgroundColor: C.bg },
            headerTintColor: C.fg,
          }}
        />
        <Text style={{ color: C.muted }}>Expense not found</Text>
      </View>
    );
  }

  const { expense, lineItems, shares } = data;
  const isClaimed = (lineItemId: string) =>
    lineItems
      .find((li) => li.id === lineItemId)
      ?.claimantUserIds.includes(currentUserId ?? "");

  const isFinalized = expense.status === "finalized";
  const isOrganizer =
    members?.find((m) => m.userId === currentUserId)?.role === "organizer";

  const mono = Platform.OS === "ios" ? "Menlo" : "monospace";

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: expense.merchant,
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.fg,
        }}
      />
      <ScrollView style={{ flex: 1, paddingHorizontal: 16, paddingTop: 16 }}>
        {/* Header card */}
        <View
          style={{
            borderWidth: 1,
            borderColor: C.border,
            backgroundColor: C.card,
            borderRadius: 8,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <Text
              style={{
                color: C.fg,
                fontSize: 20,
                fontWeight: "bold",
                flex: 1,
              }}
            >
              {expense.merchant}
            </Text>
            <View
              style={{
                backgroundColor: isFinalized ? C.greenBg : C.yellowBg,
                borderRadius: 4,
                paddingHorizontal: 8,
                paddingVertical: 2,
              }}
            >
              <Text
                style={{
                  color: isFinalized ? C.green : C.yellow,
                  fontSize: 12,
                  fontWeight: "600",
                  textTransform: "uppercase",
                }}
              >
                {expense.status}
              </Text>
            </View>
          </View>

          <Text
            style={{
              color: C.muted,
              fontSize: 14,
              textTransform: "capitalize",
              marginBottom: 4,
            }}
          >
            {expense.category}
          </Text>
          <Text style={{ color: C.muted, fontSize: 12, marginBottom: 12 }}>
            {formatDate(expense.occurredAt)}
          </Text>

          {/* Amounts grid */}
          <View
            style={{ flexDirection: "row", justifyContent: "space-between" }}
          >
            <View>
              <Text style={{ color: C.muted, fontSize: 12 }}>Subtotal</Text>
              <Text style={{ color: C.fg, fontFamily: mono }}>
                {formatCurrency(expense.subtotalCents, expense.currency)}
              </Text>
            </View>
            <View>
              <Text style={{ color: C.muted, fontSize: 12 }}>Tax</Text>
              <Text style={{ color: C.fg, fontFamily: mono }}>
                {formatCurrency(expense.taxCents, expense.currency)}
              </Text>
            </View>
            <View>
              <Text style={{ color: C.muted, fontSize: 12 }}>Tip</Text>
              <Text style={{ color: C.fg, fontFamily: mono }}>
                {formatCurrency(expense.tipCents, expense.currency)}
              </Text>
            </View>
            <View>
              <Text style={{ color: C.muted, fontSize: 12 }}>Total</Text>
              <Text
                style={{ color: C.fg, fontFamily: mono, fontWeight: "bold" }}
              >
                {formatCurrency(expense.totalCents, expense.currency)}
              </Text>
            </View>
          </View>

          <Text style={{ color: C.muted, fontSize: 12, marginTop: 12 }}>
            Paid by{" "}
            <Text style={{ color: C.fg, fontWeight: "500" }}>
              {expense.payerUserId === currentUserId
                ? "you"
                : memberName(expense.payerUserId)}
            </Text>
          </Text>
        </View>

        {/* Finalize button for drafts */}
        {!isFinalized && (
          <Pressable
            onPress={() => {
              Alert.alert(
                "Finalize Expense",
                "This locks the totals and opens the expense for claiming. Continue?",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Finalize",
                    onPress: () =>
                      finalizeMutation.mutate({
                        workspaceId,
                        tripId: tripId ?? "",
                        expenseId: expenseId ?? "",
                      }),
                  },
                ],
              );
            }}
            disabled={finalizeMutation.isPending}
            style={{
              backgroundColor: C.green,
              opacity: finalizeMutation.isPending ? 0.6 : 1,
              borderRadius: 6,
              alignItems: "center",
              paddingHorizontal: 16,
              paddingVertical: 12,
              minHeight: 48,
              marginBottom: 16,
            }}
          >
            {finalizeMutation.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: "#fff", fontWeight: "600" }}>
                Finalize for Claiming
              </Text>
            )}
          </Pressable>
        )}

        {/* Line items */}
        {lineItems.length > 0 && (
          <View style={{ marginBottom: 16 }}>
            <Text
              style={{
                color: C.muted,
                fontSize: 12,
                fontWeight: "600",
                textTransform: "uppercase",
                letterSpacing: 1,
                marginBottom: 8,
              }}
            >
              Line Items
            </Text>
            {lineItems.map((item) => {
              const claimed = isClaimed(item.id);
              const claimCount = item.claimantUserIds.length;
              return (
                <View
                  key={item.id}
                  style={{
                    borderWidth: 1,
                    borderColor: C.border,
                    backgroundColor: C.card,
                    borderRadius: 8,
                    padding: 12,
                    marginBottom: 8,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        style={{
                          color: C.fg,
                          fontSize: 16,
                          fontWeight: "500",
                        }}
                      >
                        {item.name}
                      </Text>
                      <Text
                        style={{ color: C.muted, fontSize: 12, marginTop: 2 }}
                      >
                        {Number(item.quantity) > 1
                          ? `${item.quantity} x ${formatCurrency(item.unitPriceCents, expense.currency)} = `
                          : ""}
                        {formatCurrency(item.lineTotalCents, expense.currency)}
                      </Text>
                    </View>

                    {isFinalized && (
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
                        style={{
                          marginLeft: 12,
                          borderRadius: 6,
                          paddingHorizontal: 16,
                          paddingVertical: 8,
                          minHeight: 44,
                          minWidth: 80,
                          justifyContent: "center",
                          alignItems: "center",
                          backgroundColor: claimed ? C.green : C.chipBg,
                        }}
                      >
                        <Text
                          style={{
                            color: "#fff",
                            fontSize: 14,
                            fontWeight: "500",
                            textAlign: "center",
                          }}
                        >
                          {claimed ? "Claimed" : "Claim"}
                        </Text>
                      </Pressable>
                    )}
                  </View>

                  {claimCount > 0 && (
                    <View
                      style={{
                        marginTop: 8,
                        flexDirection: "row",
                        flexWrap: "wrap",
                        gap: 4,
                      }}
                    >
                      {item.claimantUserIds.map((uid) => (
                        <View
                          key={uid}
                          style={{
                            backgroundColor: C.chipBg,
                            borderRadius: 4,
                            paddingHorizontal: 8,
                            paddingVertical: 2,
                          }}
                        >
                          <Text style={{ color: C.chipText, fontSize: 12 }}>
                            {uid === currentUserId ? "You" : memberName(uid)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {isFinalized && isOrganizer && (
                    <Pressable
                      onPress={() => setAssigningItemId(item.id)}
                      style={{ marginTop: 8 }}
                    >
                      <Text style={{ color: C.accent, fontSize: 12 }}>
                        Assign to members...
                      </Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {lineItems.length === 0 && (
          <View
            style={{
              borderWidth: 1,
              borderColor: C.border,
              backgroundColor: C.card,
              borderRadius: 8,
              padding: 24,
              alignItems: "center",
              marginBottom: 16,
            }}
          >
            <Text style={{ color: C.muted, fontSize: 14 }}>
              No line items — expense will be split equally among all members.
            </Text>
          </View>
        )}

        {/* Share summary */}
        {shares && shares.shares.length > 0 && (
          <View
            style={{
              borderWidth: 1,
              borderColor: C.border,
              backgroundColor: C.card,
              borderRadius: 8,
              padding: 16,
              marginBottom: 32,
            }}
          >
            <Text
              style={{
                color: C.muted,
                fontSize: 12,
                fontWeight: "600",
                textTransform: "uppercase",
                letterSpacing: 1,
                marginBottom: 12,
              }}
            >
              Who Owes What
            </Text>
            {shares.shares.map(
              (share: { userId: string; totalCents: number }) => (
                <View
                  key={share.userId}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}
                >
                  <Text style={{ color: C.fg, fontSize: 14 }}>
                    {share.userId === currentUserId
                      ? "You"
                      : memberName(share.userId)}
                  </Text>
                  <Text
                    style={{
                      color: C.fg,
                      fontFamily: mono,
                      fontSize: 14,
                      fontWeight: "500",
                    }}
                  >
                    {formatCurrency(share.totalCents, expense.currency)}
                  </Text>
                </View>
              ),
            )}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Member assignment modal */}
      <MemberAssignModal
        key={assigningItemId ?? "closed"}
        visible={!!assigningItemId}
        members={members ?? []}
        currentClaimants={
          lineItems.find((li) => li.id === assigningItemId)?.claimantUserIds ??
          []
        }
        currentUserId={currentUserId ?? ""}
        onAssign={(userIds) => {
          if (!assigningItemId) return;
          assignMutation.mutate({
            workspaceId,
            tripId: tripId ?? "",
            expenseId: expenseId ?? "",
            lineItemId: assigningItemId,
            userIds,
          });
        }}
        onClose={() => setAssigningItemId(null)}
        isPending={assignMutation.isPending}
      />
    </View>
  );
}

function MemberAssignModal({
  visible,
  members,
  currentClaimants,
  currentUserId,
  onAssign,
  onClose,
  isPending,
}: {
  visible: boolean;
  members: Array<{
    userId: string;
    displayName: string | null;
    role: string;
    colorHex: string | null;
  }>;
  currentClaimants: string[];
  currentUserId: string;
  onAssign: (userIds: string[]) => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(currentClaimants),
  );

  const toggle = (userId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(members.map((m) => m.userId)));
  };

  const selectNone = () => {
    setSelected(new Set());
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View
        style={{
          flex: 1,
          justifyContent: "flex-end",
          backgroundColor: "rgba(0,0,0,0.6)",
        }}
      >
        <View
          style={{
            backgroundColor: C.modalBg,
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            paddingHorizontal: 16,
            paddingBottom: 40,
            paddingTop: 20,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 16,
            }}
          >
            <Text style={{ color: C.fg, fontSize: 18, fontWeight: "600" }}>
              Assign to Members
            </Text>
            <Pressable onPress={onClose}>
              <Text style={{ color: C.muted, fontSize: 16 }}>Cancel</Text>
            </Pressable>
          </View>

          <View style={{ flexDirection: "row", gap: 12, marginBottom: 12 }}>
            <Pressable onPress={selectAll}>
              <Text style={{ color: C.accent, fontSize: 12 }}>Select All</Text>
            </Pressable>
            <Pressable onPress={selectNone}>
              <Text style={{ color: C.accent, fontSize: 12 }}>Select None</Text>
            </Pressable>
          </View>

          <ScrollView style={{ maxHeight: 300 }}>
            {members.map((member) => {
              const isSelected = selected.has(member.userId);
              return (
                <Pressable
                  key={member.userId}
                  onPress={() => toggle(member.userId)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    borderBottomWidth: 1,
                    borderColor: C.chipBg,
                    paddingHorizontal: 8,
                    paddingVertical: 12,
                  }}
                >
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 4,
                      marginRight: 12,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: isSelected ? C.accent : C.chipBg,
                    }}
                  >
                    {isSelected && (
                      <Text
                        style={{
                          color: "#fff",
                          fontSize: 12,
                          fontWeight: "bold",
                        }}
                      >
                        ✓
                      </Text>
                    )}
                  </View>
                  <Text style={{ color: C.fg, fontSize: 16, flex: 1 }}>
                    {member.userId === currentUserId
                      ? "You"
                      : (member.displayName ?? member.userId.slice(0, 12))}
                  </Text>
                  {member.role === "organizer" && (
                    <Text style={{ color: C.muted, fontSize: 12 }}>
                      organizer
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable
            onPress={() => onAssign(Array.from(selected))}
            disabled={isPending}
            style={{
              backgroundColor: C.primary,
              borderRadius: 6,
              alignItems: "center",
              paddingVertical: 12,
              marginTop: 16,
              minHeight: 48,
              opacity: isPending ? 0.6 : 1,
            }}
          >
            {isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: C.primaryFg, fontWeight: "600" }}>
                Assign ({selected.size} member
                {selected.size !== 1 ? "s" : ""})
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
