import { Ionicons } from "@expo/vector-icons";
import { formatMoney as formatCurrency } from "@sortey/validators/money";
import { TONE_HEX, trackingStatusTone } from "@sortey/validators/status";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { RoomBoard } from "~/components/trip/room-board";
import { trpc } from "~/utils/api";
import { C, mono, PALETTE, R } from "~/utils/design";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

const PROVIDER_ICONS: Record<
  string,
  React.ComponentProps<typeof Ionicons>["name"]
> = {
  airbnb: "home-outline",
  vrbo: "home-outline",
  hotel: "business-outline",
  hostel: "bed-outline",
  other: "bed-outline",
};

const TRANSIT_ICONS: Record<
  string,
  React.ComponentProps<typeof Ionicons>["name"]
> = {
  flight: "airplane-outline",
  train: "train-outline",
  bus: "bus-outline",
  car: "car-outline",
  other: "navigate-outline",
};

const TRANSPORT_ICONS: Record<
  string,
  React.ComponentProps<typeof Ionicons>["name"]
> = {
  rental_car: "car-outline",
  taxi: "car-sport-outline",
  rideshare: "car-sport-outline",
  shuttle: "bus-outline",
  public_transit: "train-outline",
};

function formatTime(value: Date | string | null) {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function formatDate(value: Date | string | null) {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
}

function formatDateRange(
  start: Date | string | null,
  end: Date | string | null,
): string {
  if (!start && !end) return "";
  if (start && end) return `${formatDate(start)} – ${formatDate(end)}`;
  return formatDate(start ?? end);
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "baseline",
        gap: 8,
        marginBottom: 10,
        marginTop: 20,
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
        {title}
      </Text>
      {count != null && (
        <Text style={{ color: C.muted, fontSize: 11, fontFamily: mono }}>
          {count}
        </Text>
      )}
    </View>
  );
}

function LodgingCard({
  item,
  workspaceId,
  tripId,
  members,
}: {
  item: {
    id: string;
    provider: string | null;
    propertyName: string;
    address: string | null;
    checkInAt: Date;
    checkOutAt: Date;
    confirmationNumber: string | null;
    totalCostCents: number | null;
    currency: string;
    notes: string | null;
    guestCount: number;
  };
  workspaceId: string;
  tripId: string;
  members: Array<{
    userId: string;
    displayName: string | null;
    colorHex: string | null;
  }>;
}) {
  const icon = PROVIDER_ICONS[item.provider ?? "other"] ?? "bed-outline";

  return (
    <View
      style={{
        backgroundColor: C.surface,
        borderRadius: R.md,
        borderWidth: 1,
        borderColor: C.border,
        padding: 14,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: C.infoBg,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name={icon} size={18} color={C.info} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.fg, fontSize: 16, fontWeight: "700" }}>
            {item.propertyName}
          </Text>
          {item.provider && (
            <Text
              style={{
                color: C.muted,
                fontSize: 12,
                textTransform: "capitalize",
              }}
            >
              {item.provider}
            </Text>
          )}
        </View>
        {item.totalCostCents != null && item.totalCostCents > 0 && (
          <Text
            style={{
              color: C.fg,
              fontSize: 15,
              fontWeight: "700",
              fontFamily: mono,
            }}
          >
            {formatCurrency(item.totalCostCents, item.currency)}
          </Text>
        )}
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <Ionicons name="calendar-outline" size={13} color={C.muted} />
        <Text style={{ color: C.info, fontSize: 13, fontFamily: mono }}>
          {formatDateRange(item.checkInAt, item.checkOutAt)}
        </Text>
      </View>

      {item.address && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Ionicons name="location-outline" size={13} color={C.muted} />
          <Text style={{ color: C.muted, fontSize: 13 }} numberOfLines={1}>
            {item.address}
          </Text>
        </View>
      )}

      <View style={{ flexDirection: "row", gap: 12 }}>
        {item.confirmationNumber && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text
              style={{
                color: C.muted,
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              Conf
            </Text>
            <Text style={{ color: C.fg, fontSize: 12, fontFamily: mono }}>
              {item.confirmationNumber}
            </Text>
          </View>
        )}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Ionicons name="people-outline" size={12} color={C.muted} />
          <Text style={{ color: C.muted, fontSize: 12, fontFamily: mono }}>
            {item.guestCount}
          </Text>
        </View>
      </View>

      {item.notes && (
        <Text
          style={{ color: C.muted, fontSize: 13, fontStyle: "italic" }}
          numberOfLines={2}
        >
          {item.notes}
        </Text>
      )}

      {members.length > 0 && (
        <RoomBoard
          workspaceId={workspaceId}
          tripId={tripId}
          lodgingId={item.id}
          members={members}
        />
      )}
    </View>
  );
}

function TransitRow({
  item,
  workspaceId,
  tripId,
  onRefreshed,
}: {
  item: {
    id: string;
    userId: string;
    direction: string | null;
    transitType: string | null;
    carrier: string | null;
    transitNumber: string | null;
    departureStation: string | null;
    arrivalStation: string | null;
    scheduledAt: Date;
    trackingStatus: string;
    notes: string | null;
  };
  workspaceId: string;
  tripId: string;
  onRefreshed: () => void;
}) {
  const icon = TRANSIT_ICONS[item.transitType ?? "other"] ?? "navigate-outline";
  const statusColor = TONE_HEX[trackingStatusTone(item.trackingStatus)];
  const directionLabel =
    item.direction === "arrival"
      ? "ARR"
      : item.direction === "departure"
        ? "DEP"
        : "";
  const canRefresh =
    item.transitType === "flight" && Boolean(item.transitNumber);

  const refresh = useMutation(
    trpc.lodging.refreshTransitStatus.mutationOptions({
      onSuccess: (res) => {
        if (res.refreshed) {
          onRefreshed();
          Alert.alert("Updated", "Flight status updated");
        } else {
          Alert.alert("No update", "No live status available yet");
        }
      },
      onError: (err) => Alert.alert("Couldn't refresh flight status", err.message),
    }),
  );

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: C.surface,
        borderRadius: R.md,
        borderWidth: 1,
        borderColor: C.border,
        padding: 12,
        gap: 10,
      }}
    >
      <Ionicons name={icon} size={18} color={C.muted} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {directionLabel ? (
            <View
              style={{
                backgroundColor: `${statusColor}22`,
                borderRadius: R.sm,
                paddingHorizontal: 5,
                paddingVertical: 1,
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
                {directionLabel}
              </Text>
            </View>
          ) : null}
          <Text style={{ color: C.fg, fontSize: 14, fontWeight: "600" }}>
            {[item.carrier, item.transitNumber].filter(Boolean).join(" ") ||
              item.transitType ||
              "Transit"}
          </Text>
        </View>
        {(item.departureStation || item.arrivalStation) && (
          <Text style={{ color: C.muted, fontSize: 12 }} numberOfLines={1}>
            {item.departureStation}
            {item.departureStation && item.arrivalStation ? " → " : ""}
            {item.arrivalStation}
          </Text>
        )}
        {canRefresh && (
          <Pressable
            onPress={() =>
              refresh.mutate({
                workspaceId,
                tripId,
                transitId: item.id,
              })
            }
            disabled={refresh.isPending}
            hitSlop={8}
            style={{ marginTop: 4, alignSelf: "flex-start", minHeight: 32, justifyContent: "center" }}
          >
            <Text
              style={{
                color: C.info,
                fontSize: 12,
                fontWeight: "600",
                opacity: refresh.isPending ? 0.5 : 1,
              }}
            >
              {refresh.isPending ? "Refreshing…" : "Refresh status"}
            </Text>
          </Pressable>
        )}
      </View>
      <Text style={{ color: C.info, fontSize: 13, fontFamily: mono }}>
        {formatTime(item.scheduledAt)}
      </Text>
    </View>
  );
}

function TransportGroupCard({
  group,
  currentUserId,
  onJoin,
  onLeave,
  isPending,
}: {
  group: {
    id: string;
    transportType: string | null;
    label: string;
    fromDescription: string | null;
    toDescription: string | null;
    scheduledAt: Date | null;
    costCents: number | null;
    currency: string;
    notes: string | null;
    members: Array<{ id: string; userId: string }>;
  };
  currentUserId: string;
  onJoin: () => void;
  onLeave: () => void;
  isPending: boolean;
}) {
  const icon =
    TRANSPORT_ICONS[group.transportType ?? "rental_car"] ?? "car-outline";
  const isMember = group.members.some((m) => m.userId === currentUserId);
  const memberCount = group.members.length;

  return (
    <View
      style={{
        backgroundColor: C.surface,
        borderRadius: R.md,
        borderWidth: 1,
        borderColor: isMember ? C.info : C.border,
        padding: 14,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: isMember ? C.infoBg : `${C.muted}22`,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name={icon} size={16} color={isMember ? C.info : C.muted} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.fg, fontSize: 15, fontWeight: "600" }}>
            {group.label}
          </Text>
          {group.transportType && (
            <Text
              style={{
                color: C.muted,
                fontSize: 11,
                textTransform: "capitalize",
              }}
            >
              {group.transportType.replace("_", " ")}
            </Text>
          )}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Ionicons name="people-outline" size={14} color={C.muted} />
          <Text style={{ color: C.muted, fontSize: 13, fontFamily: mono }}>
            {memberCount}
          </Text>
        </View>
      </View>

      {(group.fromDescription || group.toDescription) && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name="navigate-outline" size={12} color={C.muted} />
          <Text style={{ color: C.muted, fontSize: 13 }} numberOfLines={1}>
            {group.fromDescription}
            {group.fromDescription && group.toDescription ? " → " : ""}
            {group.toDescription}
          </Text>
        </View>
      )}

      {group.scheduledAt && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name="time-outline" size={12} color={C.muted} />
          <Text style={{ color: C.info, fontSize: 12, fontFamily: mono }}>
            {formatDate(group.scheduledAt)} {formatTime(group.scheduledAt)}
          </Text>
        </View>
      )}

      {group.costCents != null && group.costCents > 0 && (
        <Text style={{ color: C.fg, fontSize: 13, fontFamily: mono }}>
          {formatCurrency(group.costCents, group.currency)}
          {memberCount > 0 && (
            <Text style={{ color: C.muted }}>
              {" "}
              (
              {formatCurrency(
                Math.round(group.costCents / memberCount),
                group.currency,
              )}
              /person)
            </Text>
          )}
        </Text>
      )}

      <Pressable
        onPress={isMember ? onLeave : onJoin}
        disabled={isPending}
        style={{
          backgroundColor: isMember ? "transparent" : C.info,
          borderWidth: isMember ? 1 : 0,
          borderColor: C.border,
          borderRadius: R.md,
          paddingVertical: 10,
          minHeight: 44,
          alignItems: "center",
          justifyContent: "center",
          opacity: isPending ? 0.5 : 1,
        }}
      >
        <Text
          style={{
            color: isMember ? C.muted : C.white,
            fontSize: 14,
            fontWeight: "600",
          }}
        >
          {isMember ? "Leave Group" : "Join Group"}
        </Text>
      </Pressable>
    </View>
  );
}

function SegmentLodgingSection({
  segment,
  workspaceId,
  tripId,
  index,
  currentUserId,
  members,
}: {
  segment: {
    id: string;
    name: string;
    startDate: string | null;
    endDate: string | null;
  };
  workspaceId: string;
  tripId: string;
  index: number;
  currentUserId: string;
  members: Array<{
    userId: string;
    displayName: string | null;
    colorHex: string | null;
  }>;
}) {
  const queryClient = useQueryClient();
  const color = PALETTE[index % PALETTE.length]!;

  const { data: lodgingList } = useQuery({
    ...trpc.lodging.listForSegment.queryOptions({
      workspaceId,
      tripId,
      segmentId: segment.id,
    }),
    retry: false,
  });

  const { data: transits } = useQuery({
    ...trpc.lodging.listTransitsForSegment.queryOptions({
      workspaceId,
      tripId,
      segmentId: segment.id,
    }),
    retry: false,
  });

  const { data: transportGroups } = useQuery({
    ...trpc.lodging.listTransportGroups.queryOptions({
      workspaceId,
      tripId,
      segmentId: segment.id,
    }),
    retry: false,
  });

  const joinGroup = useMutation(
    trpc.lodging.joinTransportGroup.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.lodging.listTransportGroups.queryKey({
            workspaceId,
            tripId,
            segmentId: segment.id,
          }),
        });
      },
    }),
  );

  const leaveGroup = useMutation(
    trpc.lodging.leaveTransportGroup.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.lodging.listTransportGroups.queryKey({
            workspaceId,
            tripId,
            segmentId: segment.id,
          }),
        });
      },
    }),
  );

  const invalidateTransits = () => {
    void queryClient.invalidateQueries({
      queryKey: trpc.lodging.listTransitsForSegment.queryKey({
        workspaceId,
        tripId,
        segmentId: segment.id,
      }),
    });
  };

  const hasLodging = (lodgingList?.length ?? 0) > 0;
  const hasTransits = (transits?.length ?? 0) > 0;
  const hasTransport = (transportGroups?.length ?? 0) > 0;
  const isEmpty = !hasLodging && !hasTransits && !hasTransport;

  return (
    <View style={{ marginBottom: 24 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          marginBottom: 8,
        }}
      >
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: `${color}22`,
            borderWidth: 2,
            borderColor: color,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text
            style={{ color, fontSize: 11, fontWeight: "800", fontFamily: mono }}
          >
            {index + 1}
          </Text>
        </View>
        <Text style={{ color: C.fg, fontSize: 17, fontWeight: "700", flex: 1 }}>
          {segment.name}
        </Text>
        {segment.startDate && (
          <Text style={{ color: C.muted, fontSize: 12, fontFamily: mono }}>
            {formatDate(segment.startDate)}
          </Text>
        )}
      </View>

      {isEmpty && (
        <View
          style={{
            backgroundColor: C.surface,
            borderRadius: R.md,
            borderWidth: 1,
            borderColor: C.border,
            borderStyle: "dashed",
            padding: 20,
            alignItems: "center",
          }}
        >
          <Text style={{ color: C.muted, fontSize: 14 }}>
            No lodging or transport yet
          </Text>
        </View>
      )}

      {hasLodging && (
        <>
          <SectionHeader title="Lodging" count={lodgingList!.length} />
          <View style={{ gap: 8 }}>
            {lodgingList!.map((item) => (
              <LodgingCard
                key={item.id}
                item={item}
                workspaceId={workspaceId}
                tripId={tripId}
                members={members}
              />
            ))}
          </View>
        </>
      )}

      {hasTransits && (
        <>
          <SectionHeader
            title="Arrivals & Departures"
            count={transits!.length}
          />
          <View style={{ gap: 6 }}>
            {transits!.map((item) => (
              <TransitRow
                key={item.id}
                item={item}
                workspaceId={workspaceId}
                tripId={tripId}
                onRefreshed={invalidateTransits}
              />
            ))}
          </View>
        </>
      )}

      {hasTransport && (
        <>
          <SectionHeader
            title="Ground Transport"
            count={transportGroups!.length}
          />
          <View style={{ gap: 8 }}>
            {transportGroups!.map((group) => (
              <TransportGroupCard
                key={group.id}
                group={group}
                currentUserId={currentUserId}
                onJoin={() =>
                  joinGroup.mutate({
                    workspaceId,
                    tripId,
                    groundTransportGroupId: group.id,
                  })
                }
                onLeave={() =>
                  leaveGroup.mutate({
                    workspaceId,
                    tripId,
                    groundTransportGroupId: group.id,
                  })
                }
                isPending={joinGroup.isPending || leaveGroup.isPending}
              />
            ))}
          </View>
        </>
      )}
    </View>
  );
}

export default function LodgingScreen() {
  "use no memo";
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const workspaceId = getActiveWorkspaceId() ?? "";

  const { data: segments, isLoading } = useQuery(
    trpc.trips.listSegments.queryOptions({ workspaceId, tripId: tripId ?? "" }),
  );

  const { data: members } = useQuery({
    ...trpc.trips.listMembers.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
    }),
    enabled: Boolean(workspaceId && tripId),
    retry: false,
  });

  const { data: session } = useQuery(trpc.auth.getSession.queryOptions());

  const currentUserId = session?.user?.id ?? "";
  const memberRoster = members ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: "Lodging & Transport",
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
      ) : !segments || segments.length === 0 ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 24,
          }}
        >
          <Ionicons
            name="bed-outline"
            size={48}
            color={C.muted}
            style={{ marginBottom: 12 }}
          />
          <Text style={{ color: C.muted, fontSize: 18, marginBottom: 8 }}>
            No segments yet
          </Text>
          <Text style={{ color: C.muted, fontSize: 15, textAlign: "center" }}>
            Add trip segments first, then lodging and transport details will
            appear here.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {segments.map((seg, i) => (
            <SegmentLodgingSection
              key={seg.id}
              segment={seg}
              workspaceId={workspaceId}
              tripId={tripId ?? ""}
              index={i}
              currentUserId={currentUserId}
              members={memberRoster}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}
