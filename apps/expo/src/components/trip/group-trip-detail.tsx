import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import { trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";
import { C as DC, mono, R } from "~/utils/design";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

const C = {
  bg: DC.bg,
  fg: DC.fg,
  muted: DC.muted,
  primary: DC.info,
  primaryFg: DC.white,
  card: DC.surface,
  border: DC.border,
  accent: DC.info,
} as const;

const STATUS_COLORS: Record<string, string> = {
  planning: DC.warning,
  confirmed: DC.info,
  active: DC.success,
  completed: C.muted,
};

function formatDate(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
    new Date(value),
  );
}

function formatCurrency(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function getDaysUntil(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  const now = new Date();
  const diff = Math.ceil(
    (target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diff < 0) return null;
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return `${diff}d`;
}

interface Trip {
  id: string;
  name: string;
  status: string;
  destinationName: string | null;
  startDate: string | null;
  endDate: string | null;
}

const TABS = [
  {
    key: "expenses",
    label: "Expenses",
    icon: "receipt-outline" as const,
    path: "expenses",
  },
  {
    key: "settle",
    label: "Settle Up",
    icon: "swap-horizontal-outline" as const,
    path: "settle",
  },
  {
    key: "lodging",
    label: "Lodging",
    icon: "bed-outline" as const,
    path: "lodging",
  },
  {
    key: "segments",
    label: "Segments",
    icon: "git-branch-outline" as const,
    path: "segments",
  },
  {
    key: "itinerary",
    label: "Itinerary",
    icon: "calendar-outline" as const,
    path: "itinerary",
  },
  {
    key: "members",
    label: "Members",
    icon: "people-outline" as const,
    path: "members",
  },
  {
    key: "chat",
    label: "Chat",
    icon: "chatbubbles-outline" as const,
    path: "chat",
  },
  {
    key: "plan",
    label: "Plan",
    icon: "clipboard-outline" as const,
    path: "polls",
  },
  {
    key: "photos",
    label: "Photos",
    icon: "images-outline" as const,
    path: "photos",
  },
  {
    key: "stats",
    label: "Stats",
    icon: "bar-chart-outline" as const,
    path: "stats",
  },
  { key: "map", label: "Map", icon: "map-outline" as const, path: "map" },
] as const;

const QUICK_ACTIONS = [
  {
    key: "expense",
    label: "Add Expense",
    icon: "receipt-outline" as const,
    path: "new-expense",
    color: DC.info,
  },
  {
    key: "poll",
    label: "New Poll",
    icon: "bar-chart-outline" as const,
    path: "polls",
    color: "#D2A8FF",
  },
  {
    key: "event",
    label: "Add Event",
    icon: "calendar-outline" as const,
    path: "itinerary",
    color: "#F97316",
  },
  {
    key: "invite",
    label: "Invite",
    icon: "person-add-outline" as const,
    path: "members",
    color: "#56D364",
  },
] as const;

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        borderWidth: 1,
        borderColor: C.border,
        backgroundColor: C.card,
        borderRadius: R.md,
        padding: 12,
        gap: 4,
      }}
    >
      <Ionicons name={icon} size={16} color={color} />
      <Text
        style={{
          color: C.fg,
          fontSize: 18,
          fontWeight: "700",
          fontFamily: mono,
        }}
      >
        {value}
      </Text>
      <Text
        style={{
          color: C.muted,
          fontSize: 10,
          fontWeight: "600",
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export function GroupTripDetail({
  trip,
  tripId,
}: {
  trip: Trip;
  tripId: string;
}) {
  "use no memo";
  const router = useRouter();
  const workspaceId = getActiveWorkspaceId() ?? "";
  const session = authClient.useSession();
  const userId = session.data?.user?.id;

  const { data: expenses } = useQuery({
    ...trpc.expenses.list.queryOptions({
      workspaceId,
      tripId,
    }),
    retry: false,
  });

  const { data: segments } = useQuery({
    ...trpc.trips.listSegments.queryOptions({
      workspaceId,
      tripId,
    }),
    retry: false,
  });

  const { data: members } = useQuery({
    ...trpc.trips.listMembers.queryOptions({
      workspaceId,
      tripId,
    }),
    retry: false,
  });

  const totalCents = expenses?.reduce((sum, e) => sum + e.totalCents, 0) ?? 0;
  const expenseCount = expenses?.length ?? 0;
  const memberCount = members?.length ?? 0;
  const segmentCount = segments?.length ?? 0;
  const daysUntil = getDaysUntil(trip.startDate);

  const myMember = members?.find((m) => m.userId === userId);
  const needsProfile = myMember && !myMember.displayName;

  return (
    <ScrollView style={{ flex: 1, paddingHorizontal: 16, paddingTop: 16 }}>
      {/* Profile setup prompt */}
      {needsProfile && (
        <Pressable
          onPress={() =>
            router.push({
              pathname: "/trip/[tripId]/profile" as any,
              params: { tripId },
            })
          }
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            backgroundColor: `${DC.info}15`,
            borderWidth: 1,
            borderColor: DC.info,
            borderRadius: R.md,
            padding: 14,
            marginBottom: 16,
          }}
        >
          <Ionicons name="person-circle-outline" size={24} color={DC.info} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.fg, fontSize: 14, fontWeight: "600" }}>
              Set up your profile
            </Text>
            <Text style={{ color: C.muted, fontSize: 12 }}>
              Add your name and Venmo so others can find and pay you
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={DC.info} />
        </Pressable>
      )}

      {/* Hero card */}
      <View
        style={{
          backgroundColor: C.card,
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: R.md,
          padding: 20,
          marginBottom: 16,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text
              style={{ color: C.fg, fontSize: 24, fontWeight: "bold" }}
              numberOfLines={2}
            >
              {trip.name}
            </Text>
            {trip.destinationName && (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  marginTop: 4,
                }}
              >
                <Ionicons name="location-outline" size={14} color={C.muted} />
                <Text style={{ color: C.muted, fontSize: 14 }}>
                  {trip.destinationName}
                </Text>
              </View>
            )}
          </View>
          <View
            style={{
              backgroundColor: STATUS_COLORS[trip.status] ?? C.muted,
              borderRadius: R.sm,
              paddingHorizontal: 10,
              paddingVertical: 4,
            }}
          >
            <Text
              style={{
                color: DC.white,
                fontSize: 11,
                fontWeight: "700",
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              {trip.status}
            </Text>
          </View>
        </View>

        {(trip.startDate || trip.endDate) && (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              marginBottom: 12,
            }}
          >
            <Ionicons name="calendar-outline" size={14} color={C.muted} />
            <Text style={{ color: C.muted, fontSize: 14 }}>
              {formatDate(trip.startDate)}
              {trip.startDate && trip.endDate ? " – " : ""}
              {formatDate(trip.endDate)}
            </Text>
          </View>
        )}

        {/* Countdown banner */}
        {daysUntil && (
          <View
            style={{
              backgroundColor: `${DC.info}15`,
              borderRadius: R.sm,
              paddingVertical: 8,
              paddingHorizontal: 12,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Ionicons name="time-outline" size={16} color={DC.info} />
            <Text style={{ color: DC.info, fontSize: 14, fontWeight: "600" }}>
              {daysUntil === "Today"
                ? "Trip starts today!"
                : daysUntil === "Tomorrow"
                  ? "Trip starts tomorrow!"
                  : `${daysUntil} until departure`}
            </Text>
          </View>
        )}
      </View>

      {/* Stats row */}
      <View
        style={{
          flexDirection: "row",
          gap: 8,
          marginBottom: 16,
        }}
      >
        <StatCard
          label="Spent"
          value={totalCents > 0 ? formatCurrency(totalCents) : "$0"}
          icon="wallet-outline"
          color={DC.info}
        />
        <StatCard
          label="Members"
          value={String(memberCount)}
          icon="people-outline"
          color="#56D364"
        />
        <StatCard
          label={segmentCount > 0 ? "Segments" : "Expenses"}
          value={String(segmentCount > 0 ? segmentCount : expenseCount)}
          icon={segmentCount > 0 ? "navigate-outline" : "receipt-outline"}
          color="#D2A8FF"
        />
      </View>

      {/* Quick actions */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginBottom: 20, marginHorizontal: -4 }}
      >
        {QUICK_ACTIONS.map((action) => (
          <Pressable
            key={action.key}
            onPress={() =>
              router.push({
                pathname: `/trip/[tripId]/${action.path}` as any,
                params: { tripId },
              })
            }
            style={{
              marginHorizontal: 4,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              backgroundColor: `${action.color}15`,
              borderWidth: 1,
              borderColor: `${action.color}33`,
              borderRadius: R.md,
              paddingHorizontal: 14,
              paddingVertical: 10,
              minHeight: 44,
            }}
          >
            <Ionicons name={action.icon} size={16} color={action.color} />
            <Text
              style={{
                color: action.color,
                fontSize: 13,
                fontWeight: "600",
              }}
            >
              {action.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Tab grid */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {TABS.map((tab) => (
          <Pressable
            key={tab.key}
            onPress={() =>
              router.push({
                pathname: `/trip/[tripId]/${tab.path}` as any,
                params: { tripId },
              })
            }
            style={{
              width: "47%",
              backgroundColor: C.card,
              borderRadius: R.md,
              borderWidth: 1,
              borderColor: C.border,
              paddingVertical: 18,
              paddingHorizontal: 14,
              alignItems: "center",
              gap: 6,
            }}
          >
            <Ionicons name={tab.icon} size={22} color={C.muted} />
            <Text style={{ color: C.fg, fontSize: 14, fontWeight: "600" }}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}
