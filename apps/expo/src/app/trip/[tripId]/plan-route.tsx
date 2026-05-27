import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
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

interface Place {
  name: string;
  address: string;
  lat: number;
  lng: number;
  placeId: string;
}

const GOOGLE_API_KEY =
  Constants.expoConfig?.extra?.GOOGLE_MAPS_API_KEY ??
  process.env.GOOGLE_MAPS_API_KEY ??
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ??
  "";

function usePlacesSearch() {
  const [results, setResults] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const search = useCallback((query: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (query.length < 3) {
      setResults([]);
      return;
    }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${GOOGLE_API_KEY}`,
        );
        const data = (await res.json()) as {
          results: Array<{
            place_id: string;
            name: string;
            formatted_address: string;
            geometry: { location: { lat: number; lng: number } };
          }>;
        };
        setResults(
          (data.results ?? []).slice(0, 5).map((r) => ({
            name: r.name,
            address: r.formatted_address,
            lat: r.geometry.location.lat,
            lng: r.geometry.location.lng,
            placeId: r.place_id,
          })),
        );
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 400);
  }, []);

  const clear = useCallback(() => setResults([]), []);
  return { results, loading, search, clear };
}

function PlaceInput({
  label,
  value,
  onSelect,
  onClear,
  placeholder,
}: {
  label: string;
  value: Place | null;
  onSelect: (place: Place) => void;
  onClear: () => void;
  placeholder: string;
}) {
  const [text, setText] = useState(value?.name ?? "");
  const [focused, setFocused] = useState(false);
  const { results, loading, search, clear } = usePlacesSearch();

  return (
    <View style={{ gap: 6, zIndex: focused ? 10 : 1 }}>
      <Text
        style={{
          color: C.muted,
          fontSize: 11,
          fontWeight: "600",
          textTransform: "uppercase",
          letterSpacing: 1,
        }}
      >
        {label}
      </Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput
          value={value ? value.name : text}
          onChangeText={(t) => {
            if (value) onClear();
            setText(t);
            search(t);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 200)}
          placeholder={placeholder}
          placeholderTextColor={C.placeholder}
          style={{
            flex: 1,
            backgroundColor: C.surface,
            borderWidth: 1,
            borderColor: value ? C.info : C.border,
            borderRadius: R.md,
            padding: 14,
            color: C.fg,
            fontSize: 15,
          }}
        />
        {value && (
          <Pressable
            onPress={() => {
              onClear();
              setText("");
              clear();
            }}
            style={{
              minHeight: 44,
              minWidth: 44,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="close-circle" size={20} color={C.muted} />
          </Pressable>
        )}
      </View>

      {value && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Ionicons name="checkmark-circle" size={14} color={C.success} />
          <Text
            style={{ color: C.muted, fontSize: 12, fontFamily: mono, flex: 1 }}
            numberOfLines={1}
          >
            {value.address}
          </Text>
        </View>
      )}

      {focused && !value && (results.length > 0 || loading) && (
        <View
          style={{
            backgroundColor: C.surface,
            borderWidth: 1,
            borderColor: C.border,
            borderRadius: R.md,
            maxHeight: 200,
            overflow: "hidden",
          }}
        >
          {loading && (
            <View style={{ padding: 12, alignItems: "center" }}>
              <ActivityIndicator size="small" color={C.muted} />
            </View>
          )}
          {results.map((place) => (
            <Pressable
              key={place.placeId}
              onPress={() => {
                onSelect(place);
                setText(place.name);
                clear();
              }}
              style={{
                padding: 12,
                borderBottomWidth: 1,
                borderBottomColor: C.border,
              }}
            >
              <Text
                style={{ color: C.fg, fontSize: 14, fontWeight: "600" }}
                numberOfLines={1}
              >
                {place.name}
              </Text>
              <Text style={{ color: C.muted, fontSize: 12 }} numberOfLines={1}>
                {place.address}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

export default function PlanRouteScreen() {
  "use no memo";
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const workspaceId = getActiveWorkspaceId() ?? "";
  const router = useRouter();
  const queryClient = useQueryClient();

  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [startDate, setStartDate] = useState("");
  const [autoSplit, setAutoSplit] = useState(true);

  const planRoute = useMutation(
    trpc.routePlanner.planRoute.mutationOptions({
      onSuccess: (data) => {
        void queryClient.invalidateQueries({
          queryKey: trpc.trips.listSegments.queryKey({
            workspaceId,
            tripId: tripId ?? "",
          }),
        });
        void queryClient.invalidateQueries({
          queryKey: trpc.routePlanner.getRoutePreview.queryKey({
            workspaceId,
            tripId: tripId ?? "",
          }),
        });
        void queryClient.invalidateQueries({
          queryKey: trpc.trips.get.queryKey({
            workspaceId,
            tripId: tripId ?? "",
          }),
        });
        Alert.alert(
          "Route Planned",
          `${Math.round(data.totalMiles)} miles, ${data.segmentCount} segment${data.segmentCount === 1 ? "" : "s"}`,
          [{ text: "OK", onPress: () => router.back() }],
        );
      },
      onError: (err) => Alert.alert("Error", err.message),
    }),
  );

  const canSubmit =
    origin && destination && startDate.match(/^\d{4}-\d{2}-\d{2}$/);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: "Plan Route",
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.fg,
        }}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text
            style={{
              color: C.fg,
              fontSize: 22,
              fontWeight: "bold",
              marginBottom: 4,
            }}
          >
            Set your route
          </Text>
          <Text style={{ color: C.muted, fontSize: 14, marginBottom: 24 }}>
            Search for your origin and destination. The route will be split into
            driving days automatically.
          </Text>

          <View style={{ gap: 20 }}>
            <PlaceInput
              label="Origin"
              value={origin}
              onSelect={setOrigin}
              onClear={() => setOrigin(null)}
              placeholder="Seattle, WA"
            />

            <PlaceInput
              label="Destination"
              value={destination}
              onSelect={setDestination}
              onClear={() => setDestination(null)}
              placeholder="Des Moines, IA"
            />

            <View style={{ gap: 6 }}>
              <Text
                style={{
                  color: C.muted,
                  fontSize: 11,
                  fontWeight: "600",
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                Departure Date
              </Text>
              <TextInput
                value={startDate}
                onChangeText={setStartDate}
                placeholder="2026-06-05"
                placeholderTextColor={C.placeholder}
                keyboardType="numbers-and-punctuation"
                style={{
                  backgroundColor: C.surface,
                  borderWidth: 1,
                  borderColor: C.border,
                  borderRadius: R.md,
                  padding: 14,
                  color: C.fg,
                  fontSize: 15,
                  fontFamily: mono,
                }}
              />
            </View>

            <Pressable
              onPress={() => setAutoSplit(!autoSplit)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                padding: 14,
                backgroundColor: C.surface,
                borderWidth: 1,
                borderColor: C.border,
                borderRadius: R.md,
              }}
            >
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: R.sm,
                  borderWidth: 2,
                  borderColor: autoSplit ? C.info : C.muted,
                  backgroundColor: autoSplit ? C.info : "transparent",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {autoSplit && (
                  <Ionicons name="checkmark" size={14} color={C.white} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.fg, fontSize: 15, fontWeight: "600" }}>
                  Auto-split into driving days
                </Text>
                <Text style={{ color: C.muted, fontSize: 12 }}>
                  Splits based on daylight hours and max 12h driving
                </Text>
              </View>
            </Pressable>

            {origin && destination && (
              <View
                style={{
                  backgroundColor: C.surface,
                  borderWidth: 1,
                  borderColor: C.border,
                  borderRadius: R.md,
                  padding: 14,
                  gap: 8,
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
                  Route Preview
                </Text>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Ionicons name="navigate-outline" size={16} color={C.info} />
                  <Text
                    style={{ color: C.fg, fontSize: 15, flex: 1 }}
                    numberOfLines={1}
                  >
                    {origin.name}
                  </Text>
                </View>
                <View
                  style={{
                    marginLeft: 8,
                    borderLeftWidth: 2,
                    borderLeftColor: C.border,
                    height: 16,
                  }}
                />
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Ionicons name="flag-outline" size={16} color={C.success} />
                  <Text
                    style={{ color: C.fg, fontSize: 15, flex: 1 }}
                    numberOfLines={1}
                  >
                    {destination.name}
                  </Text>
                </View>
              </View>
            )}
          </View>
        </ScrollView>

        <View
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: C.bg,
            borderTopWidth: 1,
            borderTopColor: C.border,
            padding: 16,
            paddingBottom: 36,
          }}
        >
          <Pressable
            onPress={() => {
              if (!origin || !destination || !canSubmit) return;
              planRoute.mutate({
                workspaceId,
                tripId: tripId ?? "",
                origin: { name: origin.name, lat: origin.lat, lng: origin.lng },
                destination: {
                  name: destination.name,
                  lat: destination.lat,
                  lng: destination.lng,
                },
                startDate,
                autoSplit,
              });
            }}
            disabled={!canSubmit || planRoute.isPending}
            style={{
              backgroundColor: C.info,
              borderRadius: R.md,
              paddingVertical: 16,
              alignItems: "center",
              opacity: !canSubmit || planRoute.isPending ? 0.5 : 1,
            }}
          >
            {planRoute.isPending ? (
              <View
                style={{ flexDirection: "row", gap: 8, alignItems: "center" }}
              >
                <ActivityIndicator color={C.white} size="small" />
                <Text
                  style={{ color: C.white, fontSize: 16, fontWeight: "600" }}
                >
                  Planning...
                </Text>
              </View>
            ) : (
              <Text style={{ color: C.white, fontSize: 16, fontWeight: "600" }}>
                Plan Route
              </Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
