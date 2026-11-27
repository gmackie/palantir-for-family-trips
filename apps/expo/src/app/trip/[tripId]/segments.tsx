import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
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
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import type { RouterOutputs } from "~/utils/api";
import {
  showsSegmentColumns,
  selectedTripSegment,
} from "~/utils/segment-layout";
import { trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";
import { formatCalendarDate } from "~/utils/calendar-date";
import { C, mono, R } from "~/utils/design";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

function formatDate(value: string | null) {
  return formatCalendarDate(value, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatDateRange(start: string | null, end: string | null): string {
  if (!start && !end) return "";
  if (start && end) {
    if (start === end) return formatDate(start);
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

  // Self-service join/leave. `addToSegment` is the ORGANIZER action; these are
  // how a member puts themselves on a leg, and they had no caller — you could
  // see who was on a segment and not join it yourself.
  const session = authClient.useSession();
  const currentUserId = session.data?.user?.id;
  const invalidateMembership = () => {
    void queryClient.invalidateQueries(
      trpc.trips.listSegmentMembers.queryFilter(),
    );
    void queryClient.invalidateQueries(trpc.trips.listSegments.queryFilter());
  };
  const joinMutation = useMutation(
    trpc.trips.joinSegment.mutationOptions({ onSuccess: invalidateMembership }),
  );
  const leaveMutation = useMutation(
    trpc.trips.leaveSegment.mutationOptions({
      onSuccess: invalidateMembership,
    }),
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
        {currentUserId != null && (
          <Pressable
            disabled={joinMutation.isPending || leaveMutation.isPending}
            onPress={() => {
              const scope = { workspaceId, tripId, segmentId };
              if (segmentUserIds.has(currentUserId)) {
                leaveMutation.mutate(scope);
              } else {
                joinMutation.mutate(scope);
              }
            }}
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
            <Ionicons
              name={
                segmentUserIds.has(currentUserId)
                  ? "exit-outline"
                  : "enter-outline"
              }
              size={14}
              color={C.muted}
            />
            <Text style={{ color: C.muted, fontSize: 12, fontWeight: "500" }}>
              {segmentUserIds.has(currentUserId) ? "Leave" : "Join"}
            </Text>
          </Pressable>
        )}
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

type TripLeg = RouterOutputs["trips"]["listSegments"][number];

function SegmentDetails({
  leg,
  tripId,
  workspaceId,
}: {
  leg: TripLeg;
  tripId: string;
  workspaceId: string;
}) {
  const bookings = useQuery(
    trpc.lodging.listForSegment.queryOptions({
      workspaceId,
      tripId,
      segmentId: leg.id,
    }),
  );
  const dates = formatDateRange(leg.startDate, leg.endDate);

  return (
    <View style={legStyles.card}>
      <Text accessibilityRole="header" style={legStyles.heading}>
        {leg.name}
      </Text>
      {dates ? <Text style={legStyles.body}>{dates}</Text> : null}
      {leg.originName ? (
        <Text style={legStyles.body}>From {leg.originName}</Text>
      ) : null}
      {leg.destinationName ? (
        <Text style={legStyles.body}>Meet at {leg.destinationName}</Text>
      ) : null}
      {leg.distanceMiles != null ? (
        <Text style={legStyles.body}>
          {leg.distanceMiles} mi
          {leg.durationMinutes != null ? ` · ${leg.durationMinutes} min` : ""}
        </Text>
      ) : null}
      {leg.destinationLat != null && leg.destinationLng != null ? (
        <Text selectable style={legStyles.body}>
          {leg.destinationLat}, {leg.destinationLng}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        style={legStyles.button}
        onPress={() =>
          router.push({
            pathname: "/trip/[tripId]/map",
            params: { tripId, segmentId: leg.id },
          })
        }
      >
        <Text style={legStyles.link}>Open segment map</Text>
      </Pressable>
      <Text accessibilityRole="header" style={legStyles.section}>
        Reservations
      </Text>
      {bookings.isLoading ? (
        <ActivityIndicator
          accessibilityLabel="Loading reservations"
          color={C.info}
        />
      ) : null}
      {bookings.isError ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void bookings.refetch()}
          style={legStyles.button}
        >
          <Text style={legStyles.link}>Could not load reservations. Retry</Text>
        </Pressable>
      ) : null}
      {bookings.data?.length === 0 ? (
        <Text style={legStyles.body}>No reservations for this segment.</Text>
      ) : null}
      {bookings.data?.map((stay) => (
        <View key={stay.id} style={{ gap: 4 }}>
          <Text style={legStyles.section}>{stay.propertyName}</Text>
          {stay.address ? (
            <Text selectable style={legStyles.body}>
              {stay.address}
            </Text>
          ) : null}
          {stay.notes ? <Text style={legStyles.body}>{stay.notes}</Text> : null}
        </View>
      ))}
      <Text accessibilityRole="header" style={legStyles.section}>
        Travelers
      </Text>
      <SegmentMemberRow
        segmentId={leg.id}
        tripId={tripId}
        workspaceId={workspaceId}
      />
    </View>
  );
}

export default function SegmentsScreen() {
  "use no memo";
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const workspaceId = getActiveWorkspaceId() ?? "";
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [showStops, setShowStops] = useState(false);
  const [width, setWidth] = useState(0);
  const { fontScale } = useWindowDimensions();
  const expanded = showsSegmentColumns(width, fontScale);

  const { data: segments, isLoading } = useQuery(
    trpc.trips.listSegments.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
    }),
  );

  const today = new Date();
  const localDay = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  const selected = selectedTripSegment(segments ?? [], chosenId, localDay);

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
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{ flex: 1, backgroundColor: C.bg }}
    >
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
        <View style={legStyles.workspace}>
          {!expanded && (
            <Pressable
              accessibilityRole="button"
              style={legStyles.button}
              onPress={() => setShowStops(!showStops)}
            >
              <Text style={legStyles.link}>
                {showStops ? "Return to selected segment" : "Choose a segment"}
              </Text>
            </Pressable>
          )}
          <View style={[legStyles.workspace, expanded && legStyles.columns]}>
            <ScrollView
              style={[
                legStyles.pane,
                !expanded && !showStops && legStyles.hidden,
              ]}
              contentContainerStyle={legStyles.content}
            >
              <Text accessibilityRole="header" style={legStyles.heading}>
                Trip segments
              </Text>
              {segments.map((leg, index) => (
                <Pressable
                  key={leg.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: selected?.id === leg.id }}
                  style={[
                    legStyles.card,
                    selected?.id === leg.id && legStyles.chosen,
                  ]}
                  onPress={() => {
                    setChosenId(leg.id);
                    setShowStops(false);
                  }}
                >
                  <Text style={legStyles.section}>
                    {index + 1}. {leg.name}
                  </Text>
                  {leg.destinationName ? (
                    <Text style={legStyles.body}>{leg.destinationName}</Text>
                  ) : null}
                  {leg.startDate || leg.endDate ? (
                    <Text style={legStyles.body}>
                      {formatDateRange(leg.startDate, leg.endDate)}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
            <ScrollView
              style={[
                legStyles.pane,
                !expanded && showStops && legStyles.hidden,
              ]}
              contentContainerStyle={legStyles.content}
            >
              {selected && (
                <SegmentDetails
                  key={selected.id}
                  leg={selected}
                  tripId={tripId ?? ""}
                  workspaceId={workspaceId}
                />
              )}
            </ScrollView>
          </View>
        </View>
      )}

      {/* FAB */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add segment"
        onPress={() => setShowCreate(true)}
        style={{
          position: "absolute",
          bottom: 36,
          right: 20,
          width: 52,
          height: 52,
          borderRadius: R.md,
          backgroundColor: C.info,
          alignItems: "center",
          justifyContent: "center",
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.18,
          shadowRadius: 2,
          elevation: 2,
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

const legStyles = StyleSheet.create({
  workspace: { flex: 1 },
  columns: { flexDirection: "row" },
  pane: { flex: 1, minWidth: 0 },
  hidden: { display: "none" },
  content: { padding: 12, paddingBottom: 100, gap: 10 },
  card: {
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.md,
    backgroundColor: C.surface,
  },
  chosen: { borderColor: C.info, borderWidth: 2 },
  heading: { color: C.fg, fontSize: 22, fontWeight: "700" },
  section: { color: C.fg, fontSize: 17, fontWeight: "600" },
  body: { color: C.muted, fontSize: 15 },
  button: { minHeight: 44, paddingHorizontal: 14, justifyContent: "center" },
  link: { color: C.info, fontSize: 16, fontWeight: "600" },
});
