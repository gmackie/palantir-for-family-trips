import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
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

const RESOURCES = [
  { key: "grey", label: "Grey", kind: "waste", icon: "water-outline" },
  { key: "black", label: "Black", kind: "waste", icon: "trash-outline" },
  { key: "fresh", label: "Fresh", kind: "supply", icon: "water" },
  { key: "propane", label: "Propane", kind: "supply", icon: "flame-outline" },
  { key: "fuel", label: "Fuel", kind: "supply", icon: "speedometer-outline" },
] as const;

/** Waste is bad when high; supply is bad when low. */
function tone(kind: "waste" | "supply", level: number): string {
  const bad = kind === "waste" ? level >= 80 : level <= 20;
  return bad ? C.critical : C.success;
}

export default function LogVanStateScreen() {
  "use no memo";
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const workspaceId = getActiveWorkspaceId() ?? "";
  const qc = useQueryClient();

  const stateQuery = useQuery(
    trpc.daymap.vanState.queryOptions({ workspaceId, tripId: tripId ?? "" }),
  );

  const record = useMutation(
    trpc.daymap.recordReading.mutationOptions({
      onSuccess: () => {
        void qc.invalidateQueries({
          queryKey: trpc.daymap.vanState.queryKey({
            workspaceId,
            tripId: tripId ?? "",
          }),
        });
      },
      onError: (e) => Alert.alert("Couldn't log reading", e.message),
    }),
  );

  const levels = stateQuery.data?.levels ?? {};
  const rates = stateQuery.data?.rates ?? {};

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: "Van State",
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.fg,
        }}
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 14 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ color: C.muted, fontSize: 13, lineHeight: 18 }}>
          Log tank & supply levels. We learn your van's real drain rate so
          service alerts warn you before grey/black/fresh/propane run out.
        </Text>

        {RESOURCES.map((r) => (
          <ResourceRow
            key={r.key}
            label={r.label}
            kind={r.kind}
            icon={r.icon}
            level={(levels as Record<string, number>)[r.key]}
            rate={rates[r.key]}
            pending={record.isPending && record.variables?.resource === r.key}
            onLog={(pct) =>
              record.mutate({
                workspaceId,
                tripId: tripId ?? "",
                resource: r.key,
                levelPct: pct,
              })
            }
          />
        ))}
      </ScrollView>
    </View>
  );
}

function ResourceRow({
  label,
  kind,
  icon,
  level,
  rate,
  pending,
  onLog,
}: {
  label: string;
  kind: "waste" | "supply";
  icon: React.ComponentProps<typeof Ionicons>["name"];
  level: number | undefined;
  rate: number | undefined;
  pending: boolean;
  onLog: (pct: number) => void;
}) {
  const [val, setVal] = useState("");

  function save() {
    const pct = Number(val);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      Alert.alert("Enter 0–100", "Level must be a percentage.");
      return;
    }
    onLog(pct);
    setVal("");
  }

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: C.border,
        backgroundColor: C.surface,
        borderRadius: R.md,
        padding: 12,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name={icon} size={18} color={C.muted} />
        <Text style={{ color: C.fg, fontSize: 16, fontWeight: "700", flex: 1 }}>
          {label}
        </Text>
        <Text
          style={{
            color: level != null ? tone(kind, level) : C.muted,
            fontSize: 15,
            fontFamily: mono,
            fontVariant: ["tabular-nums"],
          }}
        >
          {level != null ? `${level}%` : "—"}
          {rate != null ? (
            <Text style={{ color: C.muted, fontSize: 12 }}> · {rate}%/d</Text>
          ) : null}
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput
          value={val}
          onChangeText={setVal}
          placeholder="0–100"
          placeholderTextColor={C.placeholder}
          keyboardType="number-pad"
          style={{
            flex: 1,
            borderWidth: 1,
            borderColor: C.border,
            backgroundColor: C.input,
            borderRadius: R.md,
            paddingHorizontal: 14,
            paddingVertical: 10,
            minHeight: 44,
            color: C.fg,
            fontSize: 16,
          }}
        />
        <Pressable
          onPress={save}
          disabled={pending || val.trim() === ""}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            paddingHorizontal: 18,
            minHeight: 44,
            borderRadius: R.md,
            backgroundColor: val.trim() === "" ? C.border : C.info,
          }}
        >
          {pending ? (
            <ActivityIndicator size="small" color={C.bg} />
          ) : (
            <Text style={{ color: C.bg, fontSize: 15, fontWeight: "800" }}>
              Log
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
