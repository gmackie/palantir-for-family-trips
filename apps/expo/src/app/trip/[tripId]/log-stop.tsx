import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Location from "expo-location";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { trpc } from "~/utils/api";
import { C, mono, R } from "~/utils/design";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

const KINDS = [
  { k: "camp", label: "Camp", icon: "bonfire-outline" },
  { k: "overnight", label: "Overnight", icon: "moon-outline" },
  { k: "rest", label: "Rest stop", icon: "cafe-outline" },
  { k: "scenic", label: "Scenic", icon: "camera-outline" },
  { k: "fuel", label: "Fuel", icon: "speedometer-outline" },
  { k: "water", label: "Water", icon: "water-outline" },
  { k: "dump", label: "Dump", icon: "trash-outline" },
  { k: "town", label: "Town", icon: "business-outline" },
  { k: "custom", label: "Other", icon: "pin-outline" },
] as const;

function todayLocal(): string {
  return new Intl.DateTimeFormat("en-CA").format(new Date());
}

export default function LogStopScreen() {
  "use no memo";
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const workspaceId = getActiveWorkspaceId() ?? "";
  const router = useRouter();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [kind, setKind] = useState<(typeof KINDS)[number]["k"]>("camp");
  const [date, setDate] = useState(todayLocal());
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [gpsLoading, setGpsLoading] = useState(false);

  const search = useQuery({
    ...trpc.routePlanner.searchPlaces.queryOptions({ query }),
    enabled: query.trim().length >= 3,
  });

  const logStop = useMutation(
    trpc.journey.logStop.mutationOptions({
      onSuccess: () => {
        void qc.invalidateQueries({
          queryKey: trpc.trips.listSegments.queryKey({
            workspaceId,
            tripId: tripId ?? "",
          }),
        });
        void qc.invalidateQueries({
          queryKey: trpc.routePlanner.getRoutePreview.queryKey({
            workspaceId,
            tripId: tripId ?? "",
          }),
        });
        void qc.invalidateQueries({
          queryKey: trpc.routePlanner.predictZones.queryKey({
            workspaceId,
            tripId: tripId ?? "",
          }),
        });
        router.back();
      },
      onError: (e) => Alert.alert("Couldn't log stop", e.message),
    }),
  );

  async function useMyLocation() {
    setGpsLoading(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        Alert.alert("Location needed", "Enable location to log where you are.");
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      const lat = loc.coords.latitude;
      const lng = loc.coords.longitude;
      setCoords({ lat, lng });
      const place = await qc.fetchQuery(
        trpc.journey.reverseGeocode.queryOptions({ lat, lng }),
      );
      if (place?.name) setName((prev) => prev || place.name);
    } catch {
      Alert.alert("Location error", "Couldn't read your position.");
    } finally {
      setGpsLoading(false);
    }
  }

  const canSave = !!coords && name.trim().length > 0 && !logStop.isPending;

  function save() {
    if (!coords) return;
    logStop.mutate({
      workspaceId,
      tripId: tripId ?? "",
      name: name.trim(),
      lat: coords.lat,
      lng: coords.lng,
      kind,
      date,
      note: note.trim() || undefined,
    });
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: "Log a Stop",
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.fg,
        }}
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 20 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Where */}
        <View style={{ gap: 10 }}>
          <Label text="Where are you?" />
          <Pressable
            onPress={useMyLocation}
            disabled={gpsLoading}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              borderWidth: 1,
              borderColor: C.info,
              backgroundColor: C.infoBg,
              borderRadius: R.md,
              paddingVertical: 14,
              minHeight: 48,
            }}
          >
            {gpsLoading ? (
              <ActivityIndicator size="small" color={C.info} />
            ) : (
              <Ionicons name="locate" size={18} color={C.info} />
            )}
            <Text style={{ color: C.info, fontSize: 16, fontWeight: "700" }}>
              Use my location
            </Text>
          </Pressable>

          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="…or search a place"
            placeholderTextColor={C.placeholder}
            style={inputStyle}
          />
          {search.isFetching && (
            <ActivityIndicator size="small" color={C.muted} />
          )}
          {(search.data ?? []).slice(0, 5).map((p) => (
            <Pressable
              key={p.placeId}
              onPress={() => {
                setCoords({ lat: p.lat, lng: p.lng });
                setName(p.name);
                setQuery("");
              }}
              style={{
                borderWidth: 1,
                borderColor: C.border,
                borderRadius: R.md,
                padding: 12,
                minHeight: 44,
              }}
            >
              <Text style={{ color: C.fg, fontSize: 15, fontWeight: "600" }}>
                {p.name}
              </Text>
              <Text style={{ color: C.muted, fontSize: 12 }} numberOfLines={1}>
                {p.address}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Name + selected coords */}
        <View style={{ gap: 10 }}>
          <Label text="Name this stop" />
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Johnny Creek Campground"
            placeholderTextColor={C.placeholder}
            style={inputStyle}
          />
          {coords && (
            <Text
              style={{
                color: C.success,
                fontSize: 12,
                fontFamily: mono,
                fontVariant: ["tabular-nums"],
              }}
            >
              📍 {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
            </Text>
          )}
        </View>

        {/* Kind */}
        <View style={{ gap: 10 }}>
          <Label text="What kind of stop?" />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {KINDS.map((opt) => {
              const active = kind === opt.k;
              return (
                <Pressable
                  key={opt.k}
                  onPress={() => setKind(opt.k)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    borderWidth: 1,
                    borderColor: active ? C.info : C.border,
                    backgroundColor: active ? C.infoBg : C.surface,
                    borderRadius: R.md,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    minHeight: 44,
                  }}
                >
                  <Ionicons
                    name={opt.icon}
                    size={15}
                    color={active ? C.info : C.muted}
                  />
                  <Text
                    style={{
                      color: active ? C.info : C.fg,
                      fontSize: 14,
                      fontWeight: active ? "700" : "500",
                    }}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Date (aspirational — editable) */}
        <View style={{ gap: 10 }}>
          <Label text="Date (you can change this later)" />
          <TextInput
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={C.placeholder}
            autoCapitalize="none"
            style={inputStyle}
          />
        </View>

        {/* Note */}
        <View style={{ gap: 10 }}>
          <Label text="Note (optional)" />
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Anything worth remembering…"
            placeholderTextColor={C.placeholder}
            multiline
            style={{ ...inputStyle, minHeight: 72, textAlignVertical: "top" }}
          />
        </View>

        <Pressable
          onPress={save}
          disabled={!canSave}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            borderRadius: R.md,
            paddingVertical: 16,
            minHeight: 52,
            backgroundColor: canSave ? C.success : C.border,
          }}
        >
          {logStop.isPending ? (
            <ActivityIndicator size="small" color={C.bg} />
          ) : (
            <Ionicons name="add-circle-outline" size={18} color={C.bg} />
          )}
          <Text style={{ color: C.bg, fontSize: 16, fontWeight: "800" }}>
            Log this stop
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Label({ text }: { text: string }) {
  return (
    <Text
      style={{
        color: C.muted,
        fontSize: 12,
        fontWeight: "700",
        textTransform: "uppercase",
        letterSpacing: 1,
      }}
    >
      {text}
    </Text>
  );
}

const inputStyle = {
  borderWidth: 1,
  borderColor: C.border,
  backgroundColor: C.input,
  borderRadius: R.md,
  paddingHorizontal: 14,
  paddingVertical: 12,
  minHeight: 48,
  color: C.fg,
  fontSize: 16,
} as const;
