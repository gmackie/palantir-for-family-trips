import { Ionicons } from "@expo/vector-icons";
import type { LocationEvent } from "@sortey/realtime";
import { useTripLocations } from "@sortey/realtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import type { Region } from "react-native-maps";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";

import { type RouterInputs, trpc, trpcClient } from "~/utils/api";
import { getBaseUrl } from "~/utils/base-url";
import { C, mono, PALETTE, R } from "~/utils/design";
import { useLocationSharing } from "~/utils/use-location-sharing";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

/**
 * `useTripLocations` (like `useTripChat`) appends `/api/chat/${tripId}/ws`, so it
 * wants just the `wss://host` (or `ws://host` on plain-http dev) origin. Derived
 * from the same base URL the tRPC client uses — mirrors chat.tsx's helper.
 */
function deriveWsBaseUrl(): string {
  const base = getBaseUrl();
  if (base.startsWith("https://"))
    return `wss://${base.slice("https://".length)}`;
  if (base.startsWith("http://")) return `ws://${base.slice("http://".length)}`;
  return base;
}

/** Member location as rendered on the map: polled roster row + live position. */
interface MapMemberLocation {
  userId: string;
  lat: number;
  lng: number;
  updatedAt: string | number | Date;
  displayName: string | null;
  colorHex: string | null;
}

const darkMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#0A0C10" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0A0C10" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8B949E" }] },
  {
    featureType: "administrative",
    elementType: "geometry.stroke",
    stylers: [{ color: "#30363D" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#161B22" }],
  },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#30363D" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#1C2128" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry.stroke",
    stylers: [{ color: "#30363D" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#0D1117" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#58A6FF" }],
  },
  {
    featureType: "poi",
    elementType: "geometry",
    stylers: [{ color: "#161B22" }],
  },
  {
    featureType: "poi",
    elementType: "labels.text.fill",
    stylers: [{ color: "#8B949E" }],
  },
  {
    featureType: "transit",
    elementType: "geometry",
    stylers: [{ color: "#161B22" }],
  },
  {
    featureType: "landscape.man_made",
    elementType: "geometry",
    stylers: [{ color: "#0D1117" }],
  },
];

const PIN_COLORS: Record<string, string> = {
  lodging: "#3b82f6",
  activity: "#22c55e",
  meal: "#f97316",
  transit: "#8b5cf6",
  drinks: "#ec4899",
  tickets: "#eab308",
  custom: "#6b7280",
};

const POI_CATEGORIES = [
  {
    key: "fuel",
    label: "Fuel",
    icon: "flame-outline" as const,
    color: "#f97316",
  },
  {
    key: "campsite",
    label: "Camp",
    icon: "bonfire-outline" as const,
    color: "#22c55e",
  },
  {
    key: "rest_area",
    label: "Rest",
    icon: "bed-outline" as const,
    color: "#8b5cf6",
  },
  {
    key: "grocery",
    label: "Grocery",
    icon: "cart-outline" as const,
    color: "#3b82f6",
  },
  {
    key: "water",
    label: "Water",
    icon: "water-outline" as const,
    color: "#06b6d4",
  },
  {
    key: "scenic",
    label: "Scenic",
    icon: "eye-outline" as const,
    color: "#eab308",
  },
  {
    key: "dump_station",
    label: "Dump",
    icon: "trash-outline" as const,
    color: "#6b7280",
  },
  {
    key: "shower",
    label: "Shower",
    icon: "rainy-outline" as const,
    color: "#ec4899",
  },
] as const;

const POI_COLOR_MAP: Record<string, string> = {};
for (const cat of POI_CATEGORIES) {
  POI_COLOR_MAP[cat.key] = cat.color;
}

function decodePolyline(
  encoded: string,
): Array<{ latitude: number; longitude: number }> {
  const points: Array<{ latitude: number; longitude: number }> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}

function degreesToMiles(latDelta: number): number {
  return latDelta * 69;
}

export default function MapScreen() {
  "use no memo";
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const workspaceId = getActiveWorkspaceId() ?? "";
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    null,
  );
  const [activePoiCategories, setActivePoiCategories] = useState<Set<string>>(
    new Set(),
  );
  const [mapCenter, setMapCenter] = useState<{
    lat: number;
    lng: number;
    radiusMiles: number;
  } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

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

  const queryClient = useQueryClient();
  const createPin = useMutation(
    trpc.pins.create.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.pins.pathFilter());
      },
      onError: () => Alert.alert("Couldn't save", "Failed to add the pin."),
    }),
  );

  // Save a corridor POI as a trip pin. Categories (campsite/water/dump_station/…)
  // are valid pin types, so they map straight through.
  const savePoiAsPin = useCallback(
    (poi: { name: string; category: string; lat: unknown; lng: unknown }) => {
      const segmentId = selectedSegmentId ?? segments?.[0]?.id;
      if (!segmentId) {
        Alert.alert("No segment", "Create a trip segment before saving pins.");
        return;
      }
      Alert.alert(
        "Save to trip?",
        `Add "${poi.name}" as a ${poi.category.replace(/_/g, " ")} pin.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Save",
            onPress: () =>
              createPin.mutate({
                workspaceId,
                tripId: tripId ?? "",
                segmentId,
                title: poi.name,
                type: poi.category as RouterInputs["pins"]["create"]["type"],
                lat: String(poi.lat),
                lng: String(poi.lng),
              }),
          },
        ],
      );
    },
    [selectedSegmentId, segments, workspaceId, tripId, createPin],
  );

  // Polled source: the persisted roster positions. Kept as the cold-start /
  // fallback source (it carries displayName + colorHex, which the live location
  // frames don't). Interval dropped to ~5s because the live socket below is
  // best-effort — a missed broadcast is reconciled by the next poll quickly.
  const { data: polledLocations } = useQuery({
    ...trpc.location.listMemberLocations.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
    }),
    refetchInterval: 5_000,
  });

  // Live source: member-location broadcasts over the trip-room WebSocket (the
  // same room chat uses; the TripRoom DO relay is payload-agnostic). Best-effort
  // — moves markers without waiting for the poll. Backfills via the same query
  // on every (re)connect so a dropped socket never strands a stale marker.
  const wsBaseUrl = useMemo(() => deriveWsBaseUrl(), []);
  const backfillLocations = useCallback(
    async (opts: { tripId: string }): Promise<LocationEvent[]> => {
      const rows = await trpcClient.location.listMemberLocations.query({
        workspaceId,
        tripId: opts.tripId,
      });
      return rows.map((r) => ({
        userId: r.userId,
        lat: r.lat,
        lng: r.lng,
        heading: r.heading,
        speed: r.speed,
        updatedAt: r.updatedAt,
      }));
    },
    [workspaceId],
  );
  const { locations: liveLocations } = useTripLocations({
    tripId: tripId ?? "",
    wsBaseUrl,
    backfill: backfillLocations,
  });

  // Merge polled roster rows with live positions: keyed by userId, the live
  // event overrides the polled value when newer. Roster metadata (displayName /
  // colorHex) always comes from the poll since live frames omit it.
  const memberLocations = useMemo<MapMemberLocation[]>(() => {
    const byId = new Map<string, MapMemberLocation>();
    for (const m of polledLocations ?? []) {
      byId.set(m.userId, {
        userId: m.userId,
        lat: m.lat,
        lng: m.lng,
        updatedAt: m.updatedAt,
        displayName: m.displayName,
        colorHex: m.colorHex,
      });
    }
    for (const live of Object.values(liveLocations)) {
      const polled = byId.get(live.userId);
      // Live wins only when strictly newer than the polled row (or no poll yet).
      const liveTime = new Date(live.updatedAt).getTime();
      const polledTime = polled ? new Date(polled.updatedAt).getTime() : -1;
      if (!polled || (Number.isFinite(liveTime) && liveTime > polledTime)) {
        byId.set(live.userId, {
          userId: live.userId,
          lat: live.lat,
          lng: live.lng,
          updatedAt: live.updatedAt,
          displayName: polled?.displayName ?? null,
          colorHex: polled?.colorHex ?? null,
        });
      }
    }
    return [...byId.values()];
  }, [polledLocations, liveLocations]);

  const poiEnabled = activePoiCategories.size > 0 && mapCenter != null;

  const { data: pois, isLoading: poisLoading } = useQuery({
    ...trpc.corridor.searchImported.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
      centerLat: mapCenter?.lat ?? 0,
      centerLng: mapCenter?.lng ?? 0,
      radiusMiles: Math.min(mapCenter?.radiusMiles ?? 30, 100),
      limit: 200,
    }),
    enabled: poiEnabled,
  });

  const filteredPois = (pois ?? []).filter((p) =>
    activePoiCategories.has(p.category),
  );

  const {
    isSharing,
    startSharing,
    stopSharing,
    isPending: sharingPending,
  } = useLocationSharing(tripId ?? "");

  const toggleCategory = useCallback((key: string) => {
    setActivePoiCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const handleRegionChange = useCallback((region: Region) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setMapCenter({
        lat: region.latitude,
        lng: region.longitude,
        radiusMiles: Math.max(
          degreesToMiles(region.latitudeDelta / 2),
          degreesToMiles(region.longitudeDelta / 2),
        ),
      });
    }, 500);
  }, []);

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

  const segmentPolylines = (segments ?? [])
    .filter((s) => s.routePolyline)
    .map((s, i) => ({
      id: s.id,
      coordinates: decodePolyline(s.routePolyline!),
      color: PALETTE[i % PALETTE.length]!,
    }));

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
              backgroundColor: !selectedSegmentId ? C.info : C.surface,
              borderRadius: R.md,
              paddingHorizontal: 12,
              paddingVertical: 6,
              minHeight: 32,
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                color: !selectedSegmentId ? C.white : C.muted,
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
                  selectedSegmentId === seg.id ? C.info : C.surface,
                borderRadius: R.md,
                paddingHorizontal: 12,
                paddingVertical: 6,
                minHeight: 32,
                justifyContent: "center",
              }}
            >
              <Text
                style={{
                  color: selectedSegmentId === seg.id ? C.white : C.muted,
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

      {/* POI category filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 12,
          paddingVertical: 6,
          gap: 6,
        }}
        style={{ backgroundColor: C.bg, flexGrow: 0 }}
      >
        {POI_CATEGORIES.map((cat) => {
          const active = activePoiCategories.has(cat.key);
          return (
            <Pressable
              key={cat.key}
              onPress={() => toggleCategory(cat.key)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                backgroundColor: active ? `${cat.color}22` : C.surface,
                borderRadius: R.md,
                borderWidth: active ? 1 : 0,
                borderColor: cat.color,
                paddingHorizontal: 10,
                paddingVertical: 5,
                minHeight: 32,
              }}
            >
              <Ionicons
                name={cat.icon}
                size={14}
                color={active ? cat.color : C.muted}
              />
              <Text
                style={{
                  color: active ? cat.color : C.muted,
                  fontSize: 12,
                  fontWeight: "600",
                }}
              >
                {cat.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Map */}
      <MapView
        style={{ flex: 1 }}
        provider={PROVIDER_GOOGLE}
        initialRegion={defaultRegion}
        showsUserLocation
        showsCompass
        customMapStyle={darkMapStyle}
        onRegionChangeComplete={handleRegionChange}
      >
        {/* Route polylines */}
        {segmentPolylines.map((poly) => (
          <Polyline
            key={`route-${poly.id}`}
            coordinates={poly.coordinates}
            strokeColor={poly.color}
            strokeWidth={3}
          />
        ))}

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
              pinColor={C.info}
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

        {/* POI markers */}
        {filteredPois.map((poi) => (
          <Marker
            key={`poi-${poi.id}`}
            coordinate={{
              latitude: Number(poi.lat),
              longitude: Number(poi.lng),
            }}
            title={poi.name}
            description={`${poi.category.replace(/_/g, " ")} · tap to save as pin`}
            pinColor={POI_COLOR_MAP[poi.category] ?? C.muted}
            opacity={0.85}
            onCalloutPress={() => savePoiAsPin(poi)}
          />
        ))}

        {/* Member location markers */}
        {(memberLocations ?? [])
          .filter((m) => m.lat !== 0 || m.lng !== 0)
          .map((member, i) => {
            const color = member.colorHex ?? PALETTE[i % PALETTE.length]!;
            const initials = member.displayName
              ? member.displayName
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((w) => w[0]?.toUpperCase() ?? "")
                  .join("")
              : "?";
            const minutesAgo = Math.round(
              (Date.now() - new Date(member.updatedAt).getTime()) / 60000,
            );
            const stale = minutesAgo > 10;

            return (
              <Marker
                key={`loc-${member.userId}`}
                coordinate={{ latitude: member.lat, longitude: member.lng }}
                title={member.displayName ?? "Member"}
                description={minutesAgo < 1 ? "Just now" : `${minutesAgo}m ago`}
              >
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: R.md,
                    backgroundColor: stale ? C.surface : `${color}33`,
                    borderWidth: 2,
                    borderColor: stale ? C.muted : color,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text
                    style={{
                      color: stale ? C.muted : color,
                      fontSize: 11,
                      fontWeight: "800",
                      fontFamily: mono,
                    }}
                  >
                    {initials}
                  </Text>
                </View>
              </Marker>
            );
          })}
      </MapView>

      {/* Bottom controls */}
      <View
        style={{
          position: "absolute",
          bottom: Platform.OS === "ios" ? 40 : 20,
          left: 16,
          right: 16,
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "flex-end",
        }}
      >
        <View
          style={{
            backgroundColor: "rgba(10,12,16,0.9)",
            borderRadius: R.md,
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
              {filteredPois.length > 0 && (
                <Text style={{ color: C.warning, fontSize: 12 }}>
                  {poisLoading ? "..." : filteredPois.length} POIs
                </Text>
              )}
              {(memberLocations?.length ?? 0) > 0 && (
                <Text style={{ color: C.info, fontSize: 12 }}>
                  {memberLocations!.length} live
                </Text>
              )}
            </>
          )}
        </View>

        <Pressable
          onPress={() => {
            if (isSharing) {
              stopSharing();
            } else {
              void startSharing();
            }
          }}
          disabled={sharingPending}
          style={{
            backgroundColor: isSharing ? C.surface : C.info,
            borderWidth: isSharing ? 1 : 0,
            borderColor: C.border,
            borderRadius: R.md,
            paddingHorizontal: 14,
            paddingVertical: 10,
            minHeight: 44,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            opacity: sharingPending ? 0.5 : 1,
          }}
        >
          <Ionicons
            name={isSharing ? "location" : "location-outline"}
            size={16}
            color={isSharing ? C.success : C.white}
          />
          <Text
            style={{
              color: isSharing ? C.fg : C.white,
              fontSize: 13,
              fontWeight: "600",
            }}
          >
            {isSharing ? "Sharing" : "Share Location"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
