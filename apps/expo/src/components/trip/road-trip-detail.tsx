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
  orange: "#fb923c",
  orangeBg: "rgba(249,115,22,0.15)",
} as const;

const STATUS_COLORS: Record<string, string> = {
  planning: "#eab308",
  en_route: "#f97316",
  paused: "#ca8a04",
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
  { key: "map", label: "Route", icon: "🗺️", path: "map" },
  { key: "expenses", label: "Expenses", icon: "💰", path: "expenses" },
  { key: "fuel", label: "Fuel Log", icon: "⛽", path: "new-expense" },
  { key: "settle", label: "Settle Up", icon: "🤝", path: "settle" },
] as const;

export function RoadTripDetail({
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
      {/* Road trip header */}
      <View style={{ marginBottom: 24 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            marginBottom: 10,
          }}
        >
          <View
            style={{
              backgroundColor: C.orangeBg,
              borderRadius: 4,
              paddingHorizontal: 8,
              paddingVertical: 4,
            }}
          >
            <Text
              style={{
                color: C.orange,
                fontSize: 11,
                fontWeight: "bold",
                letterSpacing: 1,
              }}
            >
              ROAD TRIP
            </Text>
          </View>
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
              {trip.status.replace("_", " ")}
            </Text>
          </View>
        </View>

        <Text
          style={{
            color: C.fg,
            fontSize: 24,
            fontWeight: "bold",
            marginBottom: 6,
          }}
        >
          {trip.name}
        </Text>

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

      {/* Stats strip (placeholder for live data) */}
      <View style={{ flexDirection: "row", gap: 12, marginBottom: 24 }}>
        <View
          style={{
            flex: 1,
            backgroundColor: C.card,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: C.border,
            padding: 12,
            alignItems: "center",
          }}
        >
          <Text
            style={{
              color: C.muted,
              fontSize: 11,
              fontWeight: "600",
              textTransform: "uppercase",
              letterSpacing: 0.5,
              marginBottom: 4,
            }}
          >
            Miles
          </Text>
          <Text
            style={{
              color: C.fg,
              fontSize: 20,
              fontWeight: "bold",
              fontFamily: "Menlo",
            }}
          >
            —
          </Text>
        </View>
        <View
          style={{
            flex: 1,
            backgroundColor: C.card,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: C.border,
            padding: 12,
            alignItems: "center",
          }}
        >
          <Text
            style={{
              color: C.muted,
              fontSize: 11,
              fontWeight: "600",
              textTransform: "uppercase",
              letterSpacing: 0.5,
              marginBottom: 4,
            }}
          >
            Fuel
          </Text>
          <Text
            style={{
              color: C.fg,
              fontSize: 20,
              fontWeight: "bold",
              fontFamily: "Menlo",
            }}
          >
            —
          </Text>
        </View>
        <View
          style={{
            flex: 1,
            backgroundColor: C.card,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: C.border,
            padding: 12,
            alignItems: "center",
          }}
        >
          <Text
            style={{
              color: C.muted,
              fontSize: 11,
              fontWeight: "600",
              textTransform: "uppercase",
              letterSpacing: 0.5,
              marginBottom: 4,
            }}
          >
            Days
          </Text>
          <Text
            style={{
              color: C.fg,
              fontSize: 20,
              fontWeight: "bold",
              fontFamily: "Menlo",
            }}
          >
            —
          </Text>
        </View>
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

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}
