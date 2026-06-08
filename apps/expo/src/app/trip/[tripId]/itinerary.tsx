import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
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

const CATEGORIES = [
  { key: "meal" as const, label: "Meal", icon: "restaurant-outline" as const },
  {
    key: "activity" as const,
    label: "Activity",
    icon: "bicycle-outline" as const,
  },
  {
    key: "transport" as const,
    label: "Transport",
    icon: "car-outline" as const,
  },
  {
    key: "meeting_point" as const,
    label: "Meet-up",
    icon: "people-outline" as const,
  },
  {
    key: "free_time" as const,
    label: "Free Time",
    icon: "sunny-outline" as const,
  },
  {
    key: "other" as const,
    label: "Other",
    icon: "ellipsis-horizontal-outline" as const,
  },
] as const;

const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  meal: "restaurant-outline",
  activity: "bicycle-outline",
  transport: "car-outline",
  lodging: "bed-outline",
  free_time: "sunny-outline",
  meeting_point: "people-outline",
  other: "ellipsis-horizontal-outline",
};

const CATEGORY_COLORS: Record<string, string> = {
  meal: "#F97316",
  activity: C.info,
  transport: "#A78BFA",
  lodging: "#6EE7B7",
  free_time: "#FBBF24",
  meeting_point: "#F472B6",
  other: C.muted,
};

function formatTime(date: Date) {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDayHeader(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

type EventCategory =
  | "meal"
  | "activity"
  | "transport"
  | "lodging"
  | "free_time"
  | "meeting_point"
  | "other";

function CreateEventModal({
  visible,
  onClose,
  onSubmit,
  isPending,
  defaultDate,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: {
    title: string;
    category: EventCategory;
    description?: string;
    location?: string;
    startsAt: string;
    endsAt?: string;
  }) => void;
  isPending: boolean;
  defaultDate: string;
}) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<EventCategory>("activity");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("");

  const reset = () => {
    setTitle("");
    setCategory("activity");
    setDescription("");
    setLocation("");
    setDate(defaultDate);
    setStartTime("09:00");
    setEndTime("");
  };

  const canSubmit =
    title.trim().length > 0 && date.match(/^\d{4}-\d{2}-\d{2}$/);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
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
          <Pressable
            onPress={() => {
              reset();
              onClose();
            }}
            style={{ minWidth: 60 }}
          >
            <Text style={{ color: C.muted, fontSize: 16 }}>Cancel</Text>
          </Pressable>
          <Text style={{ color: C.fg, fontSize: 17, fontWeight: "600" }}>
            Add Event
          </Text>
          <View style={{ minWidth: 60 }} />
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1 }}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 16, gap: 16 }}
            keyboardShouldPersistTaps="handled"
          >
            <View>
              <Text style={labelStyle}>Category</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginHorizontal: -4 }}
              >
                {CATEGORIES.map((cat) => {
                  const active = category === cat.key;
                  return (
                    <Pressable
                      key={cat.key}
                      onPress={() => setCategory(cat.key)}
                      style={{
                        marginHorizontal: 4,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        borderRadius: R.md,
                        minHeight: 44,
                        ...(active
                          ? {
                              backgroundColor:
                                CATEGORY_COLORS[cat.key] ?? C.info,
                            }
                          : { borderWidth: 1, borderColor: C.border }),
                      }}
                    >
                      <Ionicons
                        name={cat.icon}
                        size={16}
                        color={active ? C.white : C.muted}
                      />
                      <Text
                        style={{
                          color: active ? C.white : C.fg,
                          fontSize: 13,
                          fontWeight: "500",
                        }}
                      >
                        {cat.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            <View>
              <Text style={labelStyle}>Title</Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="Dinner at Upstream Brewing"
                placeholderTextColor={C.placeholder}
                style={inputStyle}
              />
            </View>

            <View>
              <Text style={labelStyle}>Date</Text>
              <TextInput
                value={date}
                onChangeText={setDate}
                placeholder="2026-06-10"
                placeholderTextColor={C.placeholder}
                keyboardType="numbers-and-punctuation"
                style={{ ...inputStyle, fontFamily: mono }}
              />
            </View>

            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={labelStyle}>Start Time</Text>
                <TextInput
                  value={startTime}
                  onChangeText={setStartTime}
                  placeholder="09:00"
                  placeholderTextColor={C.placeholder}
                  keyboardType="numbers-and-punctuation"
                  style={{ ...inputStyle, fontFamily: mono }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={labelStyle}>End Time (optional)</Text>
                <TextInput
                  value={endTime}
                  onChangeText={setEndTime}
                  placeholder="11:00"
                  placeholderTextColor={C.placeholder}
                  keyboardType="numbers-and-punctuation"
                  style={{ ...inputStyle, fontFamily: mono }}
                />
              </View>
            </View>

            <View>
              <Text style={labelStyle}>Location (optional)</Text>
              <TextInput
                value={location}
                onChangeText={setLocation}
                placeholder="Lake Manawa State Park"
                placeholderTextColor={C.placeholder}
                style={inputStyle}
              />
            </View>

            <View>
              <Text style={labelStyle}>Notes (optional)</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Bring sunscreen..."
                placeholderTextColor={C.placeholder}
                multiline
                style={{
                  ...inputStyle,
                  minHeight: 80,
                  textAlignVertical: "top",
                }}
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>

        <View
          style={{
            padding: 16,
            paddingBottom: 36,
            borderTopWidth: 1,
            borderTopColor: C.border,
          }}
        >
          <Pressable
            onPress={() => {
              const startsAt = `${date}T${startTime || "00:00"}:00.000Z`;
              const endsAt = endTime ? `${date}T${endTime}:00.000Z` : undefined;
              onSubmit({
                title: title.trim(),
                category,
                description: description.trim() || undefined,
                location: location.trim() || undefined,
                startsAt,
                endsAt,
              });
              reset();
            }}
            disabled={!canSubmit || isPending}
            style={{
              backgroundColor: C.info,
              borderRadius: R.md,
              paddingVertical: 16,
              alignItems: "center",
              opacity: !canSubmit || isPending ? 0.5 : 1,
            }}
          >
            {isPending ? (
              <ActivityIndicator color={C.white} />
            ) : (
              <Text style={{ color: C.white, fontSize: 16, fontWeight: "600" }}>
                Add to Itinerary
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const labelStyle = {
  color: C.muted,
  fontSize: 11,
  fontWeight: "600" as const,
  textTransform: "uppercase" as const,
  letterSpacing: 1,
  marginBottom: 6,
};

const inputStyle = {
  borderWidth: 1,
  borderColor: C.border,
  backgroundColor: C.surface,
  borderRadius: R.md,
  padding: 14,
  color: C.fg,
  fontSize: 15,
};

export default function ItineraryScreen() {
  "use no memo";
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const workspaceId = getActiveWorkspaceId() ?? "";
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data: events, isLoading } = useQuery(
    trpc.itinerary.list.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
    }),
  );

  const createMutation = useMutation(
    trpc.itinerary.create.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.itinerary.list.queryFilter());
        setShowCreate(false);
      },
      onError: (err) => Alert.alert("Error", err.message),
    }),
  );

  const deleteMutation = useMutation(
    trpc.itinerary.delete.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.itinerary.list.queryFilter());
      },
    }),
  );

  const handleCreate = useCallback(
    (data: {
      title: string;
      category: EventCategory;
      description?: string;
      location?: string;
      startsAt: string;
      endsAt?: string;
    }) => {
      createMutation.mutate({
        workspaceId,
        tripId: tripId ?? "",
        ...data,
      });
    },
    [workspaceId, tripId, createMutation],
  );

  const groupedByDay = useMemo(() => {
    if (!events) return [];
    const groups: Record<string, Array<(typeof events)[number]>> = {};
    for (const ev of events) {
      const day = new Date(ev.startsAt).toISOString().slice(0, 10);
      if (!groups[day]) groups[day] = [];
      groups[day].push(ev);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [events]);

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: "Itinerary",
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.fg,
        }}
      />

      {isLoading ? (
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <ActivityIndicator size="large" color={C.muted} />
        </View>
      ) : groupedByDay.length === 0 ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 32,
            gap: 8,
          }}
        >
          <Ionicons name="calendar-outline" size={40} color={C.muted} />
          <Text style={{ color: C.muted, fontSize: 16 }}>No events yet</Text>
          <Text
            style={{
              color: C.muted,
              fontSize: 13,
              textAlign: "center",
              maxWidth: 260,
            }}
          >
            Add meals, activities, and meetup times so everyone knows the plan.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        >
          {groupedByDay.map(([day, dayEvents]) => (
            <View key={day} style={{ marginBottom: 24 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                <Text
                  style={{
                    color: day === todayStr ? C.info : C.fg,
                    fontSize: 16,
                    fontWeight: "700",
                  }}
                >
                  {formatDayHeader(day)}
                </Text>
                {day === todayStr && (
                  <View
                    style={{
                      backgroundColor: C.info,
                      borderRadius: R.sm,
                      paddingHorizontal: 6,
                      paddingVertical: 2,
                    }}
                  >
                    <Text
                      style={{
                        color: C.white,
                        fontSize: 10,
                        fontWeight: "700",
                      }}
                    >
                      TODAY
                    </Text>
                  </View>
                )}
              </View>

              {dayEvents.map((ev) => {
                const catColor = CATEGORY_COLORS[ev.category] ?? C.muted;
                const catIcon =
                  CATEGORY_ICONS[ev.category] ?? "ellipsis-horizontal-outline";

                return (
                  <Pressable
                    key={ev.id}
                    onLongPress={() =>
                      Alert.alert("Delete event?", ev.title, [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Delete",
                          style: "destructive",
                          onPress: () =>
                            deleteMutation.mutate({
                              workspaceId,
                              tripId: tripId ?? "",
                              eventId: ev.id,
                            }),
                        },
                      ])
                    }
                    style={{
                      flexDirection: "row",
                      gap: 12,
                      marginBottom: 8,
                    }}
                  >
                    {/* Timeline */}
                    <View
                      style={{
                        width: 50,
                        alignItems: "flex-end",
                        paddingTop: 2,
                      }}
                    >
                      <Text
                        style={{
                          color: C.muted,
                          fontSize: 12,
                          fontFamily: mono,
                        }}
                      >
                        {ev.allDay
                          ? "ALL DAY"
                          : formatTime(new Date(ev.startsAt))}
                      </Text>
                    </View>

                    {/* Dot + line */}
                    <View style={{ alignItems: "center", width: 20 }}>
                      <View
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 5,
                          backgroundColor: catColor,
                          marginTop: 4,
                        }}
                      />
                      <View
                        style={{
                          flex: 1,
                          width: 2,
                          backgroundColor: C.border,
                          marginTop: 2,
                        }}
                      />
                    </View>

                    {/* Card */}
                    <View
                      style={{
                        flex: 1,
                        borderWidth: 1,
                        borderColor: C.border,
                        backgroundColor: C.surface,
                        borderRadius: R.md,
                        padding: 12,
                        borderLeftWidth: 3,
                        borderLeftColor: catColor,
                      }}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <Ionicons name={catIcon} size={14} color={catColor} />
                        <Text
                          style={{
                            color: C.fg,
                            fontSize: 14,
                            fontWeight: "600",
                            flex: 1,
                          }}
                        >
                          {ev.title}
                        </Text>
                      </View>
                      {ev.location && (
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 4,
                            marginTop: 4,
                          }}
                        >
                          <Ionicons
                            name="location-outline"
                            size={12}
                            color={C.muted}
                          />
                          <Text
                            style={{ color: C.muted, fontSize: 12 }}
                            numberOfLines={1}
                          >
                            {ev.location}
                          </Text>
                        </View>
                      )}
                      {ev.description && (
                        <Text
                          style={{
                            color: C.muted,
                            fontSize: 12,
                            marginTop: 4,
                          }}
                          numberOfLines={2}
                        >
                          {ev.description}
                        </Text>
                      )}
                      {ev.endsAt && !ev.allDay && (
                        <Text
                          style={{
                            color: C.muted,
                            fontSize: 11,
                            fontFamily: mono,
                            marginTop: 4,
                          }}
                        >
                          until {formatTime(new Date(ev.endsAt))}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </ScrollView>
      )}

      {/* FAB */}
      <Pressable
        onPress={() => setShowCreate(true)}
        style={{
          position: "absolute",
          bottom: 36,
          right: 20,
          width: 52,
          height: 52,
          borderRadius: R.md,
          backgroundColor: C.info,
          alignItems: "center",
          justifyContent: "center",
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.18,
          shadowRadius: 2,
          elevation: 2,
        }}
      >
        <Ionicons name="add" size={28} color={C.white} />
      </Pressable>

      <CreateEventModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={handleCreate}
        isPending={createMutation.isPending}
        defaultDate={todayStr}
      />
    </View>
  );
}
