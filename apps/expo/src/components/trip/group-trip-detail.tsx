import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import { trpc } from "~/utils/api";
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
    key: "schedule",
    label: "Schedule",
    icon: "calendar-outline" as const,
    path: "segments",
  },
  {
    key: "members",
    label: "Members",
    icon: "people-outline" as const,
    path: "members",
  },
  {
    key: "plan",
    label: "Plan",
    icon: "clipboard-outline" as const,
    path: "polls",
  },
  { key: "map", label: "Map", icon: "map-outline" as const, path: "map" },
] as const;

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <View style={{ flex: 1, alignItems: "center", gap: 2 }}>
      <Text
        style={{
          color: color ?? C.fg,
          fontSize: 20,
          fontWeight: "800",
          fontFamily: mono,
        }}
      >
        {value}
      </Text>
      <Text
        style={{
          color: C.muted,
          fontSize: 11,
          fontWeight: "500",
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

  const totalCents = expenses?.reduce((sum, e) => sum + e.totalCents, 0) ?? 0;
  const expenseCount = expenses?.length ?? 0;
  const segmentCount = segments?.length ?? 0;
  const daysUntil = getDaysUntil(trip.startDate);

  return (
    <ScrollView style={{ flex: 1, paddingHorizontal: 16, paddingTop: 16 }}>
      {/* Trip header */}
      <View style={{ marginBottom: 20 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            marginBottom: 8,
          }}
        >
          <Text
            style={{ color: C.fg, fontSize: 24, fontWeight: "bold", flex: 1 }}
          >
            {trip.name}
          </Text>
          <View
            style={{
              backgroundColor: STATUS_COLORS[trip.status] ?? C.muted,
              borderRadius: R.sm,
              paddingHorizontal: 10,
              paddingVertical: 3,
            }}
          >
            <Text
              style={{
                color: DC.white,
                fontSize: 12,
                fontWeight: "600",
                textTransform: "uppercase",
              }}
            >
              {trip.status}
            </Text>
          </View>
        </View>

        {trip.destinationName && (
          <Text style={{ color: C.muted, fontSize: 15, marginBottom: 4 }}>
            {trip.destinationName}
          </Text>
        )}

        {(trip.startDate || trip.endDate) && (
          <Text style={{ color: C.muted, fontSize: 15 }}>
            {formatDate(trip.startDate)}
            {trip.startDate && trip.endDate ? " – " : ""}
            {formatDate(trip.endDate)}
          </Text>
        )}
      </View>

      {/* Stats bar */}
      <View
        style={{
          flexDirection: "row",
          backgroundColor: C.card,
          borderRadius: R.md,
          borderWidth: 1,
          borderColor: C.border,
          paddingVertical: 14,
          marginBottom: 20,
        }}
      >
        <StatCard
          label="Spent"
          value={totalCents > 0 ? formatCurrency(totalCents) : "$0"}
          color={totalCents > 0 ? C.primary : C.muted}
        />
        <View style={{ width: 1, backgroundColor: C.border }} />
        <StatCard label="Expenses" value={String(expenseCount)} />
        <View style={{ width: 1, backgroundColor: C.border }} />
        {daysUntil ? (
          <StatCard label="Countdown" value={daysUntil} color={C.accent} />
        ) : (
          <StatCard label="Segments" value={String(segmentCount)} />
        )}
      </View>

      {/* Tab grid */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
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
              paddingVertical: 20,
              paddingHorizontal: 16,
              alignItems: "center",
              gap: 8,
            }}
          >
            <Ionicons name={tab.icon} size={24} color={C.muted} />
            <Text style={{ color: C.fg, fontSize: 15, fontWeight: "600" }}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Quick actions */}
      <Pressable
        onPress={() =>
          router.push({
            pathname: "/trip/[tripId]/new-expense" as any,
            params: { tripId },
          })
        }
        style={{
          backgroundColor: C.primary,
          borderRadius: R.md,
          paddingVertical: 16,
          alignItems: "center",
          marginTop: 20,
          marginBottom: 40,
        }}
      >
        <Text style={{ color: C.primaryFg, fontSize: 16, fontWeight: "600" }}>
          + Add Expense
        </Text>
      </Pressable>
    </ScrollView>
  );
}
