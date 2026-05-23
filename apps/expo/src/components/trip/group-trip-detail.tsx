import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

const C = {
  bg: "#141116",
  fg: "#f9f7fb",
  muted: "#8c8691",
  primary: "#d66daa",
  primaryFg: "#141116",
  card: "#1e1b24",
  border: "#2f2a33",
} as const;

const STATUS_COLORS: Record<string, string> = {
  planning: "#eab308",
  confirmed: "#3b82f6",
  active: "#22c55e",
  completed: "#6b7280",
};

function formatDate(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
    new Date(value),
  );
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
  { key: "expenses", label: "Expenses", icon: "💰", path: "expenses" },
  { key: "settle", label: "Settle Up", icon: "🤝", path: "settle" },
  { key: "plan", label: "Plan", icon: "📋", path: "polls" },
  { key: "map", label: "Map", icon: "📍", path: "map" },
] as const;

export function GroupTripDetail({
  trip,
  tripId,
}: {
  trip: Trip;
  tripId: string;
}) {
  "use no memo";
  const router = useRouter();

  return (
    <ScrollView style={{ flex: 1, paddingHorizontal: 16, paddingTop: 16 }}>
      {/* Trip header */}
      <View style={{ marginBottom: 24 }}>
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
              backgroundColor: STATUS_COLORS[trip.status] ?? "#9ca3af",
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 3,
            }}
          >
            <Text
              style={{
                color: "#fff",
                fontSize: 12,
                fontWeight: "600",
                textTransform: "capitalize",
              }}
            >
              {trip.status}
            </Text>
          </View>
        </View>

        {trip.destinationName && (
          <Text style={{ color: C.muted, fontSize: 16, marginBottom: 4 }}>
            {trip.destinationName}
          </Text>
        )}

        {(trip.startDate || trip.endDate) && (
          <Text style={{ color: C.muted, fontSize: 14 }}>
            {formatDate(trip.startDate)}
            {trip.startDate && trip.endDate ? " – " : ""}
            {formatDate(trip.endDate)}
          </Text>
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
              borderRadius: 12,
              borderWidth: 1,
              borderColor: C.border,
              paddingVertical: 20,
              paddingHorizontal: 16,
              alignItems: "center",
              gap: 8,
            }}
          >
            <Text style={{ fontSize: 28 }}>{tab.icon}</Text>
            <Text style={{ color: C.fg, fontSize: 16, fontWeight: "600" }}>
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
          borderRadius: 12,
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
