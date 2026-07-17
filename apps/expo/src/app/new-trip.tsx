import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
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

type TripMode = "destination" | "roadtrip";

const TEMPLATES = [
  {
    key: "blank",
    label: "Start from scratch",
    icon: "add-circle-outline" as const,
    color: C.muted,
    mode: "destination" as TripMode,
    groupMode: false,
    name: "",
    destination: "",
  },
  {
    key: "reunion",
    label: "Family Reunion",
    icon: "people-outline" as const,
    color: "#F472B6",
    mode: "destination" as TripMode,
    // Reunion still uses group mode so expenses can split across households.
    groupMode: true,
    name: "Family Reunion",
    destination: "",
  },
  {
    key: "beach",
    label: "Beach Vacation",
    icon: "sunny-outline" as const,
    color: "#FBBF24",
    mode: "destination" as TripMode,
    groupMode: true,
    name: "Beach Trip",
    destination: "",
  },
  {
    key: "roadtrip",
    label: "Road Trip",
    icon: "car-outline" as const,
    color: "#A78BFA",
    mode: "roadtrip" as TripMode,
    groupMode: false,
    name: "Road Trip",
    destination: "",
  },
  {
    key: "ski",
    label: "Ski Trip",
    icon: "snow-outline" as const,
    color: "#6CB6FF",
    mode: "destination" as TripMode,
    groupMode: true,
    name: "Ski Trip",
    destination: "",
  },
  {
    key: "bachelor",
    label: "Bachelor/ette",
    icon: "sparkles-outline" as const,
    color: "#D2A8FF",
    mode: "destination" as TripMode,
    groupMode: true,
    name: "",
    destination: "",
  },
] as const;

const STEPS = ["template", "mode", "details", "dates"] as const;
type Step = (typeof STEPS)[number];

function StepIndicator({ current }: { current: Step }) {
  const idx = STEPS.indexOf(current);
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "center",
        gap: 8,
        marginBottom: 24,
      }}
    >
      {STEPS.map((s, i) => (
        <View
          key={s}
          style={{
            width: i <= idx ? 32 : 8,
            height: 4,
            borderRadius: R.sm,
            backgroundColor: i <= idx ? C.info : C.border,
          }}
        />
      ))}
    </View>
  );
}

function ModeStep({
  tripMode,
  onTripModeChange,
  groupMode,
  onGroupModeChange,
}: {
  tripMode: TripMode;
  onTripModeChange: (m: TripMode) => void;
  groupMode: boolean;
  onGroupModeChange: (v: boolean) => void;
}) {
  return (
    <View style={{ gap: 16 }}>
      <Text
        style={{
          color: C.fg,
          fontSize: 22,
          fontWeight: "bold",
          marginBottom: 4,
        }}
      >
        What kind of trip?
      </Text>
      <Text style={{ color: C.muted, fontSize: 15, marginBottom: 4 }}>
        Trip mode is the map and planning paradigm. Group mode controls expense
        splitting — they are independent.
      </Text>

      <Pressable
        onPress={() => onTripModeChange("destination")}
        style={{
          backgroundColor:
            tripMode === "destination" ? C.surface : "transparent",
          borderWidth: 2,
          borderColor: tripMode === "destination" ? C.info : C.border,
          borderRadius: R.md,
          padding: 20,
          gap: 6,
        }}
      >
        <Text style={{ color: C.fg, fontSize: 18, fontWeight: "600" }}>
          Destination
        </Text>
        <Text style={{ color: C.muted, fontSize: 15 }}>
          Fixed place — area map, lodging, arrivals
        </Text>
      </Pressable>

      <Pressable
        onPress={() => onTripModeChange("roadtrip")}
        style={{
          backgroundColor: tripMode === "roadtrip" ? C.surface : "transparent",
          borderWidth: 2,
          borderColor: tripMode === "roadtrip" ? C.warning : C.border,
          borderRadius: R.md,
          padding: 20,
          gap: 6,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: C.fg, fontSize: 18, fontWeight: "600" }}>
            Road Trip
          </Text>
          <View
            style={{
              backgroundColor: C.warningBg,
              borderRadius: R.md,
              paddingHorizontal: 6,
              paddingVertical: 2,
            }}
          >
            <Text
              style={{
                color: C.warning,
                fontSize: 10,
                fontWeight: "bold",
                letterSpacing: 0.5,
              }}
            >
              ROUTE
            </Text>
          </View>
        </View>
        <Text style={{ color: C.muted, fontSize: 15 }}>
          Route-based with fuel tracking and waypoints
        </Text>
      </Pressable>

      <Text
        style={{
          color: C.fg,
          fontSize: 18,
          fontWeight: "600",
          marginTop: 8,
        }}
      >
        Family or group?
      </Text>

      <Pressable
        onPress={() => onGroupModeChange(false)}
        style={{
          backgroundColor: !groupMode ? C.surface : "transparent",
          borderWidth: 2,
          borderColor: !groupMode ? C.info : C.border,
          borderRadius: R.md,
          padding: 20,
          gap: 6,
          minHeight: 56,
        }}
      >
        <Text style={{ color: C.fg, fontSize: 16, fontWeight: "600" }}>
          Family
        </Text>
        <Text style={{ color: C.muted, fontSize: 14 }}>
          Solo or household — no expense splitting
        </Text>
      </Pressable>

      <Pressable
        onPress={() => onGroupModeChange(true)}
        style={{
          backgroundColor: groupMode ? C.surface : "transparent",
          borderWidth: 2,
          borderColor: groupMode ? C.info : C.border,
          borderRadius: R.md,
          padding: 20,
          gap: 6,
          minHeight: 56,
        }}
      >
        <Text style={{ color: C.fg, fontSize: 16, fontWeight: "600" }}>
          Group
        </Text>
        <Text style={{ color: C.muted, fontSize: 14 }}>
          Shared members, receipt claims, and settlement
        </Text>
      </Pressable>
    </View>
  );
}

function DetailsStep({
  tripMode,
  name,
  onNameChange,
  destination,
  onDestinationChange,
}: {
  tripMode: TripMode;
  name: string;
  onNameChange: (v: string) => void;
  destination: string;
  onDestinationChange: (v: string) => void;
}) {
  return (
    <View style={{ gap: 20 }}>
      <Text
        style={{
          color: C.fg,
          fontSize: 22,
          fontWeight: "bold",
          marginBottom: 4,
        }}
      >
        {tripMode === "roadtrip" ? "Name your road trip" : "Trip details"}
      </Text>

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
          Trip Name
        </Text>
        <TextInput
          value={name}
          onChangeText={onNameChange}
          placeholder={
            tripMode === "roadtrip"
              ? "Seattle to Des Moines"
              : "Family Reunion 2026"
          }
          placeholderTextColor={C.placeholder}
          style={{
            backgroundColor: C.surface,
            borderWidth: 1,
            borderColor: C.border,
            borderRadius: R.md,
            padding: 14,
            color: C.fg,
            fontSize: 16,
          }}
          autoFocus
        />
      </View>

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
          {tripMode === "roadtrip" ? "Destination" : "Where to?"}
        </Text>
        <TextInput
          value={destination}
          onChangeText={onDestinationChange}
          placeholder="Omaha, NE"
          placeholderTextColor={C.placeholder}
          style={{
            backgroundColor: C.surface,
            borderWidth: 1,
            borderColor: C.border,
            borderRadius: R.md,
            padding: 14,
            color: C.fg,
            fontSize: 16,
          }}
        />
        <Text style={{ color: C.muted, fontSize: 12 }}>Optional</Text>
      </View>
    </View>
  );
}

function DatesStep({
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
  tz,
  onTzChange,
}: {
  startDate: string;
  onStartDateChange: (v: string) => void;
  endDate: string;
  onEndDateChange: (v: string) => void;
  tz: string;
  onTzChange: (v: string) => void;
}) {
  return (
    <View style={{ gap: 20 }}>
      <Text
        style={{
          color: C.fg,
          fontSize: 22,
          fontWeight: "bold",
          marginBottom: 4,
        }}
      >
        When?
      </Text>

      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1, gap: 6 }}>
          <Text
            style={{
              color: C.muted,
              fontSize: 11,
              fontWeight: "600",
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            Start Date
          </Text>
          <TextInput
            value={startDate}
            onChangeText={onStartDateChange}
            placeholder="2026-06-10"
            placeholderTextColor={C.placeholder}
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
            keyboardType="numbers-and-punctuation"
          />
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <Text
            style={{
              color: C.muted,
              fontSize: 11,
              fontWeight: "600",
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            End Date
          </Text>
          <TextInput
            value={endDate}
            onChangeText={onEndDateChange}
            placeholder="2026-06-15"
            placeholderTextColor={C.placeholder}
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
            keyboardType="numbers-and-punctuation"
          />
        </View>
      </View>

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
          Timezone
        </Text>
        <TextInput
          value={tz}
          onChangeText={onTzChange}
          placeholder="America/Chicago"
          placeholderTextColor={C.placeholder}
          style={{
            backgroundColor: C.surface,
            borderWidth: 1,
            borderColor: C.border,
            borderRadius: R.md,
            padding: 14,
            color: C.fg,
            fontSize: 16,
          }}
          autoCapitalize="none"
        />
      </View>

      <Text style={{ color: C.muted, fontSize: 12 }}>
        Dates and timezone are optional — you can set them later.
      </Text>
    </View>
  );
}

export default function NewTripScreen() {
  "use no memo";
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspaceId = getActiveWorkspaceId() ?? "";

  const [step, setStep] = useState<Step>("template");
  const [tripMode, setTripMode] = useState<TripMode>("destination");
  const [groupMode, setGroupMode] = useState(false);
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [tz, setTz] = useState("America/Chicago");
  const [error, setError] = useState<string | null>(null);

  const createTrip = useMutation(
    trpc.trips.create.mutationOptions({
      onSuccess: (data) => {
        void queryClient.invalidateQueries({
          queryKey: trpc.trips.list.queryKey({ workspaceId }),
        });
        router.replace({
          pathname: "/trip/[tripId]",
          params: { tripId: data.trip.id },
        });
      },
      onError: (err) => {
        setError(err.message);
      },
    }),
  );

  const stepIdx = STEPS.indexOf(step);

  function handleNext() {
    if (step === "template") {
      setStep("mode");
    } else if (step === "mode") {
      setStep("details");
    } else if (step === "details") {
      if (name.trim().length < 2) {
        setError("Trip name must be at least 2 characters");
        return;
      }
      setError(null);
      setStep("dates");
    } else if (step === "dates") {
      setError(null);
      createTrip.mutate({
        workspaceId,
        name: name.trim(),
        tripMode,
        groupMode,
        destinationName: destination.trim() || undefined,
        startDate: startDate.trim() || undefined,
        endDate: endDate.trim() || undefined,
        tz: tz.trim() || "UTC",
      });
    }
  }

  function handleBack() {
    setError(null);
    if (stepIdx > 0) {
      setStep(STEPS[stepIdx - 1]!);
    } else {
      router.back();
    }
  }

  const isLastStep = step === "dates";
  const nextLabel = isLastStep ? "Create Trip" : "Next";

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: "New Trip",
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
          contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
        >
          <StepIndicator current={step} />

          {step === "template" && (
            <View style={{ gap: 12 }}>
              <Text
                style={{
                  color: C.fg,
                  fontSize: 22,
                  fontWeight: "bold",
                  marginBottom: 4,
                }}
              >
                Start a trip
              </Text>
              <Text style={{ color: C.muted, fontSize: 15, marginBottom: 8 }}>
                Pick a template or start from scratch.
              </Text>
              {TEMPLATES.map((t) => (
                <Pressable
                  key={t.key}
                  onPress={() => {
                    if (t.name) setName(t.name);
                    if (t.destination) setDestination(t.destination);
                    setTripMode(t.mode);
                    setGroupMode(t.groupMode);
                    // Always visit mode so trip mode + group/family stay explicit.
                    setStep("mode");
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 14,
                    borderWidth: 1,
                    borderColor: C.border,
                    backgroundColor: C.surface,
                    borderRadius: R.md,
                    padding: 16,
                    minHeight: 56,
                  }}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      backgroundColor: `${t.color}22`,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name={t.icon} size={20} color={t.color} />
                  </View>
                  <Text
                    style={{
                      color: C.fg,
                      fontSize: 16,
                      fontWeight: "500",
                      flex: 1,
                    }}
                  >
                    {t.label}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={C.muted} />
                </Pressable>
              ))}
            </View>
          )}
          {step === "mode" && (
            <ModeStep
              tripMode={tripMode}
              onTripModeChange={setTripMode}
              groupMode={groupMode}
              onGroupModeChange={setGroupMode}
            />
          )}
          {step === "details" && (
            <DetailsStep
              tripMode={tripMode}
              name={name}
              onNameChange={setName}
              destination={destination}
              onDestinationChange={setDestination}
            />
          )}
          {step === "dates" && (
            <DatesStep
              startDate={startDate}
              onStartDateChange={setStartDate}
              endDate={endDate}
              onEndDateChange={setEndDate}
              tz={tz}
              onTzChange={setTz}
            />
          )}

          {error && (
            <Text style={{ color: C.critical, fontSize: 15, marginTop: 16 }}>
              {error}
            </Text>
          )}
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
            padding: 20,
            paddingBottom: 36,
            flexDirection: "row",
            gap: 12,
          }}
        >
          <Pressable
            onPress={handleBack}
            style={{
              flex: 1,
              borderWidth: 1,
              borderColor: C.border,
              borderRadius: R.md,
              paddingVertical: 16,
              alignItems: "center",
            }}
          >
            <Text style={{ color: C.muted, fontSize: 16, fontWeight: "600" }}>
              {stepIdx === 0 ? "Cancel" : "Back"}
            </Text>
          </Pressable>
          <Pressable
            onPress={handleNext}
            disabled={createTrip.isPending}
            style={{
              flex: 2,
              backgroundColor: C.info,
              borderRadius: R.md,
              paddingVertical: 16,
              alignItems: "center",
              opacity: createTrip.isPending ? 0.6 : 1,
            }}
          >
            {createTrip.isPending ? (
              <ActivityIndicator color={C.white} />
            ) : (
              <Text
                style={{
                  color: C.white,
                  fontSize: 16,
                  fontWeight: "700",
                }}
              >
                {nextLabel}
              </Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
