import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Location from "expo-location";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import type { RouterOutputs } from "~/utils/api";
import { trpc } from "~/utils/api";
import { C, mono, R } from "~/utils/design";
import {
  loadTodaySnapshot,
  saveTodaySnapshot,
} from "~/utils/today-cache";
import { useDwellSuggest } from "~/utils/use-dwell-suggest";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

type TodayCommand = RouterOutputs["planner"]["todayCommand"];

function openMaps(lat: number, lng: number, label: string) {
  const q = encodeURIComponent(`${lat},${lng}`);
  const url =
    Platform.OS === "ios"
      ? `maps://?daddr=${lat},${lng}&q=${encodeURIComponent(label)}`
      : `google.navigation:q=${lat},${lng}`;
  void Linking.openURL(url).catch(() => {
    void Linking.openURL(
      `https://www.google.com/maps/dir/?api=1&destination=${q}`,
    );
  });
}

type ReplanReason = "behind" | "side_trip" | "stayed" | "manual";

export default function TodayScreen() {
  "use no memo";
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const workspaceId = getActiveWorkspaceId() ?? "";
  const router = useRouter();
  const queryClient = useQueryClient();
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [cutMode, setCutMode] = useState(false);
  const [replanOpen, setReplanOpen] = useState(false);
  const [replanReason, setReplanReason] = useState<ReplanReason>("behind");
  const [fuelOpen, setFuelOpen] = useState(false);
  const [odo, setOdo] = useState("");
  const [gallons, setGallons] = useState("");
  const [ppg, setPpg] = useState("");
  const [cached, setCached] = useState<TodayCommand | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const todayStr = new Date().toISOString().slice(0, 10);
  const { suggestion: dwell, dismiss: dismissDwell } = useDwellSuggest(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== "granted") return;
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) {
          setCoords({
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
          });
        }
      } catch {
        // GPS optional
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!tripId) return;
    void loadTodaySnapshot<TodayCommand>(tripId, todayStr).then((snap) => {
      if (snap?.payload) setCached(snap.payload);
    });
  }, [tripId, todayStr]);

  const {
    data: live,
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useQuery(
    trpc.planner.todayCommand.queryOptions(
      {
        workspaceId,
        tripId: tripId ?? "",
        lat: coords?.lat,
        lng: coords?.lng,
      },
      {
        enabled: Boolean(workspaceId && tripId),
        refetchInterval: 60_000,
        placeholderData: (prev) => prev ?? cached ?? undefined,
      },
    ),
  );

  useEffect(() => {
    if (live && tripId) {
      setFromCache(false);
      setCached(live);
      void saveTodaySnapshot(tripId, live.date, live);
    }
  }, [live, tripId]);

  useEffect(() => {
    if (isError && cached) setFromCache(true);
  }, [isError, cached]);

  const data = live ?? cached;

  const { data: preview, isFetching: previewLoading } = useQuery(
    trpc.planner.replanPreview.queryOptions(
      {
        workspaceId,
        tripId: tripId ?? "",
        reason: replanReason,
        mode: "soft_route",
        origin: coords
          ? { lat: coords.lat, lng: coords.lng, name: "Current location" }
          : undefined,
      },
      { enabled: replanOpen && Boolean(workspaceId && tripId) },
    ),
  );

  const setStatus = useMutation(
    trpc.planner.setDayStatus.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(
          trpc.planner.todayCommand.queryFilter(),
        );
        void queryClient.invalidateQueries(trpc.planner.listDays.queryFilter());
      },
      onError: (e) => Alert.alert("Could not update day", e.message),
    }),
  );

  const applyReplan = useMutation(
    trpc.planner.applyReplan.mutationOptions({
      onSuccess: (r) => {
        setReplanOpen(false);
        void queryClient.invalidateQueries(
          trpc.planner.todayCommand.queryFilter(),
        );
        void queryClient.invalidateQueries(trpc.planner.listDays.queryFilter());
        void queryClient.invalidateQueries(
          trpc.planner.getPlanMap.queryFilter(),
        );
        Alert.alert("Plan updated", r.summary ?? "Remaining days rewritten.");
      },
      onError: (e) => Alert.alert("Replan failed", e.message),
    }),
  );

  const setRunState = useMutation(
    trpc.planner.setRunState.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(
          trpc.planner.todayCommand.queryFilter(),
        );
      },
    }),
  );

  const logFuel = useMutation(
    trpc.fuelLogs.create.mutationOptions({
      onSuccess: () => {
        setFuelOpen(false);
        setOdo("");
        setGallons("");
        setPpg("");
        void queryClient.invalidateQueries(
          trpc.planner.todayCommand.queryFilter(),
        );
        void queryClient.invalidateQueries(trpc.fuelLogs.list.queryFilter());
        Alert.alert("Fuel logged", "Fill-up saved.");
      },
      onError: (e) => Alert.alert("Fuel log failed", e.message),
    }),
  );

  const markDone = useCallback(
    (status: "done" | "partial" | "skipped") => {
      if (!data?.date) return;
      setStatus.mutate({
        workspaceId,
        tripId: tripId ?? "",
        date: data.date,
        status,
        actualNote:
          status === "partial"
            ? "Partial day"
            : status === "skipped"
              ? "Skipped"
              : data.day?.heroTitle ?? "Done",
      });
    },
    [data, setStatus, tripId, workspaceId],
  );

  const go = (path: string, params?: Record<string, string>) =>
    router.push({
      pathname: path as any,
      params: { tripId: tripId ?? "", ...params },
    });

  if (isLoading && !data) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: "center" }}>
        <Stack.Screen options={{ title: "Today" }} />
        <ActivityIndicator color={C.info} />
      </View>
    );
  }

  if (!data) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, padding: 16 }}>
        <Stack.Screen options={{ title: "Today" }} />
        <Text style={{ color: C.critical }}>Could not load today.</Text>
        <Pressable onPress={() => void refetch()} style={{ marginTop: 12 }}>
          <Text style={{ color: C.info }}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const late = data.leaveBy?.late === true;
  const showFull = !cutMode;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: "Today",
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.fg,
          headerRight: () => (
            <Pressable onPress={() => setCutMode((c) => !c)} hitSlop={12}>
              <Text style={{ color: C.info, fontSize: 13, fontWeight: "700" }}>
                {cutMode ? "Full" : "Cut"}
              </Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={C.info}
          />
        }
      >
        <Pressable onPress={() => void refetch()}>
          <Text style={{ color: C.muted, fontSize: 11, fontWeight: "700" }}>
            {data.date} · {data.day?.intent ?? "—"} · {data.runState}
            {data.dayStatus !== "planned" ? ` · ${data.dayStatus}` : ""}
            {fromCache ? " · offline" : ""}
            {isRefetching ? " · …" : ""}
          </Text>
        </Pressable>

        {fromCache && (
          <Text style={{ color: C.warning, fontSize: 12 }}>
            Showing last cached Today — reconnect to refresh or replan.
          </Text>
        )}

        {dwell && (
          <View
            style={{
              borderWidth: 1,
              borderColor: C.info + "88",
              backgroundColor: C.surface,
              padding: 14,
              gap: 8,
              borderRadius: R.md,
            }}
          >
            <Text style={{ color: C.info, fontWeight: "700" }}>
              Stopped ~{dwell.minutes} min — log this place?
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <ActionBtn
                label="Log stop"
                onPress={() => {
                  dismissDwell();
                  go("/trip/[tripId]/log-stop");
                }}
                tone={C.info}
              />
              <ActionBtn label="Dismiss" onPress={dismissDwell} />
            </View>
          </View>
        )}

        {showFull && data.vanLevels && (
          <Text style={{ color: C.muted, fontSize: 11, fontFamily: mono }}>
            Tanks
            {data.vanLevels.fresh != null
              ? ` · fresh ${Math.round(data.vanLevels.fresh)}%`
              : ""}
            {data.vanLevels.grey != null
              ? ` · grey ${Math.round(data.vanLevels.grey)}%`
              : ""}
            {data.vanLevels.fuel != null
              ? ` · fuel ${Math.round(data.vanLevels.fuel)}%`
              : ""}
          </Text>
        )}

        {/* Plan vs actual strip */}
        {showFull && (data.recentDays?.length ?? 0) > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {data.recentDays.map((d) => (
                <View
                  key={d.date}
                  style={{
                    borderWidth: 1,
                    borderColor: d.isToday ? C.info : C.border,
                    backgroundColor: C.surface,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    minWidth: 88,
                  }}
                >
                  <Text
                    style={{
                      color: d.isToday ? C.info : C.muted,
                      fontFamily: mono,
                      fontSize: 10,
                    }}
                  >
                    {d.date.slice(5)}
                  </Text>
                  <Text
                    style={{ color: C.fg, fontSize: 12, fontWeight: "700" }}
                    numberOfLines={1}
                  >
                    {d.title ?? d.intent}
                  </Text>
                  <Text
                    style={{
                      color:
                        d.status === "done"
                          ? C.success
                          : d.status === "partial"
                            ? C.warning
                            : C.muted,
                      fontSize: 10,
                      fontWeight: "600",
                    }}
                  >
                    {d.status}
                  </Text>
                </View>
              ))}
            </View>
          </ScrollView>
        )}

        {late && (
          <View
            style={{
              borderWidth: 1,
              borderColor: C.warning,
              padding: 12,
              borderRadius: R.md,
            }}
          >
            <Text style={{ color: C.warning, fontWeight: "700" }}>
              LATE vs leave-by — cut or replan
            </Text>
          </View>
        )}

        {data.runState === "side_trip" && (
          <View
            style={{
              borderWidth: 1,
              borderColor: C.info + "88",
              padding: 12,
              borderRadius: R.md,
              gap: 8,
            }}
          >
            <Text style={{ color: C.info, fontWeight: "700" }}>
              Exploring (side trip)
            </Text>
            <Pressable
              onPress={() => {
                setReplanReason("side_trip");
                setReplanOpen(true);
              }}
            >
              <Text style={{ color: C.fg, textDecorationLine: "underline" }}>
                Replan from here
              </Text>
            </Pressable>
          </View>
        )}

        {/* Hero */}
        <View
          style={{
            borderWidth: 1,
            borderColor: C.border,
            backgroundColor: C.surface,
            borderRadius: R.md,
            padding: 16,
            gap: 8,
          }}
        >
          <Text style={{ color: C.fg, fontSize: 22, fontWeight: "800" }}>
            {data.day?.title ?? "No day plan"}
          </Text>
          {data.day?.heroTitle ? (
            <Text style={{ color: C.success, fontSize: 16, fontWeight: "700" }}>
              ★ {data.day.heroTitle}
            </Text>
          ) : null}
          {data.day?.heroDetail && showFull ? (
            <Text style={{ color: C.muted, fontSize: 14, lineHeight: 20 }}>
              {data.day.heroDetail}
            </Text>
          ) : null}
          {data.day?.cutIfBehind ? (
            <Text style={{ color: C.warning, fontSize: 13 }}>
              Cut if behind: {data.day.cutIfBehind}
            </Text>
          ) : null}
        </View>

        {/* Leave-by */}
        {data.leaveBy && (
          <View
            style={{
              borderWidth: 1,
              borderColor: late ? C.warning : C.border,
              backgroundColor: C.surface,
              borderRadius: R.md,
              padding: 16,
              gap: 4,
            }}
          >
            <Text
              style={{
                color: C.muted,
                fontSize: 11,
                fontWeight: "700",
                letterSpacing: 1,
              }}
            >
              LEAVE-BY
            </Text>
            <Text
              style={{
                color: late ? C.warning : C.fg,
                fontSize: 32,
                fontFamily: mono,
                fontWeight: "700",
              }}
            >
              {data.leaveBy.leaveByLocal}
            </Text>
            <Text style={{ color: C.muted, fontSize: 13 }}>
              {data.leaveBy.reason}
            </Text>
            <Text style={{ color: C.muted, fontSize: 12, fontFamily: mono }}>
              Slack {data.leaveBy.minutesSlack} min · target{" "}
              {data.leaveBy.target}
            </Text>
          </View>
        )}

        {/* Tonight */}
        <View
          style={{
            borderWidth: 1,
            borderColor: C.border,
            backgroundColor: C.surface,
            borderRadius: R.md,
            padding: 16,
            gap: 8,
          }}
        >
          <Text style={{ color: C.muted, fontSize: 11, fontWeight: "700" }}>
            TONIGHT
          </Text>
          <Text style={{ color: C.fg, fontSize: 17, fontWeight: "700" }}>
            {data.day?.overnightName ?? "No overnight set"}
          </Text>
          {data.day?.overnightKind ? (
            <Text style={{ color: C.muted, fontSize: 13 }}>
              {data.day.overnightKind}
            </Text>
          ) : null}
          {data.actions.navigateOvernight && (
            <Pressable
              onPress={() =>
                openMaps(
                  data.actions.navigateOvernight!.lat,
                  data.actions.navigateOvernight!.lng,
                  data.actions.navigateOvernight!.label,
                )
              }
              style={{
                marginTop: 4,
                borderWidth: 1,
                borderColor: C.info + "66",
                paddingVertical: 10,
                alignItems: "center",
              }}
            >
              <Text style={{ color: C.info, fontWeight: "700" }}>
                Navigate to sleep
              </Text>
            </Pressable>
          )}
        </View>

        {showFull && (data.serviceQueue?.length ?? 0) > 0 && (
          <View
            style={{
              borderWidth: 1,
              borderColor: C.border,
              backgroundColor: C.surface,
              borderRadius: R.md,
              padding: 16,
              gap: 8,
            }}
          >
            <Text style={{ color: C.muted, fontSize: 11, fontWeight: "700" }}>
              SERVICE QUEUE
            </Text>
            {data.serviceQueue.map((s, i) => (
              <Pressable
                key={`${s.kind}-${s.name}`}
                onPress={() => openMaps(s.lat, s.lng, s.name)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  paddingVertical: 4,
                }}
              >
                <Text
                  style={{
                    color: C.info,
                    fontFamily: mono,
                    fontSize: 13,
                    width: 20,
                  }}
                >
                  {i + 1}.
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.fg, fontSize: 14, fontWeight: "600" }}>
                    {s.kind.toUpperCase()} · {s.name}
                  </Text>
                  <Text style={{ color: C.muted, fontSize: 12 }}>
                    {s.milesAway} mi · {s.reason}
                  </Text>
                </View>
                <Ionicons name="navigate-outline" size={16} color={C.info} />
              </Pressable>
            ))}
            {data.amenities?.warnings.slice(0, 3).map((w) => (
              <Text key={w} style={{ color: C.warning, fontSize: 12 }}>
                ⚠ {w}
              </Text>
            ))}
          </View>
        )}

        {showFull && data.tomorrow && (
          <View style={{ paddingVertical: 4 }}>
            <Text style={{ color: C.muted, fontSize: 12 }}>
              Tomorrow · {data.tomorrow.title ?? data.tomorrow.date} ·{" "}
              {data.tomorrow.intent}
              {data.tomorrow.driveMilesEstimate != null
                ? ` · ~${data.tomorrow.driveMilesEstimate} mi`
                : ""}
            </Text>
          </View>
        )}

        {showFull && data.nextAnchor && (
          <Text style={{ color: C.muted, fontSize: 12 }}>
            Next anchor: {data.nextAnchor.title} in {data.nextAnchor.daysAway}d (
            {data.nextAnchor.startDate})
          </Text>
        )}

        {/* Actions */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <ActionBtn
            label="Done"
            onPress={() => markDone("done")}
            tone={C.success}
          />
          <ActionBtn
            label="Partial"
            onPress={() => markDone("partial")}
            tone={C.warning}
          />
          <ActionBtn
            label="Log fuel"
            onPress={() => {
              if (data.lastFuel?.odometerMiles != null) {
                setOdo(String(Math.round(data.lastFuel.odometerMiles)));
              }
              setFuelOpen(true);
            }}
            tone={C.warning}
          />
          <ActionBtn
            label="Replan…"
            onPress={() => {
              setReplanReason(late ? "behind" : "manual");
              setReplanOpen(true);
            }}
            tone={C.info}
          />
        </View>

        {showFull && data.lastFuel && (
          <Text style={{ color: C.muted, fontSize: 11, fontFamily: mono }}>
            Last fill
            {data.lastFuel.odometerMiles != null
              ? ` · odo ${Math.round(data.lastFuel.odometerMiles)}`
              : ""}
            {data.lastFuel.gallons != null
              ? ` · ${data.lastFuel.gallons} gal`
              : ""}
          </Text>
        )}

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <ActionBtn
            label="Day plan"
            onPress={() => go("/trip/[tripId]/day-plan", { date: data.date })}
          />
          <ActionBtn
            label="Drive"
            onPress={() => go("/trip/[tripId]/drive")}
          />
          <ActionBtn
            label="Map"
            onPress={() => go("/trip/[tripId]/map")}
          />
          <ActionBtn
            label="Log stop"
            onPress={() => go("/trip/[tripId]/log-stop")}
          />
        </View>

        {data.sideTrip?.offRoute && data.runState === "on_plan" && (
          <View
            style={{
              borderWidth: 1,
              borderColor: C.warning + "99",
              padding: 14,
              gap: 8,
              borderRadius: R.md,
            }}
          >
            <Text style={{ color: C.warning, fontWeight: "700" }}>
              Off plan · {data.sideTrip.milesFromRoute.toFixed(1)} mi
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <ActionBtn
                label="Explore"
                onPress={() =>
                  setRunState.mutate({
                    workspaceId,
                    tripId: tripId ?? "",
                    runState: "side_trip",
                    note: "Paused for side trip",
                  })
                }
                tone={C.warning}
              />
              <ActionBtn
                label="Replan from here"
                onPress={() => {
                  setReplanReason("side_trip");
                  setReplanOpen(true);
                }}
                tone={C.info}
              />
            </View>
          </View>
        )}
      </ScrollView>

      <Modal visible={fuelOpen} animationType="slide" transparent>
        <View
          style={{
            flex: 1,
            backgroundColor: "#000000aa",
            justifyContent: "flex-end",
          }}
        >
          <View
            style={{
              backgroundColor: C.bg,
              borderTopWidth: 1,
              borderColor: C.border,
              padding: 16,
              gap: 12,
            }}
          >
            <Text style={{ color: C.fg, fontSize: 18, fontWeight: "800" }}>
              Quick fuel log
            </Text>
            <Text style={{ color: C.muted, fontSize: 12 }}>
              Odometer (optional) · gallons · $/gal. Total computed.
            </Text>
            <TextInput
              value={odo}
              onChangeText={setOdo}
              placeholder="Odometer miles"
              placeholderTextColor={C.muted}
              keyboardType="decimal-pad"
              style={{
                borderWidth: 1,
                borderColor: C.border,
                color: C.fg,
                fontFamily: mono,
                padding: 12,
              }}
            />
            <TextInput
              value={gallons}
              onChangeText={setGallons}
              placeholder="Gallons"
              placeholderTextColor={C.muted}
              keyboardType="decimal-pad"
              style={{
                borderWidth: 1,
                borderColor: C.border,
                color: C.fg,
                fontFamily: mono,
                padding: 12,
              }}
            />
            <TextInput
              value={ppg}
              onChangeText={setPpg}
              placeholder="Price per gallon"
              placeholderTextColor={C.muted}
              keyboardType="decimal-pad"
              style={{
                borderWidth: 1,
                borderColor: C.border,
                color: C.fg,
                fontFamily: mono,
                padding: 12,
              }}
            />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                onPress={() => setFuelOpen(false)}
                style={{ flex: 1, padding: 14, alignItems: "center" }}
              >
                <Text style={{ color: C.muted }}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={logFuel.isPending}
                onPress={() => {
                  const g = Number(gallons);
                  const p = Number(ppg);
                  if (!(g > 0) || !(p > 0)) {
                    Alert.alert("Need gallons and price");
                    return;
                  }
                  const totalCents = Math.round(g * p * 100);
                  logFuel.mutate({
                    workspaceId,
                    tripId: tripId ?? "",
                    gallons: g,
                    pricePerGallon: p,
                    totalCents,
                    odometerMiles: odo ? Number(odo) : undefined,
                    stationLat: coords?.lat,
                    stationLng: coords?.lng,
                    loggedAt: new Date().toISOString(),
                    fuelType: "gas",
                    splitWithGroup: false,
                  });
                }}
                style={{
                  flex: 1,
                  padding: 14,
                  alignItems: "center",
                  borderWidth: 1,
                  borderColor: C.warning,
                  backgroundColor: C.warning + "22",
                }}
              >
                <Text style={{ color: C.warning, fontWeight: "800" }}>
                  {logFuel.isPending ? "Saving…" : "Save fill"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={replanOpen} animationType="slide" transparent>
        <View
          style={{
            flex: 1,
            backgroundColor: "#000000aa",
            justifyContent: "flex-end",
          }}
        >
          <View
            style={{
              backgroundColor: C.bg,
              borderTopWidth: 1,
              borderColor: C.border,
              padding: 16,
              maxHeight: "80%",
              gap: 12,
            }}
          >
            <Text style={{ color: C.fg, fontSize: 18, fontWeight: "800" }}>
              Reality replan
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {(
                [
                  ["behind", "Behind"],
                  ["side_trip", "Side trip"],
                  ["stayed", "Stayed"],
                  ["manual", "Manual"],
                ] as const
              ).map(([k, label]) => (
                <Pressable
                  key={k}
                  onPress={() => setReplanReason(k)}
                  style={{
                    borderWidth: 1,
                    borderColor: replanReason === k ? C.info : C.border,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                  }}
                >
                  <Text
                    style={{
                      color: replanReason === k ? C.info : C.muted,
                      fontWeight: "700",
                      fontSize: 13,
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {previewLoading && <ActivityIndicator color={C.info} />}
            {preview && (
              <ScrollView style={{ maxHeight: 220 }}>
                <Text style={{ color: C.fg, fontSize: 14, marginBottom: 8 }}>
                  {preview.summary}
                </Text>
                {preview.warnings.map((w) => (
                  <Text
                    key={w}
                    style={{ color: C.warning, fontSize: 12, marginBottom: 4 }}
                  >
                    ⚠ {w}
                  </Text>
                ))}
                {preview.draftDays.slice(0, 8).map((d) => (
                  <Text
                    key={d.date}
                    style={{
                      color: C.muted,
                      fontFamily: mono,
                      fontSize: 12,
                    }}
                  >
                    {d.date} · {d.intent} · {d.title ?? "—"}
                  </Text>
                ))}
              </ScrollView>
            )}

            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                onPress={() => setReplanOpen(false)}
                style={{ flex: 1, padding: 14, alignItems: "center" }}
              >
                <Text style={{ color: C.muted }}>Discard</Text>
              </Pressable>
              <Pressable
                disabled={applyReplan.isPending || !preview}
                onPress={() =>
                  applyReplan.mutate({
                    workspaceId,
                    tripId: tripId ?? "",
                    reason: replanReason,
                    mode: "soft_route",
                    fromDate: preview?.fromDate,
                    origin: coords
                      ? {
                          lat: coords.lat,
                          lng: coords.lng,
                          name: "Current location",
                        }
                      : undefined,
                    autoAssignOvernights: true,
                  })
                }
                style={{
                  flex: 1,
                  padding: 14,
                  alignItems: "center",
                  borderWidth: 1,
                  borderColor: C.info,
                  backgroundColor: C.info + "22",
                }}
              >
                <Text style={{ color: C.info, fontWeight: "800" }}>
                  {applyReplan.isPending ? "Applying…" : "Accept"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ActionBtn({
  label,
  onPress,
  tone,
}: {
  label: string;
  onPress: () => void;
  tone?: string;
}) {
  const color = tone ?? C.fg;
  return (
    <Pressable
      onPress={onPress}
      style={{
        borderWidth: 1,
        borderColor: color + "66",
        paddingHorizontal: 12,
        paddingVertical: 10,
        minHeight: 44,
        justifyContent: "center",
      }}
    >
      <Text style={{ color, fontWeight: "700", fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}
