import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
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
      <SafeAreaView className="bg-background flex-1">
        <Stack.Screen options={{ title: "Expense" }} />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#58A6FF" />
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

  const isFinalized = expense.status === "finalized";
  const isOrganizer =
    members?.find((m) => m.userId === currentUserId)?.role === "organizer";

  return (
    <SafeAreaView className="bg-background flex-1">
      <Stack.Screen
        options={{
          title: expense.merchant,
          headerStyle: { backgroundColor: "#0A0C10" },
          headerTintColor: "#C9D1D9",
        }}
      />
      <ScrollView className="flex-1 px-4 pt-4">
        {/* Header card */}
        <View className="border-border bg-card mb-4 rounded-lg border p-4">
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-foreground flex-1 text-xl font-bold">
              {expense.merchant}
            </Text>
            <View
              className={`rounded px-2 py-0.5 ${
                isFinalized ? "bg-green-500/20" : "bg-yellow-500/20"
              }`}
            >
              <Text
                className={`text-xs font-semibold uppercase ${
                  isFinalized ? "text-green-400" : "text-yellow-400"
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

          {/* Amounts grid */}
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

          <Text className="text-muted-foreground mt-3 text-xs">
            Paid by{" "}
            <Text className="text-foreground font-medium">
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
            className="mb-4 items-center rounded-md px-4 py-3"
            style={{
              minHeight: 48,
              backgroundColor: "#3FB950",
              opacity: finalizeMutation.isPending ? 0.6 : 1,
            }}
          >
            {finalizeMutation.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="font-semibold text-white">
                Finalize for Claiming
              </Text>
            )}
          </Pressable>
        )}

        {/* Line items */}
        {lineItems.length > 0 && (
          <View className="mb-4">
            <Text className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wider">
              Line Items
            </Text>
            {lineItems.map((item) => {
              const claimed = isClaimed(item.id);
              const claimCount = item.claimantUserIds.length;
              return (
                <View
                  key={item.id}
                  className="border-border bg-card mb-2 rounded-lg border p-3"
                >
                  <View className="flex-row items-center justify-between">
                    <View className="min-w-0 flex-1">
                      <Text className="text-foreground text-base font-medium">
                        {item.name}
                      </Text>
                      <Text className="text-muted-foreground mt-0.5 text-xs">
                        {Number(item.quantity) > 1
                          ? `${item.quantity} × ${formatCurrency(item.unitPriceCents, expense.currency)} = `
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
                        className="ml-3 rounded-md px-4 py-2"
                        style={{
                          minHeight: 44,
                          minWidth: 80,
                          justifyContent: "center",
                          alignItems: "center",
                          backgroundColor: claimed ? "#3FB950" : "#30363D",
                        }}
                      >
                        <Text className="text-center text-sm font-medium text-white">
                          {claimed ? "Claimed" : "Claim"}
                        </Text>
                      </Pressable>
                    )}
                  </View>

                  {/* Show who claimed this item */}
                  {claimCount > 0 && (
                    <View className="mt-2 flex-row flex-wrap gap-1">
                      {item.claimantUserIds.map((uid) => (
                        <View
                          key={uid}
                          className="rounded px-2 py-0.5"
                          style={{ backgroundColor: "#30363D" }}
                        >
                          <Text
                            className="text-xs"
                            style={{ color: "#C9D1D9" }}
                          >
                            {uid === currentUserId ? "You" : memberName(uid)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {isFinalized && isOrganizer && (
                    <Pressable
                      onPress={() => setAssigningItemId(item.id)}
                      className="mt-2"
                    >
                      <Text className="text-xs" style={{ color: "#58A6FF" }}>
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
          <View className="border-border bg-card mb-4 items-center rounded-lg border p-6">
            <Text className="text-muted-foreground text-sm">
              No line items — expense will be split equally among all members.
            </Text>
          </View>
        )}

        {/* Share summary */}
        {shares && shares.shares.length > 0 && (
          <View className="border-border bg-card mb-8 rounded-lg border p-4">
            <Text className="text-muted-foreground mb-3 text-xs font-semibold uppercase tracking-wider">
              Who Owes What
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
                      : memberName(share.userId)}
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
    </SafeAreaView>
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
        className="flex-1 justify-end"
        style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      >
        <View
          className="rounded-t-2xl px-4 pb-10 pt-5"
          style={{ backgroundColor: "#161B22" }}
        >
          <View className="mb-4 flex-row items-center justify-between">
            <Text className="text-foreground text-lg font-semibold">
              Assign to Members
            </Text>
            <Pressable onPress={onClose}>
              <Text style={{ color: "#8B949E", fontSize: 16 }}>Cancel</Text>
            </Pressable>
          </View>

          <View className="mb-3 flex-row gap-3">
            <Pressable onPress={selectAll}>
              <Text className="text-xs" style={{ color: "#58A6FF" }}>
                Select All
              </Text>
            </Pressable>
            <Pressable onPress={selectNone}>
              <Text className="text-xs" style={{ color: "#58A6FF" }}>
                Select None
              </Text>
            </Pressable>
          </View>

          <ScrollView style={{ maxHeight: 300 }}>
            {members.map((member) => {
              const isSelected = selected.has(member.userId);
              return (
                <Pressable
                  key={member.userId}
                  onPress={() => toggle(member.userId)}
                  className="flex-row items-center border-b px-2 py-3"
                  style={{ borderColor: "#30363D" }}
                >
                  <View
                    className="mr-3 h-5 w-5 items-center justify-center rounded"
                    style={{
                      backgroundColor: isSelected ? "#58A6FF" : "#30363D",
                    }}
                  >
                    {isSelected && (
                      <Text className="text-xs font-bold text-white">✓</Text>
                    )}
                  </View>
                  <Text className="text-foreground flex-1 text-base">
                    {member.userId === currentUserId
                      ? "You"
                      : (member.displayName ?? member.userId.slice(0, 12))}
                  </Text>
                  {member.role === "organizer" && (
                    <Text className="text-muted-foreground text-xs">
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
            className="bg-primary mt-4 items-center rounded-md py-3"
            style={{ minHeight: 48, opacity: isPending ? 0.6 : 1 }}
          >
            {isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-primary-foreground font-semibold">
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
