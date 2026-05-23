import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

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
  accent: "#58A6FF",
  success: "#22c55e",
  warning: "#eab308",
} as const;

const ROLE_BADGE: Record<string, { bg: string; text: string }> = {
  organizer: { bg: "#d66daa33", text: "#d66daa" },
  member: { bg: "#2f2a33", text: "#8c8691" },
};

const MEMBER_COLORS = [
  "#d66daa",
  "#58A6FF",
  "#22c55e",
  "#eab308",
  "#f97316",
  "#a78bfa",
  "#34d399",
  "#fb7185",
  "#60a5fa",
  "#fbbf24",
];

function getInitials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function MemberRow({
  member,
  index,
}: {
  member: {
    userId: string;
    displayName: string | null;
    role: string;
    colorHex: string | null;
  };
  index: number;
}) {
  const color = member.colorHex ?? MEMBER_COLORS[index % MEMBER_COLORS.length]!;
  const badge = ROLE_BADGE[member.role] ?? ROLE_BADGE.member!;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        padding: 16,
        backgroundColor: C.card,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: C.border,
        gap: 12,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: `${color}22`,
          borderWidth: 2,
          borderColor: color,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text
          style={{
            color: color,
            fontSize: 14,
            fontWeight: "700",
            fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
          }}
        >
          {getInitials(member.displayName)}
        </Text>
      </View>

      <View style={{ flex: 1 }}>
        <Text style={{ color: C.fg, fontSize: 16, fontWeight: "600" }}>
          {member.displayName ?? "Unnamed"}
        </Text>
        <Text
          style={{
            color: C.muted,
            fontSize: 12,
            fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
          }}
        >
          {member.userId.slice(0, 8)}
        </Text>
      </View>

      <View
        style={{
          backgroundColor: badge.bg,
          borderRadius: 999,
          paddingHorizontal: 8,
          paddingVertical: 3,
        }}
      >
        <Text
          style={{
            color: badge.text,
            fontSize: 11,
            fontWeight: "600",
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          {member.role}
        </Text>
      </View>
    </View>
  );
}

function InviteRow({
  invite,
}: {
  invite: {
    id: string;
    email: string;
    acceptedAt: Date | null;
    expiresAt: Date;
  };
}) {
  const isAccepted = !!invite.acceptedAt;
  const isExpired = !isAccepted && new Date(invite.expiresAt) < new Date();

  const statusColor = isAccepted ? C.success : isExpired ? C.muted : C.warning;
  const statusLabel = isAccepted ? "JOINED" : isExpired ? "EXPIRED" : "PENDING";

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        padding: 12,
        paddingLeft: 16,
        backgroundColor: C.card,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: C.border,
        borderStyle: "dashed",
        gap: 12,
        opacity: isExpired ? 0.5 : 1,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: `${statusColor}15`,
          borderWidth: 1,
          borderColor: `${statusColor}44`,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 16 }}>
          {isAccepted ? "✓" : isExpired ? "✕" : "✉"}
        </Text>
      </View>

      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: C.fg,
            fontSize: 14,
            fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
          }}
        >
          {invite.email}
        </Text>
      </View>

      <View
        style={{
          backgroundColor: `${statusColor}22`,
          borderRadius: 999,
          paddingHorizontal: 6,
          paddingVertical: 2,
        }}
      >
        <Text
          style={{
            color: statusColor,
            fontSize: 10,
            fontWeight: "700",
            letterSpacing: 0.5,
          }}
        >
          {statusLabel}
        </Text>
      </View>
    </View>
  );
}

export default function MembersScreen() {
  "use no memo";
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const workspaceId = getActiveWorkspaceId() ?? "";
  const queryClient = useQueryClient();

  const [inviteEmail, setInviteEmail] = useState("");
  const [showInviteField, setShowInviteField] = useState(false);

  const {
    data: members,
    isLoading: membersLoading,
    error: membersError,
  } = useQuery({
    ...trpc.trips.listMembers.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
    }),
    retry: false,
  });

  const { data: invites } = useQuery({
    ...trpc.trips.listInvites.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
    }),
    retry: false,
  });

  const sendInvite = useMutation(
    trpc.trips.createInvite.mutationOptions({
      onSuccess: (data) => {
        setInviteEmail("");
        setShowInviteField(false);
        void queryClient.invalidateQueries({
          queryKey: trpc.trips.listInvites.queryKey({
            workspaceId,
            tripId: tripId ?? "",
          }),
        });
        Alert.alert("Invite sent", `Invitation sent to ${data.email}`);
      },
      onError: (err) => {
        Alert.alert("Error", err.message);
      },
    }),
  );

  const isLoading = membersLoading && !membersError;
  const memberCount = members?.length ?? 0;
  const pendingCount =
    invites?.filter((i) => !i.acceptedAt && new Date(i.expiresAt) >= new Date())
      .length ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: "Members",
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.fg,
        }}
      />

      {isLoading ? (
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <ActivityIndicator size="large" />
        </View>
      ) : membersError ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 24,
          }}
        >
          <Text style={{ color: C.muted, fontSize: 16, marginBottom: 8 }}>
            Could not load members
          </Text>
          <Text
            style={{
              color: C.muted,
              fontSize: 13,
              textAlign: "center",
              fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
            }}
          >
            {membersError.message}
          </Text>
        </View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1 }}
        >
          <FlatList
            data={[
              ...(members ?? []).map((m) => ({
                type: "member" as const,
                ...m,
              })),
              ...(invites ?? [])
                .filter((i) => !i.acceptedAt)
                .map((i) => ({ type: "invite" as const, ...i })),
            ]}
            keyExtractor={(item) =>
              item.type === "member" ? `m-${item.userId}` : `i-${item.id}`
            }
            contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
            ListHeaderComponent={
              <View style={{ marginBottom: 16 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "baseline",
                    gap: 8,
                    marginBottom: 4,
                  }}
                >
                  <Text
                    style={{
                      color: C.fg,
                      fontSize: 32,
                      fontWeight: "800",
                      fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                    }}
                  >
                    {memberCount}
                  </Text>
                  <Text style={{ color: C.muted, fontSize: 14 }}>
                    {memberCount === 1 ? "member" : "members"}
                    {pendingCount > 0 && ` · ${pendingCount} pending`}
                  </Text>
                </View>
              </View>
            }
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            renderItem={({ item, index }) => {
              if (item.type === "member") {
                return <MemberRow member={item} index={index} />;
              }
              return <InviteRow invite={item} />;
            }}
            ListEmptyComponent={
              <View
                style={{
                  alignItems: "center",
                  justifyContent: "center",
                  paddingVertical: 40,
                }}
              >
                <Text style={{ color: C.muted, fontSize: 16 }}>
                  No members yet
                </Text>
              </View>
            }
          />
        </KeyboardAvoidingView>
      )}

      {showInviteField ? (
        <View
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: C.card,
            borderTopWidth: 1,
            borderTopColor: C.border,
            padding: 16,
            paddingBottom: 36,
            gap: 12,
          }}
        >
          <Text
            style={{
              color: C.muted,
              fontSize: 11,
              fontWeight: "600",
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            Invite by email
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              value={inviteEmail}
              onChangeText={setInviteEmail}
              placeholder="name@example.com"
              placeholderTextColor="#555"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              style={{
                flex: 1,
                backgroundColor: C.bg,
                borderWidth: 1,
                borderColor: C.border,
                borderRadius: 8,
                padding: 12,
                color: C.fg,
                fontSize: 15,
                fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
              }}
            />
            <Pressable
              onPress={() => {
                if (inviteEmail.trim()) {
                  sendInvite.mutate({
                    workspaceId,
                    tripId: tripId ?? "",
                    email: inviteEmail.trim(),
                  });
                }
              }}
              disabled={sendInvite.isPending || !inviteEmail.trim()}
              style={{
                backgroundColor: C.primary,
                borderRadius: 8,
                paddingHorizontal: 16,
                alignItems: "center",
                justifyContent: "center",
                opacity: sendInvite.isPending || !inviteEmail.trim() ? 0.5 : 1,
              }}
            >
              {sendInvite.isPending ? (
                <ActivityIndicator color={C.primaryFg} size="small" />
              ) : (
                <Text
                  style={{
                    color: C.primaryFg,
                    fontWeight: "700",
                    fontSize: 14,
                  }}
                >
                  Send
                </Text>
              )}
            </Pressable>
          </View>
          <Pressable
            onPress={() => {
              setShowInviteField(false);
              setInviteEmail("");
            }}
          >
            <Text
              style={{
                color: C.muted,
                fontSize: 13,
                textAlign: "center",
              }}
            >
              Cancel
            </Text>
          </Pressable>
        </View>
      ) : (
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
            onPress={() => setShowInviteField(true)}
            style={{
              backgroundColor: C.primary,
              borderRadius: 999,
              paddingHorizontal: 24,
              paddingVertical: 16,
              minHeight: 48,
            }}
          >
            <Text style={{ color: C.primaryFg, fontWeight: "600" }}>
              + Invite Member
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
