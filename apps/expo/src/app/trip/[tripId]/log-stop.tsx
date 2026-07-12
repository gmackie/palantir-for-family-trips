import { Ionicons } from "@expo/vector-icons";
import NetInfo from "@react-native-community/netinfo";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
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
import { authClient } from "~/utils/auth";
import { getBaseUrl } from "~/utils/base-url";
import { C, mono, R } from "~/utils/design";
import { createJourneyStopId } from "~/utils/journey-outbox";
import { journeyOutbox } from "~/utils/journey-outbox-native";
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
  const { tripId, quick } = useLocalSearchParams<{
    tripId: string;
    quick?: string;
  }>();
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
  const [saving, setSaving] = useState(false);
  const [stopId] = useState(createJourneyStopId);
  const [photoUris, setPhotoUris] = useState<string[]>([]);

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
      },
    }),
  );
  const uploadPhoto = useMutation(trpc.photos.upload.mutationOptions());

  async function choosePhotos() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.85,
    });
    if (!result.canceled) {
      setPhotoUris(result.assets.map((asset) => asset.uri));
    }
  }

  async function uploadSelectedPhotos() {
    const cookies = authClient.getCookie();
    for (const uri of photoUris) {
      const response = await new Promise<{ ok: boolean; text: string }>(
        (resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", `${getBaseUrl()}/api/receipts/upload`);
          if (cookies) xhr.setRequestHeader("Cookie", cookies);
          xhr.onload = () =>
            resolve({
              ok: xhr.status >= 200 && xhr.status < 300,
              text: xhr.responseText,
            });
          xhr.onerror = () => reject(new Error("Photo upload failed"));
          const formData = new FormData();
          formData.append("file", {
            uri,
            name: "journey-photo.jpg",
            type: "image/jpeg",
          } as unknown as Blob);
          xhr.send(formData);
        },
      );
      if (!response.ok) throw new Error("Photo upload failed");
      const data = JSON.parse(response.text) as { storageKey?: string };
      if (data.storageKey) {
        await uploadPhoto.mutateAsync({
          workspaceId,
          tripId: tripId ?? "",
          storageKey: data.storageKey,
          journeyStopId: stopId,
          takenAt: new Date().toISOString(),
        });
      }
    }
  }

  async function flushOutbox() {
    await journeyOutbox.flush((command) => logStop.mutateAsync(command));
  }

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected) void flushOutbox();
    });
    return unsubscribe;
    // The mutation transport is stable for this mounted screen.
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount subscription
  }, []);

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

  useEffect(() => {
    if (quick === "camp") void useMyLocation();
    // Run once for the explicit Camp here entry point.
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional route-entry behavior
  }, [quick]);

  const canSave =
    !!coords && name.trim().length > 0 && !logStop.isPending && !saving;

  async function save() {
    if (!coords) return;
    setSaving(true);
    try {
      await journeyOutbox.enqueue({
        stopId,
        workspaceId,
        tripId: tripId ?? "",
        name: name.trim(),
        lat: coords.lat,
        lng: coords.lng,
        kind,
        arrivedAt: new Date(`${date}T12:00:00`).toISOString(),
        note: note.trim() || undefined,
      });
      await flushOutbox();
      const stillQueued = (await journeyOutbox.list()).some(
        (entry) => entry.command.stopId === stopId,
      );
      if (stillQueued) {
        Alert.alert(
          "Saved for sync",
          "This stop is safe on your phone and will upload when you're back online.",
        );
      } else if (photoUris.length > 0) {
        try {
          await uploadSelectedPhotos();
        } catch {
          Alert.alert(
            "Stop saved",
            "The stop is recorded, but one or more photos still need to be added from Photos.",
          );
        }
      }
      router.back();
    } finally {
      setSaving(false);
    }
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

        <View style={{ gap: 10 }}>
          <Label text="Photos (optional)" />
          <Pressable
            onPress={() => void choosePhotos()}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              borderWidth: 1,
              borderColor: C.border,
              borderRadius: R.md,
              minHeight: 48,
            }}
          >
            <Ionicons name="images-outline" size={18} color={C.info} />
            <Text style={{ color: C.info, fontWeight: "700" }}>
              {photoUris.length > 0
                ? `${photoUris.length} selected`
                : "Add photos"}
            </Text>
          </Pressable>
        </View>

        <Pressable
          onPress={() => void save()}
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
          {logStop.isPending || saving ? (
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
