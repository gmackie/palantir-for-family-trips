import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";

import { trpc } from "~/utils/api";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

const C = {
  bg: "#141116",
  fg: "#f9f7fb",
  muted: "#8c8691",
  card: "#1e1b24",
  border: "#2f2a33",
  primary: "#d66daa",
  accent: "#58A6FF",
} as const;

const PIN_COLORS: Record<string, string> = {
  lodging: "#3b82f6",
  activity: "#22c55e",
  meal: "#f97316",
  transit: "#8b5cf6",
  drinks: "#ec4899",
  tickets: "#eab308",
  custom: "#6b7280",
};

const PIN_ICONS: Record<string, string> = {
  lodging: "🏠",
  activity: "🎯",
  meal: "🍽️",
  transit: "🚗",
  drinks: "🍺",
  tickets: "🎟️",
  custom: "📍",
};

const DARK_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#1d1d2b" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1d1d2b" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8c8691" }] },
  {
    featureType: "administrative.locality",
    elementType: "labels.text.fill",
    stylers: [{ color: "#c4b8d0" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#2a2735" }],
  },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#1e1b24" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#3c3550" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#141120" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#4a4460" }],
  },
  {
    featureType: "poi",
    elementType: "geometry",
    stylers: [{ color: "#252233" }],
  },
  {
    featureType: "poi",
    elementType: "labels.text.fill",
    stylers: [{ color: "#6b6278" }],
  },
  {
    featureType: "transit",
    elementType: "geometry",
    stylers: [{ color: "#252233" }],
  },
];

export default function MapScreen() {
  "use no memo";
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const workspaceId = getActiveWorkspaceId() ?? "";
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    null,
  );

  const { data: trip } = useQuery(
    trpc.trips.get.queryOptions({ workspaceId, tripId: tripId ?? "" }),
  );

  const { data: segments } = useQuery(
    trpc.trips.listSegments.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
    }),
  );

  const { data: pins, isLoading: pinsLoading } = useQuery(
    trpc.pins.list.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
      segmentId: selectedSegmentId ?? undefined,
    }),
  );

  const allLocations = [
    ...(segments ?? [])
      .filter((s) => s.destinationLat && s.destinationLng)
      .map((s) => ({
        lat: Number(s.destinationLat),
        lng: Number(s.destinationLng),
      })),
    ...(pins ?? [])
      .filter((p) => p.lat && p.lng)
      .map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) })),
  ];

  const defaultRegion =
    trip?.destinationLat && trip?.destinationLng
      ? {
          latitude: Number(trip.destinationLat),
          longitude: Number(trip.destinationLng),
          latitudeDelta: 0.15,
          longitudeDelta: 0.15,
        }
      : allLocations.length > 0
        ? {
            latitude:
              allLocations.reduce((s, l) => s + l.lat, 0) / allLocations.length,
            longitude:
              allLocations.reduce((s, l) => s + l.lng, 0) / allLocations.length,
            latitudeDelta: 0.5,
            longitudeDelta: 0.5,
          }
        : {
            latitude: 41.2565,
            longitude: -95.9345,
            latitudeDelta: 5,
            longitudeDelta: 5,
          };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: trip?.name ?? "Map",
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.fg,
        }}
      />

      {/* Segment filter */}
      {segments && segments.length > 1 && (
        <View
          style={{
            flexDirection: "row",
            paddingHorizontal: 12,
            paddingVertical: 8,
            gap: 8,
            backgroundColor: C.bg,
          }}
        >
          <Pressable
            onPress={() => setSelectedSegmentId(null)}
            style={{
              backgroundColor: !selectedSegmentId ? C.accent : C.card,
              borderRadius: 16,
              paddingHorizontal: 12,
              paddingVertical: 6,
            }}
          >
            <Text
              style={{
                color: !selectedSegmentId ? "#fff" : C.muted,
                fontSize: 12,
                fontWeight: "600",
              }}
            >
              All
            </Text>
          </Pressable>
          {segments.map((seg) => (
            <Pressable
              key={seg.id}
              onPress={() => setSelectedSegmentId(seg.id)}
              style={{
                backgroundColor:
                  selectedSegmentId === seg.id ? C.accent : C.card,
                borderRadius: 16,
                paddingHorizontal: 12,
                paddingVertical: 6,
              }}
            >
              <Text
                style={{
                  color: selectedSegmentId === seg.id ? "#fff" : C.muted,
                  fontSize: 12,
                  fontWeight: "600",
                }}
              >
                {seg.name}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Map */}
      <MapView
        style={{ flex: 1 }}
        provider={PROVIDER_GOOGLE}
        initialRegion={defaultRegion}
        showsUserLocation
        showsCompass
        customMapStyle={DARK_MAP_STYLE}
      >
        {/* Segment destination markers */}
        {(segments ?? [])
          .filter((s) => s.destinationLat && s.destinationLng)
          .filter((s) => !selectedSegmentId || s.id === selectedSegmentId)
          .map((seg) => (
            <Marker
              key={`seg-${seg.id}`}
              coordinate={{
                latitude: Number(seg.destinationLat),
                longitude: Number(seg.destinationLng),
              }}
              title={seg.name}
              description={seg.destinationName ?? undefined}
              pinColor={C.accent}
            />
          ))}

        {/* Pin markers */}
        {(pins ?? [])
          .filter((p) => p.lat && p.lng)
          .map((pin) => (
            <Marker
              key={`pin-${pin.id}`}
              coordinate={{
                latitude: Number(pin.lat),
                longitude: Number(pin.lng),
              }}
              title={pin.title}
              description={pin.notes ?? undefined}
              pinColor={PIN_COLORS[pin.type] ?? "#6b7280"}
            />
          ))}
      </MapView>

      {/* Pin count overlay */}
      <View
        style={{
          position: "absolute",
          bottom: Platform.OS === "ios" ? 40 : 20,
          left: 16,
          backgroundColor: "rgba(20,17,22,0.9)",
          borderRadius: 8,
          paddingHorizontal: 12,
          paddingVertical: 8,
          flexDirection: "row",
          gap: 12,
        }}
      >
        {pinsLoading ? (
          <ActivityIndicator size="small" color={C.muted} />
        ) : (
          <>
            <Text style={{ color: C.fg, fontSize: 12, fontWeight: "600" }}>
              {pins?.length ?? 0} pins
            </Text>
            <Text style={{ color: C.muted, fontSize: 12 }}>
              {segments?.length ?? 0} segments
            </Text>
          </>
        )}
      </View>
    </View>
  );
}
