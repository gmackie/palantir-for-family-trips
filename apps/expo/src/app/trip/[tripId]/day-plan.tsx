import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Location from "expo-location";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { trpc } from "~/utils/api";
import { C, mono, R } from "~/utils/design";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

const INTENTS = ["play", "drive", "position", "event", "recovery"] as const;
const OVERNIGHT_KINDS = [
  "dispersed",
  "campground",
  "hotel",
  "unknown",
] as const;

const INTENT_COLOR: Record<string, string> = {
  play: C.success,
  drive: C.info,
  position: C.warning,
  event: "#A371F7",
  recovery: C.muted,
};

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function formatShort(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

type DayRow = {
  id: string;
  date: string;
  intent: string;
  title: string | null;
  overnightName: string | null;
  overnightKind: string | null;
  heroTitle: string | null;
  heroDetail: string | null;
  cutIfBehind: string | null;
  note: string | null;
};

export default function DayPlanScreen() {
  "use no memo";
  const { tripId, date: focusDate } = useLocalSearchParams<{
    tripId: string;
    date?: string;
  }>();
  const router = useRouter();
  const workspaceId = getActiveWorkspaceId() ?? "";
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<"all" | "upcoming">("upcoming");
  const [editing, setEditing] = useState<DayRow | null>(null);
  const [openedFocus, setOpenedFocus] = useState(false);
  const [editForm, setEditForm] = useState({
    intent: "drive",
    title: "",
    overnightName: "",
    overnightKind: "",
    heroTitle: "",
    heroDetail: "",
    cutIfBehind: "",
    note: "",
  });

  const tid = tripId ?? "";

  const { data: days, isLoading } = useQuery(
    trpc.planner.listDays.queryOptions({ workspaceId, tripId: tid }),
  );
  const { data: anchors } = useQuery(
    trpc.anchors.list.queryOptions({ workspaceId, tripId: tid }),
  );
  const { data: nextAnchor } = useQuery(
    trpc.anchors.next.queryOptions({ workspaceId, tripId: tid }),
  );
  const { data: planMap } = useQuery(
    trpc.planner.getPlanMap.queryOptions({ workspaceId, tripId: tid }),
  );

  const invalidate = () => {
    void queryClient.invalidateQueries(trpc.planner.listDays.queryFilter());
    void queryClient.invalidateQueries(trpc.planner.getPlanMap.queryFilter());
    void queryClient.invalidateQueries(trpc.anchors.list.queryFilter());
    void queryClient.invalidateQueries(trpc.anchors.next.queryFilter());
    void queryClient.invalidateQueries(trpc.trips.listSegments.queryFilter());
  };

  const applyDraft = useMutation(
    trpc.planner.applyDraft.mutationOptions({
      onSuccess: () => {
        invalidate();
        Alert.alert("Applied", "Jul 11–15 day plan saved.");
      },
      onError: (e) => Alert.alert("Error", e.message),
    }),
  );

  const planItinerary = useMutation(
    trpc.planner.planItinerary.mutationOptions({
      onSuccess: (r) => {
        invalidate();
        const kept =
          r.keptPastDays > 0 ? `\nKept ${r.keptPastDays} past day(s).` : "";
        const gps = r.usedLiveOrigin ? "\nUsed live GPS as origin." : "";
        Alert.alert(
          "Plan updated",
          `${r.dayCount} days · ${r.segmentCount} legs · ${r.totalMiles} mi · ${r.anchorCount} anchors${kept}${gps}`,
        );
      },
      onError: (e) => Alert.alert("Error", e.message),
    }),
  );

  async function replanFromGps() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Location", "Permission needed to replan from GPS.");
        return;
      }
      setBusy(true);
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      Alert.alert(
        "Replan from GPS?",
        `${loc.coords.latitude.toFixed(3)}, ${loc.coords.longitude.toFixed(3)}\nPast days stay. Next leg routes from here.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Replan",
            onPress: () =>
              planItinerary.mutate({
                workspaceId,
                tripId: tid,
                template: "open_sauce_full",
                replaceExisting: true,
                fromDate: todayUtc(),
                origin: {
                  lat: loc.coords.latitude,
                  lng: loc.coords.longitude,
                  name: "Current location",
                },
              }),
          },
        ],
      );
    } catch (e) {
      Alert.alert("GPS", e instanceof Error ? e.message : "Could not read GPS");
    } finally {
      setBusy(false);
    }
  }

  const upsertDay = useMutation(
    trpc.planner.upsertDay.mutationOptions({
      onSuccess: () => {
        invalidate();
        setEditing(null);
      },
      onError: (e) => Alert.alert("Error", e.message),
    }),
  );

  const deleteDay = useMutation(
    trpc.planner.deleteDay.mutationOptions({
      onSuccess: () => {
        invalidate();
        setEditing(null);
      },
      onError: (e) => Alert.alert("Error", e.message),
    }),
  );

  const createAnchor = useMutation(
    trpc.anchors.create.mutationOptions({
      onSuccess: () => invalidate(),
      onError: (e) => Alert.alert("Error", e.message),
    }),
  );

  const deleteAnchor = useMutation(
    trpc.anchors.delete.mutationOptions({
      onSuccess: () => invalidate(),
      onError: (e) => Alert.alert("Error", e.message),
    }),
  );

  const { data: overnightSuggest } = useQuery({
    ...trpc.planner.suggestOvernights.queryOptions({
      workspaceId,
      tripId: tid,
      date: editing?.date ?? todayUtc(),
      maxMiles: 25,
      limit: 10,
    }),
    enabled: !!editing?.date && !!workspaceId,
  });

  const applyOvernight = useMutation(
    trpc.planner.applyOvernight.mutationOptions({
      onSuccess: () => {
        invalidate();
        Alert.alert("Overnight set", "iOverlander sleep location applied.");
      },
      onError: (e) => Alert.alert("Error", e.message),
    }),
  );

  const autoAssign = useMutation(
    trpc.planner.autoAssignOvernights.mutationOptions({
      onSuccess: (r) => {
        invalidate();
        Alert.alert(
          "Sleep assigned",
          `${r.assigned} night(s). Skipped ${r.skipped}, none found ${r.none}.`,
        );
      },
      onError: (e) => Alert.alert("Error", e.message),
    }),
  );

  const { data: amenityScan } = useQuery(
    trpc.planner.scanAmenities.queryOptions({
      workspaceId,
      tripId: tid,
      maxMiles: 25,
    }),
  );

  const today = todayUtc();
  const dayList = (days ?? []) as DayRow[];
  const filtered = useMemo(() => {
    if (filter === "upcoming") return dayList.filter((d) => d.date >= today);
    return dayList;
  }, [dayList, filter, today]);

  const playCount = dayList.filter((d) => d.intent === "play").length;

  function openEdit(d: DayRow) {
    setEditForm({
      intent: d.intent,
      title: d.title ?? "",
      overnightName: d.overnightName ?? "",
      overnightKind: d.overnightKind ?? "",
      heroTitle: d.heroTitle ?? "",
      heroDetail: d.heroDetail ?? "",
      cutIfBehind: d.cutIfBehind ?? "",
      note: d.note ?? "",
    });
    setEditing(d);
  }

  // Open editor when navigated from map callout with ?date=
  useEffect(() => {
    if (openedFocus || !focusDate || dayList.length === 0) return;
    const match = dayList.find((d) => d.date === focusDate);
    if (match) {
      openEdit(match);
      setOpenedFocus(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once on focusDate
  }, [focusDate, dayList, openedFocus]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries(trpc.planner.listDays.queryFilter()),
        queryClient.invalidateQueries(trpc.planner.getPlanMap.queryFilter()),
        queryClient.invalidateQueries(trpc.anchors.list.queryFilter()),
        queryClient.invalidateQueries(trpc.anchors.next.queryFilter()),
      ]);
    } finally {
      setRefreshing(false);
    }
  }

  function saveEdit() {
    if (!editing || !workspaceId) return;
    upsertDay.mutate({
      workspaceId,
      tripId: tid,
      date: editing.date,
      intent: editForm.intent as (typeof INTENTS)[number],
      title: editForm.title.trim() || null,
      overnightName: editForm.overnightName.trim() || null,
      overnightKind: (editForm.overnightKind || null) as
        | (typeof OVERNIGHT_KINDS)[number]
        | null,
      heroTitle: editForm.heroTitle.trim() || null,
      heroDetail: editForm.heroDetail.trim() || null,
      cutIfBehind: editForm.cutIfBehind.trim() || null,
      note: editForm.note.trim() || null,
    });
  }

  async function applyTemplate() {
    if (!workspaceId || !tid) return;
    setBusy(true);
    try {
      const draft = await queryClient.fetchQuery(
        trpc.planner.replanDraft.queryOptions({
          workspaceId,
          tripId: tid,
          fromDate: "2026-07-11",
          untilDate: "2026-07-15",
          template: "open_sauce_approach",
        }),
      );
      applyDraft.mutate({ workspaceId, tripId: tid, days: draft });
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (!workspaceId || !tid) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, padding: 16 }}>
        <Text style={{ color: C.muted }}>Missing trip context</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: "Day plan",
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.fg,
        }}
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={C.info}
          />
        }
      >
        {/* Summary */}
        <View
          style={{
            flexDirection: "row",
            gap: 10,
          }}
        >
          <SummaryChip
            label="Days"
            value={String(dayList.length)}
            color={C.info}
          />
          <SummaryChip
            label="Play"
            value={String(playCount)}
            color={C.success}
          />
          <SummaryChip
            label="Miles"
            value={
              planMap?.totalMiles ? String(Math.round(planMap.totalMiles)) : "—"
            }
            color={C.warning}
          />
        </View>

        {nextAnchor && (
          <View
            style={{
              borderWidth: 1,
              borderColor: nextAnchor.behind
                ? C.critical + "60"
                : C.warning + "40",
              backgroundColor: C.surface,
              padding: 12,
              borderRadius: R.sm,
            }}
          >
            <Text style={{ color: C.warning, fontSize: 10, fontWeight: "800" }}>
              NEXT ANCHOR
            </Text>
            <Text
              style={{
                color: C.fg,
                fontSize: 15,
                fontWeight: "600",
                marginTop: 4,
              }}
            >
              {nextAnchor.anchor.title}
            </Text>
            <Text
              style={{
                color: C.muted,
                fontFamily: mono,
                fontSize: 12,
                marginTop: 2,
              }}
            >
              {nextAnchor.daysUntil}d
              {nextAnchor.milesAway != null
                ? ` · ${nextAnchor.milesAway} mi`
                : ""}
              {nextAnchor.milesPerDay != null
                ? ` · ~${nextAnchor.milesPerDay} mi/day`
                : ""}
              {nextAnchor.behind ? " · BEHIND" : ""}
            </Text>
          </View>
        )}

        <Pressable
          onPress={() => {
            Alert.alert(
              "Build full map plan?",
              "Hood → coast → Open Sauce → Yosemite → Bryce → Moab. Replaces existing segments, days, and anchors.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Build",
                  onPress: () =>
                    planItinerary.mutate({
                      workspaceId,
                      tripId: tid,
                      template: "open_sauce_full",
                      replaceExisting: true,
                    }),
                },
              ],
            );
          }}
          disabled={planItinerary.isPending}
          style={{
            backgroundColor: C.success,
            padding: 14,
            borderRadius: R.sm,
            opacity: planItinerary.isPending ? 0.5 : 1,
          }}
        >
          <Text
            style={{
              color: C.bg,
              fontSize: 11,
              fontWeight: "900",
              letterSpacing: 1,
              textTransform: "uppercase",
              textAlign: "center",
            }}
          >
            {planItinerary.isPending
              ? "Routing…"
              : "Build full map plan (→ Moab)"}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => {
            Alert.alert(
              "Replan from today?",
              `Past days stay as-is. Rebuild remaining stops from ${today}.`,
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Replan",
                  onPress: () =>
                    planItinerary.mutate({
                      workspaceId,
                      tripId: tid,
                      template: "open_sauce_full",
                      replaceExisting: true,
                      fromDate: today,
                    }),
                },
              ],
            );
          }}
          disabled={planItinerary.isPending}
          style={{
            backgroundColor: C.warning + "18",
            borderWidth: 1,
            borderColor: C.warning + "50",
            padding: 12,
            borderRadius: R.sm,
            opacity: planItinerary.isPending ? 0.5 : 1,
          }}
        >
          <Text
            style={{
              color: C.warning,
              fontSize: 11,
              fontWeight: "900",
              letterSpacing: 1,
              textTransform: "uppercase",
              textAlign: "center",
            }}
          >
            Replan from today
          </Text>
        </Pressable>

        <Pressable
          onPress={() => void replanFromGps()}
          disabled={planItinerary.isPending || busy}
          style={{
            backgroundColor: C.info + "18",
            borderWidth: 1,
            borderColor: C.info + "50",
            padding: 12,
            borderRadius: R.sm,
            opacity: planItinerary.isPending || busy ? 0.5 : 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <Ionicons name="navigate" size={14} color={C.info} />
          <Text
            style={{
              color: C.info,
              fontSize: 11,
              fontWeight: "900",
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            {busy ? "Reading GPS…" : "Replan from GPS"}
          </Text>
        </Pressable>

        <Pressable
          onPress={() =>
            Alert.alert(
              "Auto-assign sleep?",
              "Pick best iOverlander overnight for each night (skips hotels). Import your CSV on web if empty.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Assign",
                  onPress: () =>
                    autoAssign.mutate({
                      workspaceId,
                      tripId: tid,
                      maxMiles: 20,
                    }),
                },
              ],
            )
          }
          disabled={autoAssign.isPending}
          style={{
            backgroundColor: C.success + "18",
            borderWidth: 1,
            borderColor: C.success + "50",
            padding: 12,
            borderRadius: R.sm,
            opacity: autoAssign.isPending ? 0.5 : 1,
          }}
        >
          <Text
            style={{
              color: C.success,
              fontSize: 11,
              fontWeight: "900",
              letterSpacing: 1,
              textTransform: "uppercase",
              textAlign: "center",
            }}
          >
            {autoAssign.isPending
              ? "Assigning sleep…"
              : "Auto-assign iOverlander sleep"}
          </Text>
        </Pressable>

        {(amenityScan?.length ?? 0) > 0 && (
          <View style={{ gap: 8 }}>
            <Text
              style={{
                color: C.muted,
                fontSize: 10,
                fontWeight: "900",
                letterSpacing: 2,
              }}
            >
              AMENITY SCAN
            </Text>
            {amenityScan?.slice(0, 8).map((r) => (
              <View
                key={r.date}
                style={{
                  borderWidth: 1,
                  borderColor: C.border,
                  borderRadius: R.sm,
                  padding: 10,
                  gap: 2,
                }}
              >
                <Text style={{ color: C.fg, fontWeight: "700", fontSize: 13 }}>
                  {r.date} · {r.placeName}
                </Text>
                <Text
                  style={{ color: C.muted, fontFamily: mono, fontSize: 11 }}
                >
                  {[
                    r.overnight
                      ? `sleep ${r.overnight.milesAway}mi`
                      : "no sleep",
                    r.fuel ? `fuel ${r.fuel.milesAway}mi` : null,
                    r.dump ? `dump ${r.dump.milesAway}mi` : null,
                    r.tolls.length ? `toll×${r.tolls.length}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
                {r.warnings.slice(0, 1).map((w) => (
                  <Text key={w} style={{ color: C.warning, fontSize: 11 }}>
                    {w}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        )}

        <Pressable
          onPress={() => void applyTemplate()}
          disabled={busy || applyDraft.isPending}
          style={{
            backgroundColor: C.info + "18",
            padding: 12,
            borderRadius: R.sm,
            opacity: busy || applyDraft.isPending ? 0.5 : 1,
          }}
        >
          <Text
            style={{
              color: C.info,
              fontSize: 11,
              fontWeight: "900",
              letterSpacing: 1,
              textTransform: "uppercase",
              textAlign: "center",
            }}
          >
            {busy || applyDraft.isPending
              ? "Applying…"
              : "Days only: Jul 11–15"}
          </Text>
        </Pressable>

        {/* Filter */}
        <View style={{ flexDirection: "row", gap: 8 }}>
          {(["upcoming", "all"] as const).map((f) => (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: R.sm,
                backgroundColor: filter === f ? C.info + "22" : C.surface,
                borderWidth: 1,
                borderColor: filter === f ? C.info : C.border,
              }}
            >
              <Text
                style={{
                  color: filter === f ? C.info : C.muted,
                  fontSize: 11,
                  fontWeight: "800",
                  textTransform: "uppercase",
                }}
              >
                {f}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Horizontal day chips */}
        {dayList.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
          >
            {dayList.map((d) => {
              const isToday = d.date === today;
              const isPast = d.date < today;
              return (
                <Pressable
                  key={`chip-${d.id}`}
                  onPress={() => openEdit(d)}
                  style={{
                    minWidth: 96,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    borderRadius: R.sm,
                    borderWidth: 1,
                    borderColor: isToday
                      ? C.warning
                      : (INTENT_COLOR[d.intent] ?? C.info) + "66",
                    backgroundColor: (INTENT_COLOR[d.intent] ?? C.info) + "18",
                    opacity: isPast && !isToday ? 0.5 : 1,
                  }}
                >
                  <Text
                    style={{
                      color: C.muted,
                      fontFamily: mono,
                      fontSize: 10,
                    }}
                  >
                    {formatShort(d.date).replace(/,.*/, "")}
                  </Text>
                  <Text
                    style={{
                      color: C.fg,
                      fontSize: 12,
                      fontWeight: "700",
                      maxWidth: 100,
                    }}
                    numberOfLines={1}
                  >
                    {d.title ?? d.overnightName ?? "Day"}
                  </Text>
                  <Text
                    style={{
                      color: INTENT_COLOR[d.intent] ?? C.info,
                      fontSize: 9,
                      fontWeight: "900",
                      textTransform: "uppercase",
                    }}
                  >
                    {d.intent}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        <Text
          style={{
            color: C.muted,
            fontSize: 10,
            fontWeight: "900",
            letterSpacing: 2,
          }}
        >
          DAYS · TAP TO EDIT
        </Text>

        {isLoading ? (
          <ActivityIndicator color={C.info} />
        ) : filtered.length === 0 ? (
          <Text style={{ color: C.muted, fontSize: 13 }}>
            No trip days yet. Build the full map plan to start.
          </Text>
        ) : (
          filtered.map((d) => {
            const isToday = d.date === today;
            const isPast = d.date < today;
            return (
              <Pressable
                key={d.id}
                onPress={() => openEdit(d)}
                style={{
                  borderWidth: 1,
                  borderColor: isToday ? C.warning : C.border,
                  backgroundColor: C.surface,
                  padding: 12,
                  borderRadius: R.sm,
                  gap: 4,
                  opacity: isPast && !isToday ? 0.55 : 1,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <Text
                    style={{ color: C.muted, fontFamily: mono, fontSize: 11 }}
                  >
                    {formatShort(d.date)}
                  </Text>
                  {isToday && (
                    <Text
                      style={{
                        color: C.warning,
                        fontSize: 9,
                        fontWeight: "900",
                      }}
                    >
                      TODAY
                    </Text>
                  )}
                  <View
                    style={{
                      backgroundColor:
                        (INTENT_COLOR[d.intent] ?? C.info) + "22",
                      paddingHorizontal: 6,
                      paddingVertical: 2,
                      borderRadius: 2,
                    }}
                  >
                    <Text
                      style={{
                        color: INTENT_COLOR[d.intent] ?? C.info,
                        fontSize: 9,
                        fontWeight: "900",
                        letterSpacing: 1,
                        textTransform: "uppercase",
                      }}
                    >
                      {d.intent}
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={14}
                    color={C.muted}
                    style={{ marginLeft: "auto" }}
                  />
                </View>
                <Text style={{ color: C.fg, fontSize: 15, fontWeight: "600" }}>
                  {d.title ?? d.overnightName ?? "Untitled"}
                </Text>
                {d.heroTitle && (
                  <Text style={{ color: C.muted, fontSize: 12 }}>
                    ★ {d.heroTitle}
                  </Text>
                )}
                {d.cutIfBehind && (
                  <Text style={{ color: C.warning, fontSize: 11 }}>
                    Cut: {d.cutIfBehind}
                  </Text>
                )}
              </Pressable>
            );
          })
        )}

        <Text
          style={{
            color: C.muted,
            fontSize: 10,
            fontWeight: "900",
            letterSpacing: 2,
            marginTop: 8,
          }}
        >
          ANCHORS
        </Text>
        {(anchors?.length ?? 0) === 0 ? (
          <Text style={{ color: C.muted, fontSize: 13 }}>None yet</Text>
        ) : (
          anchors?.map((a) => (
            <View
              key={String(a.id)}
              style={{
                borderWidth: 1,
                borderColor: C.border,
                padding: 10,
                borderRadius: R.sm,
                flexDirection: "row",
                gap: 8,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={{ color: "#A371F7", fontSize: 10, fontWeight: "800" }}
                >
                  {String(a.kind).toUpperCase()}
                </Text>
                <Text style={{ color: C.fg, fontSize: 14, fontWeight: "600" }}>
                  {String(a.title)}
                </Text>
                <Text
                  style={{ color: C.muted, fontFamily: mono, fontSize: 11 }}
                >
                  {String(a.startDate)}
                  {a.endDate && a.endDate !== a.startDate
                    ? ` – ${String(a.endDate)}`
                    : ""}
                </Text>
              </View>
              <Pressable
                hitSlop={8}
                onPress={() =>
                  Alert.alert("Delete anchor?", String(a.title), [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Delete",
                      style: "destructive",
                      onPress: () =>
                        deleteAnchor.mutate({
                          workspaceId,
                          tripId: tid,
                          anchorId: String(a.id),
                        }),
                    },
                  ])
                }
              >
                <Ionicons name="trash-outline" size={18} color={C.critical} />
              </Pressable>
            </View>
          ))
        )}

        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            onPress={() =>
              createAnchor.mutate({
                workspaceId,
                tripId: tid,
                title: "Open Sauce",
                kind: "event",
                placeName: "San Mateo County Event Center",
                startDate: "2026-07-17",
                endDate: "2026-07-19",
              })
            }
            style={{
              flex: 1,
              borderWidth: 1,
              borderColor: "#A371F740",
              padding: 10,
              borderRadius: R.sm,
            }}
          >
            <Text
              style={{
                color: "#A371F7",
                fontSize: 11,
                fontWeight: "700",
                textAlign: "center",
              }}
            >
              + Open Sauce
            </Text>
          </Pressable>
          <Pressable
            onPress={() =>
              createAnchor.mutate({
                workspaceId,
                tripId: tid,
                title: "Ahwahnee",
                kind: "lodging",
                placeName: "The Ahwahnee, Yosemite Valley",
                startDate: "2026-07-23",
                endDate: "2026-07-23",
              })
            }
            style={{
              flex: 1,
              borderWidth: 1,
              borderColor: "#A371F740",
              padding: 10,
              borderRadius: R.sm,
            }}
          >
            <Text
              style={{
                color: "#A371F7",
                fontSize: 11,
                fontWeight: "700",
                textAlign: "center",
              }}
            >
              + Ahwahnee
            </Text>
          </Pressable>
        </View>

        <Pressable
          onPress={() =>
            router.push({
              pathname: "/trip/[tripId]/map" as any,
              params: { tripId: tid },
            })
          }
          style={{
            padding: 12,
            borderRadius: R.sm,
            borderWidth: 1,
            borderColor: C.border,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <Ionicons name="map-outline" size={16} color={C.info} />
          <Text style={{ color: C.info, fontWeight: "700", fontSize: 13 }}>
            Open route map
          </Text>
        </Pressable>
      </ScrollView>

      {/* Edit modal */}
      <Modal
        visible={!!editing}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setEditing(null)}
      >
        <View style={{ flex: 1, backgroundColor: C.bg }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              padding: 16,
              borderBottomWidth: 1,
              borderBottomColor: C.border,
            }}
          >
            <Pressable onPress={() => setEditing(null)}>
              <Text style={{ color: C.muted, fontSize: 15 }}>Cancel</Text>
            </Pressable>
            <Text style={{ color: C.fg, fontWeight: "700", fontSize: 15 }}>
              {editing ? formatShort(editing.date) : "Edit"}
            </Text>
            <Pressable onPress={saveEdit} disabled={upsertDay.isPending}>
              <Text style={{ color: C.info, fontWeight: "800", fontSize: 15 }}>
                {upsertDay.isPending ? "…" : "Save"}
              </Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
            <Text style={{ color: C.muted, fontSize: 11, fontWeight: "800" }}>
              INTENT
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {INTENTS.map((i) => (
                <Pressable
                  key={i}
                  onPress={() => setEditForm((f) => ({ ...f, intent: i }))}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 4,
                    backgroundColor:
                      editForm.intent === i
                        ? (INTENT_COLOR[i] ?? C.info) + "33"
                        : C.surface,
                    borderWidth: 1,
                    borderColor:
                      editForm.intent === i
                        ? (INTENT_COLOR[i] ?? C.info)
                        : C.border,
                  }}
                >
                  <Text
                    style={{
                      color: INTENT_COLOR[i] ?? C.info,
                      fontSize: 11,
                      fontWeight: "800",
                      textTransform: "uppercase",
                    }}
                  >
                    {i}
                  </Text>
                </Pressable>
              ))}
            </View>

            {(
              [
                ["Title / area", "title"],
                ["Overnight place", "overnightName"],
                ["Hero", "heroTitle"],
                ["Hero detail", "heroDetail"],
                ["Cut if behind", "cutIfBehind"],
                ["Note", "note"],
              ] as const
            ).map(([label, key]) => (
              <View key={key} style={{ gap: 4 }}>
                <Text
                  style={{ color: C.muted, fontSize: 11, fontWeight: "800" }}
                >
                  {label.toUpperCase()}
                </Text>
                <TextInput
                  value={editForm[key]}
                  onChangeText={(t) => setEditForm((f) => ({ ...f, [key]: t }))}
                  placeholderTextColor={C.placeholder}
                  style={{
                    backgroundColor: C.surface,
                    borderWidth: 1,
                    borderColor: C.border,
                    borderRadius: R.sm,
                    padding: 12,
                    color: C.fg,
                    fontSize: 15,
                  }}
                />
              </View>
            ))}

            <Text style={{ color: C.muted, fontSize: 11, fontWeight: "800" }}>
              OVERNIGHT KIND
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {OVERNIGHT_KINDS.map((k) => (
                <Pressable
                  key={k}
                  onPress={() =>
                    setEditForm((f) => ({
                      ...f,
                      overnightKind: f.overnightKind === k ? "" : k,
                    }))
                  }
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 4,
                    backgroundColor:
                      editForm.overnightKind === k ? C.info + "22" : C.surface,
                    borderWidth: 1,
                    borderColor:
                      editForm.overnightKind === k ? C.info : C.border,
                  }}
                >
                  <Text
                    style={{
                      color: editForm.overnightKind === k ? C.info : C.muted,
                      fontSize: 11,
                      fontWeight: "700",
                    }}
                  >
                    {k}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* iOverlander overnight picks */}
            <Text style={{ color: C.muted, fontSize: 11, fontWeight: "800" }}>
              SLEEP NEARBY (IOVERLANDER)
            </Text>
            {(overnightSuggest?.suggestions ?? []).length === 0 ? (
              <Text style={{ color: C.muted, fontSize: 13 }}>
                No sleep POIs nearby. Import your iOverlander CSV for this
                workspace, or set overnight coords on the day.
              </Text>
            ) : (
              (overnightSuggest?.suggestions ?? []).map((s) => (
                <Pressable
                  key={s.id}
                  onPress={() => {
                    if (!editing) return;
                    applyOvernight.mutate({
                      workspaceId,
                      tripId: tid,
                      date: editing.date,
                      poiId: s.id,
                    });
                  }}
                  style={{
                    borderWidth: 1,
                    borderColor: C.border,
                    borderRadius: R.sm,
                    padding: 10,
                    gap: 2,
                  }}
                >
                  <Text
                    style={{ color: C.fg, fontWeight: "700", fontSize: 14 }}
                  >
                    {s.name}
                  </Text>
                  <Text
                    style={{ color: C.muted, fontFamily: mono, fontSize: 11 }}
                  >
                    {s.category} · {s.milesAway} mi · tap to sleep here
                  </Text>
                </Pressable>
              ))
            )}

            {editing && (
              <Pressable
                onPress={() =>
                  Alert.alert("Delete day?", editing.date, [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Delete",
                      style: "destructive",
                      onPress: () =>
                        deleteDay.mutate({
                          workspaceId,
                          tripId: tid,
                          dayId: editing.id,
                        }),
                    },
                  ])
                }
                style={{
                  marginTop: 12,
                  padding: 14,
                  borderRadius: R.sm,
                  borderWidth: 1,
                  borderColor: C.critical + "50",
                }}
              >
                <Text
                  style={{
                    color: C.critical,
                    textAlign: "center",
                    fontWeight: "800",
                  }}
                >
                  Delete day
                </Text>
              </Pressable>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function SummaryChip(props: { label: string; value: string; color: string }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: C.surface,
        borderWidth: 1,
        borderColor: C.border,
        borderRadius: R.sm,
        padding: 10,
      }}
    >
      <Text
        style={{
          color: C.muted,
          fontSize: 9,
          fontWeight: "900",
          letterSpacing: 1,
        }}
      >
        {props.label.toUpperCase()}
      </Text>
      <Text
        style={{
          color: props.color,
          fontFamily: mono,
          fontSize: 18,
          fontWeight: "700",
          marginTop: 2,
        }}
      >
        {props.value}
      </Text>
    </View>
  );
}
