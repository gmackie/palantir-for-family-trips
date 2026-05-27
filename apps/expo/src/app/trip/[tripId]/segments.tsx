import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, FlatList, Text, View } from "react-native";

import { trpc } from "~/utils/api";
import { C, mono, R } from "~/utils/design";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

const SEGMENT_COLORS = [
  C.info, // #58A6FF
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

export default function SegmentsScreen() {
  "use no memo";
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const workspaceId = getActiveWorkspaceId() ?? "";

  const { data: segments, isLoading } = useQuery(
    trpc.trips.listSegments.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
    }),
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: "Schedule",
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
          <Text style={{ color: C.muted, fontSize: 18, marginBottom: 8 }}>
            No segments yet
          </Text>
          <Text style={{ color: C.muted, fontSize: 15, textAlign: "center" }}>
            Trip segments will appear here once added.
          </Text>
        </View>
      ) : (
        <FlatList
          data={segments}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          ItemSeparatorComponent={() => (
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
          renderItem={({ item, index }) => {
            const color = SEGMENT_COLORS[index % SEGMENT_COLORS.length]!;
            const dateRange = formatDateRange(item.startDate, item.endDate);

            return (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: C.border,
                  backgroundColor: C.surface,
                  borderRadius: R.md,
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    height: 3,
                    backgroundColor: color,
                  }}
                />
                <View style={{ padding: 16, gap: 8 }}>
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
                          color: color,
                          fontSize: 12,
                          fontWeight: "800",
                          fontFamily: mono,
                        }}
                      >
                        {index + 1}
                      </Text>
                    </View>
                    <Text
                      style={{
                        color: C.fg,
                        fontSize: 18,
                        fontWeight: "700",
                        flex: 1,
                      }}
                    >
                      {item.name}
                    </Text>
                  </View>

                  {item.destinationName && (
                    <Text style={{ color: C.muted, fontSize: 15 }}>
                      {item.destinationName}
                    </Text>
                  )}

                  {dateRange ? (
                    <Text
                      style={{
                        color: C.info,
                        fontSize: 13,
                        fontFamily: mono,
                      }}
                    >
                      {dateRange}
                    </Text>
                  ) : null}

                  {item.distanceMiles && (
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
                  )}
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}
