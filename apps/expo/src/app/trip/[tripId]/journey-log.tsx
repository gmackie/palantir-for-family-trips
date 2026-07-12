import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import type { RouterOutputs } from "~/utils/api";
import { trpc } from "~/utils/api";
import { getBaseUrl } from "~/utils/base-url";
import { C, mono, R } from "~/utils/design";
import type { JourneyOutboxEntry } from "~/utils/journey-outbox";
import { journeyOutbox } from "~/utils/journey-outbox-native";
import { mergeJourneyTimeline } from "~/utils/journey-timeline";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

type JourneyStop = RouterOutputs["journey"]["list"][number];

export default function JourneyLogScreen() {
  "use no memo";
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const workspaceId = getActiveWorkspaceId() ?? "";
  const router = useRouter();

  const stops = useQuery(
    trpc.journey.list.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
    }),
  );

  const ordered = [...(stops.data ?? [])].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  const [queued, setQueued] = useState<JourneyOutboxEntry[]>([]);

  useEffect(() => {
    void journeyOutbox.list().then(setQueued);
  }, []);

  const timelineIds = mergeJourneyTimeline(
    ordered.map((stop) => ({ id: stop.id, arrivedAt: stop.arrivedAt })),
    queued.map((entry) => entry.command),
  );
  const pending = timelineIds.filter(
    (item) => "syncState" in item && item.syncState === "queued",
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: "Journey Log",
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.fg,
        }}
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }}
      >
        <Pressable
          onPress={() =>
            router.push({
              pathname: "/trip/[tripId]/log-stop" as never,
              params: { tripId: tripId ?? "" },
            })
          }
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            borderWidth: 1,
            borderColor: C.success,
            backgroundColor: C.successBg,
            borderRadius: R.md,
            paddingVertical: 14,
            minHeight: 48,
          }}
        >
          <Ionicons name="add-circle-outline" size={18} color={C.success} />
          <Text style={{ color: C.success, fontSize: 16, fontWeight: "700" }}>
            Log a stop
          </Text>
        </Pressable>

        {pending.map((item) => (
          <View
            key={item.id}
            style={{
              borderWidth: 1,
              borderColor: C.warning,
              backgroundColor: C.warningBg,
              borderRadius: R.md,
              padding: 14,
            }}
          >
            <Text style={{ color: C.fg, fontWeight: "700" }}>
              {"name" in item ? item.name : "Queued stop"}
            </Text>
            <Text style={{ color: C.warning, fontSize: 12 }}>
              Saved on this phone · waiting to sync
            </Text>
          </View>
        ))}

        {stops.isLoading ? (
          <ActivityIndicator size="small" color={C.muted} />
        ) : ordered.length === 0 ? (
          <Text style={{ color: C.muted, fontSize: 14, paddingVertical: 8 }}>
            No stops logged yet.
          </Text>
        ) : (
          ordered.map((seg) => (
            <StopRow
              key={seg.id}
              stop={seg}
              workspaceId={workspaceId}
              tripId={tripId ?? ""}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function StopRow({
  stop,
  workspaceId,
  tripId,
}: {
  stop: JourneyStop;
  workspaceId: string;
  tripId: string;
}) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(stop.name ?? "");
  const [date, setDate] = useState(
    new Date(stop.arrivedAt).toISOString().slice(0, 10),
  );
  const [note, setNote] = useState(stop.note ?? "");

  function invalidate() {
    void qc.invalidateQueries({
      queryKey: trpc.journey.list.queryKey({ workspaceId, tripId }),
    });
    void qc.invalidateQueries({
      queryKey: trpc.routePlanner.predictZones.queryKey({
        workspaceId,
        tripId,
      }),
    });
  }

  const update = useMutation(
    trpc.journey.updateStop.mutationOptions({
      onSuccess: () => {
        invalidate();
        setExpanded(false);
      },
      onError: (e) => Alert.alert("Couldn't update", e.message),
    }),
  );

  const del = useMutation(
    trpc.journey.deleteStop.mutationOptions({
      onSuccess: invalidate,
      onError: (e) => Alert.alert("Couldn't delete", e.message),
    }),
  );
  const move = useMutation(
    trpc.journey.moveStop.mutationOptions({
      onSuccess: invalidate,
      onError: (e) => Alert.alert("Couldn't reorder", e.message),
    }),
  );
  const retryRoute = useMutation(
    trpc.journey.retryRoute.mutationOptions({
      onSuccess: invalidate,
      onError: (e) => Alert.alert("Couldn't retry route", e.message),
    }),
  );

  const miles = stop.distanceMiles ? Math.round(Number(stop.distanceMiles)) : 0;

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
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          padding: 14,
        }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{ color: C.fg, fontSize: 15, fontWeight: "600" }}
            numberOfLines={1}
          >
            {stop.name}
          </Text>
          <Text
            style={{
              color: C.muted,
              fontSize: 12,
              fontFamily: mono,
              fontVariant: ["tabular-nums"],
            }}
          >
            {new Date(stop.arrivedAt).toLocaleDateString()} · {stop.kind} ·{" "}
            {miles} mi
          </Text>
        </View>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={16}
          color={C.muted}
        />
      </Pressable>

      {expanded && (
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: C.border,
            padding: 14,
            gap: 12,
          }}
        >
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Stop name"
            placeholderTextColor={C.placeholder}
            style={rowInput}
          />
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Note"
            placeholderTextColor={C.placeholder}
            multiline
            style={rowInput}
          />
          {stop.photos.length > 0 && (
            <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
              {stop.photos.map((photo) => (
                <Image
                  key={photo.id}
                  source={{
                    uri: `${getBaseUrl()}/api/storage/${photo.storageKey}`,
                  }}
                  style={{ width: 72, height: 72, borderRadius: R.sm }}
                />
              ))}
            </ScrollView>
          )}
          {stop.routeStatus === "pending" && (
            <Pressable
              onPress={() =>
                retryRoute.mutate({ workspaceId, tripId, stopId: stop.id })
              }
              style={{ paddingVertical: 8 }}
            >
              <Text style={{ color: C.warning, fontWeight: "700" }}>
                Route pending · tap to retry
              </Text>
            </Pressable>
          )}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              onPress={() =>
                move.mutate({
                  workspaceId,
                  tripId,
                  stopId: stop.id,
                  direction: "earlier",
                })
              }
              style={{ flex: 1, paddingVertical: 8, alignItems: "center" }}
            >
              <Text style={{ color: C.info }}>Move earlier</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                move.mutate({
                  workspaceId,
                  tripId,
                  stopId: stop.id,
                  direction: "later",
                })
              }
              style={{ flex: 1, paddingVertical: 8, alignItems: "center" }}
            >
              <Text style={{ color: C.info }}>Move later</Text>
            </Pressable>
          </View>
          <TextInput
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={C.placeholder}
            autoCapitalize="none"
            style={rowInput}
          />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable
              onPress={() =>
                update.mutate({
                  workspaceId,
                  tripId,
                  stopId: stop.id,
                  name: name.trim() || undefined,
                  date: date.trim() || undefined,
                  note: note.trim() || null,
                })
              }
              disabled={update.isPending}
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                borderRadius: R.md,
                paddingVertical: 12,
                minHeight: 44,
                backgroundColor: C.info,
              }}
            >
              {update.isPending ? (
                <ActivityIndicator size="small" color={C.bg} />
              ) : (
                <Ionicons name="save-outline" size={16} color={C.bg} />
              )}
              <Text style={{ color: C.bg, fontSize: 14, fontWeight: "700" }}>
                Save
              </Text>
            </Pressable>
            <Pressable
              onPress={() =>
                Alert.alert(
                  "Delete stop?",
                  "This removes it from your journey.",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Delete",
                      style: "destructive",
                      onPress: () =>
                        del.mutate({
                          workspaceId,
                          tripId,
                          stopId: stop.id,
                        }),
                    },
                  ],
                )
              }
              disabled={del.isPending}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                borderWidth: 1,
                borderColor: C.critical,
                borderRadius: R.md,
                paddingHorizontal: 16,
                paddingVertical: 12,
                minHeight: 44,
              }}
            >
              <Ionicons name="trash-outline" size={16} color={C.critical} />
              <Text
                style={{ color: C.critical, fontSize: 14, fontWeight: "700" }}
              >
                Delete
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const rowInput = {
  borderWidth: 1,
  borderColor: C.border,
  backgroundColor: C.input,
  borderRadius: R.md,
  paddingHorizontal: 12,
  paddingVertical: 10,
  minHeight: 44,
  color: C.fg,
  fontSize: 15,
} as const;
