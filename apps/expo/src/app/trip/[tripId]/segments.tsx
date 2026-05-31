import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { trpc } from "~/utils/api";
import { C, mono, R } from "~/utils/design";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

const SEGMENT_COLORS = [
  C.info,
  "#79C0FF",
  "#56D364",
  "#D2A8FF",
  "#7EE787",
  "#A5D6FF",
];

function formatDate(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function formatDateRange(start: string | null, end: string | null): string {
  if (!start && !end) return "";
  if (start && end) {
    const s = new Date(start);
    const e = new Date(end);
    if (s.toDateString() === e.toDateString()) return formatDate(start);
    return `${formatDate(start)} – ${formatDate(end)}`;
  }
  return formatDate(start ?? end);
}

function SegmentMemberRow({
  segmentId,
  tripId,
  workspaceId,
}: {
  segmentId: string;
  tripId: string;
  workspaceId: string;
}) {
  const queryClient = useQueryClient();
  const [showAddMember, setShowAddMember] = useState(false);

  const { data: segmentMembers } = useQuery(
    trpc.trips.listSegmentMembers.queryOptions({
      workspaceId,
      tripId,
      segmentId,
    }),
  );

  const { data: tripMembers } = useQuery(
    trpc.trips.listMembers.queryOptions({ workspaceId, tripId }),
  );

  const addMutation = useMutation(
    trpc.trips.addToSegment.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(
          trpc.trips.listSegmentMembers.queryFilter(),
        );
        void queryClient.invalidateQueries(
          trpc.trips.listSegments.queryFilter(),
        );
      },
    }),
  );

  const memberCount = segmentMembers?.length ?? 0;
  const segmentUserIds = new Set(segmentMembers?.map((m) => m.userId) ?? []);
  const nonMembers =
    tripMembers?.filter((m) => !segmentUserIds.has(m.userId)) ?? [];

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {segmentMembers && segmentMembers.length > 0 && (
          <View style={{ flexDirection: "row", marginRight: 4 }}>
            {segmentMembers.slice(0, 6).map((m, i) => (
              <View
                key={m.userId}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  backgroundColor: `${m.colorHex ?? C.info}22`,
                  borderWidth: 2,
                  borderColor: m.colorHex ?? C.info,
                  alignItems: "center",
                  justifyContent: "center",
                  marginLeft: i > 0 ? -8 : 0,
                }}
              >
                <Text
                  style={{
                    color: m.colorHex ?? C.info,
                    fontSize: 9,
                    fontWeight: "700",
                    fontFamily: mono,
                  }}
                >
                  {(m.displayName ?? "?")
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((w) => w[0]?.toUpperCase() ?? "")
                    .join("")}
                </Text>
              </View>
            ))}
            {memberCount > 6 && (
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  backgroundColor: C.border,
                  alignItems: "center",
                  justifyContent: "center",
                  marginLeft: -8,
                }}
              >
                <Text
                  style={{ color: C.muted, fontSize: 9, fontWeight: "700" }}
                >
                  +{memberCount - 6}
                </Text>
              </View>
            )}
          </View>
        )}
        <Text style={{ color: C.muted, fontSize: 12 }}>
          {memberCount} {memberCount === 1 ? "person" : "people"}
        </Text>
        <View style={{ flex: 1 }} />
        {nonMembers.length > 0 && (
          <Pressable
            onPress={() => setShowAddMember(!showAddMember)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: R.sm,
              borderWidth: 1,
              borderColor: C.border,
              minHeight: 36,
            }}
          >
            <Ionicons name="person-add-outline" size={14} color={C.muted} />
            <Text style={{ color: C.muted, fontSize: 12, fontWeight: "500" }}>
              Add
            </Text>
          </Pressable>
        )}
      </View>

      {showAddMember && (
        <View style={{ gap: 6 }}>
          {nonMembers.map((m) => (
            <Pressable
              key={m.userId}
              onPress={() =>
                addMutation.mutate({
                  workspaceId,
                  tripId,
                  segmentId,
                  userId: m.userId,
                })
              }
              disabled={addMutation.isPending}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingVertical: 8,
                paddingHorizontal: 10,
                borderRadius: R.sm,
                backgroundColor: C.bg,
              }}
            >
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  backgroundColor: `${m.colorHex ?? C.info}22`,
                  borderWidth: 1,
                  borderColor: m.colorHex ?? C.info,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text
                  style={{
                    color: m.colorHex ?? C.info,
                    fontSize: 8,
                    fontWeight: "700",
                  }}
                >
                  {(m.displayName ?? "?").slice(0, 2).toUpperCase()}
                </Text>
              </View>
              <Text style={{ color: C.fg, fontSize: 14, flex: 1 }}>
                {m.displayName ?? m.userId.slice(0, 8)}
              </Text>
              <Ionicons name="add-circle" size={18} color={C.info} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function CreateSegmentModal({
  visible,
  onClose,
  onSubmit,
  isPending,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    destinationName?: string;
    startDate?: string;
    endDate?: string;
  }) => void;
  isPending: boolean;
}) {
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const reset = () => {
    setName("");
    setDestination("");
    setStartDate("");
    setEndDate("");
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            padding: 16,
            borderBottomWidth: 1,
            borderBottomColor: C.border,
          }}
        >
          <Pressable
            onPress={() => {
              reset();
              onClose();
            }}
            style={{ minWidth: 60 }}
          >
            <Text style={{ color: C.muted, fontSize: 16 }}>Cancel</Text>
          </Pressable>
          <Text style={{ color: C.fg, fontSize: 17, fontWeight: "600" }}>
            New Segment
          </Text>
          <View style={{ minWidth: 60 }} />
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1 }}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 16, gap: 16 }}
            keyboardShouldPersistTaps="handled"
          >
            <View>
              <Text style={labelStyle}>Segment Name</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Des Moines Overnight"
                placeholderTextColor={C.placeholder}
                style={inputStyle}
                autoFocus
              />
            </View>

            <View>
              <Text style={labelStyle}>Destination (optional)</Text>
              <TextInput
                value={destination}
                onChangeText={setDestination}
                placeholder="Des Moines, IA"
                placeholderTextColor={C.placeholder}
                style={inputStyle}
              />
            </View>

            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={labelStyle}>Start Date</Text>
                <TextInput
                  value={startDate}
                  onChangeText={setStartDate}
                  placeholder="2026-06-10"
                  placeholderTextColor={C.placeholder}
                  keyboardType="numbers-and-punctuation"
                  style={{ ...inputStyle, fontFamily: mono }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={labelStyle}>End Date</Text>
                <TextInput
                  value={endDate}
                  onChangeText={setEndDate}
                  placeholder="2026-06-10"
                  placeholderTextColor={C.placeholder}
                  keyboardType="numbers-and-punctuation"
                  style={{ ...inputStyle, fontFamily: mono }}
                />
              </View>
            </View>

            <Text style={{ color: C.muted, fontSize: 12 }}>
              You&apos;ll be added automatically. Other trip members can join
              from the segments screen.
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>

        <View
          style={{
            padding: 16,
            paddingBottom: 36,
            borderTopWidth: 1,
            borderTopColor: C.border,
          }}
        >
          <Pressable
            onPress={() => {
              onSubmit({
                name: name.trim(),
                destinationName: destination.trim() || undefined,
                startDate: startDate.trim() || undefined,
                endDate: endDate.trim() || undefined,
              });
              reset();
            }}
            disabled={!name.trim() || isPending}
            style={{
              backgroundColor: C.info,
              borderRadius: R.md,
              paddingVertical: 16,
              alignItems: "center",
              opacity: !name.trim() || isPending ? 0.5 : 1,
            }}
          >
            {isPending ? (
              <ActivityIndicator color={C.white} />
            ) : (
              <Text style={{ color: C.white, fontSize: 16, fontWeight: "600" }}>
                Create Segment
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const labelStyle = {
  color: C.muted,
  fontSize: 11,
  fontWeight: "600" as const,
  textTransform: "uppercase" as const,
  letterSpacing: 1,
  marginBottom: 6,
};

const inputStyle = {
  borderWidth: 1,
  borderColor: C.border,
  backgroundColor: C.surface,
  borderRadius: R.md,
  padding: 14,
  color: C.fg,
  fontSize: 16,
};

export default function SegmentsScreen() {
  "use no memo";
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const workspaceId = getActiveWorkspaceId() ?? "";
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data: segments, isLoading } = useQuery(
    trpc.trips.listSegments.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
    }),
  );

  const createMutation = useMutation(
    trpc.trips.createSegment.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(
          trpc.trips.listSegments.queryFilter(),
        );
        setShowCreate(false);
      },
      onError: (err) => Alert.alert("Error", err.message),
    }),
  );

  const handleCreate = useCallback(
    (data: {
      name: string;
      destinationName?: string;
      startDate?: string;
      endDate?: string;
    }) => {
      createMutation.mutate({
        workspaceId,
        tripId: tripId ?? "",
        ...data,
      });
    },
    [workspaceId, tripId, createMutation],
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: "Segments",
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.fg,
        }}
      />

      {isLoading ? (
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <ActivityIndicator size="large" color={C.muted} />
        </View>
      ) : !segments || segments.length === 0 ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 32,
            gap: 8,
          }}
        >
          <Ionicons name="git-branch-outline" size={36} color={C.muted} />
          <Text style={{ color: C.muted, fontSize: 16 }}>No segments yet</Text>
          <Text
            style={{
              color: C.muted,
              fontSize: 13,
              textAlign: "center",
              maxWidth: 260,
            }}
          >
            Segments are parts of your trip that different people can opt into —
            like a side trip or travel day.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        >
          {segments.map((item, index) => {
            const color = SEGMENT_COLORS[index % SEGMENT_COLORS.length]!;
            const dateRange = formatDateRange(item.startDate, item.endDate);

            return (
              <View key={item.id}>
                {index > 0 && (
                  <View style={{ alignItems: "center", height: 24 }}>
                    <View
                      style={{
                        width: 2,
                        height: 24,
                        backgroundColor: C.border,
                      }}
                    />
                  </View>
                )}
                <View
                  style={{
                    borderWidth: 1,
                    borderColor: C.border,
                    backgroundColor: C.surface,
                    borderRadius: R.md,
                    overflow: "hidden",
                  }}
                >
                  <View style={{ height: 3, backgroundColor: color }} />
                  <View style={{ padding: 16, gap: 10 }}>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <View
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 14,
                          backgroundColor: `${color}22`,
                          borderWidth: 2,
                          borderColor: color,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Text
                          style={{
                            color,
                            fontSize: 12,
                            fontWeight: "800",
                            fontFamily: mono,
                          }}
                        >
                          {index + 1}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            color: C.fg,
                            fontSize: 17,
                            fontWeight: "700",
                          }}
                        >
                          {item.name}
                        </Text>
                        {item.destinationName && (
                          <Text style={{ color: C.muted, fontSize: 13 }}>
                            {item.destinationName}
                          </Text>
                        )}
                      </View>
                    </View>

                    {dateRange ? (
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <Ionicons
                          name="calendar-outline"
                          size={13}
                          color={C.muted}
                        />
                        <Text
                          style={{
                            color: C.info,
                            fontSize: 13,
                            fontFamily: mono,
                          }}
                        >
                          {dateRange}
                        </Text>
                      </View>
                    ) : null}

                    {item.distanceMiles && (
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <Ionicons
                          name="navigate-outline"
                          size={13}
                          color={C.muted}
                        />
                        <Text
                          style={{
                            color: C.muted,
                            fontSize: 12,
                            fontFamily: mono,
                          }}
                        >
                          {item.distanceMiles} mi
                          {item.durationMinutes
                            ? ` · ${Math.round(item.durationMinutes / 60)}h ${item.durationMinutes % 60}m`
                            : ""}
                        </Text>
                      </View>
                    )}

                    <SegmentMemberRow
                      segmentId={item.id}
                      tripId={tripId ?? ""}
                      workspaceId={workspaceId}
                    />
                  </View>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* FAB */}
      <Pressable
        onPress={() => setShowCreate(true)}
        style={{
          position: "absolute",
          bottom: 36,
          right: 20,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: C.info,
          alignItems: "center",
          justifyContent: "center",
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 8,
          elevation: 8,
        }}
      >
        <Ionicons name="add" size={28} color={C.white} />
      </Pressable>

      <CreateSegmentModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={handleCreate}
        isPending={createMutation.isPending}
      />
    </View>
  );
}
