import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";
import { C, mono, R } from "~/utils/design";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

const COLOR_OPTIONS = [
  "#58A6FF",
  "#79C0FF",
  "#56D364",
  "#D2A8FF",
  "#7EE787",
  "#F97316",
  "#F472B6",
  "#6CB6FF",
  "#FBBF24",
  "#B1BAC4",
];

export default function ProfileScreen() {
  "use no memo";
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const workspaceId = getActiveWorkspaceId() ?? "";
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const userId = session.data?.user?.id;

  const { data: members } = useQuery(
    trpc.trips.listMembers.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
    }),
  );

  const myMember = members?.find((m) => m.userId === userId);

  const [displayName, setDisplayName] = useState("");
  const [venmoHandle, setVenmoHandle] = useState("");
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  if (myMember && !initialized) {
    setDisplayName(myMember.displayName ?? session.data?.user?.name ?? "");
    setVenmoHandle("");
    setSelectedColor(myMember.colorHex ?? COLOR_OPTIONS[0]!);
    setInitialized(true);
  }

  const updateMutation = useMutation(
    trpc.trips.updateMyProfile.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(
          trpc.trips.listMembers.queryFilter(),
        );
        Alert.alert("Saved", "Your profile has been updated.");
        router.back();
      },
      onError: (err) => Alert.alert("Error", err.message),
    }),
  );

  const canSave = displayName.trim().length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: "My Profile",
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
          contentContainerStyle={{ padding: 16, gap: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ alignItems: "center", paddingVertical: 16 }}>
            <View
              style={{
                width: 72,
                height: 72,
                borderRadius: 36,
                backgroundColor: `${selectedColor ?? C.info}22`,
                borderWidth: 3,
                borderColor: selectedColor ?? C.info,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{
                  color: selectedColor ?? C.info,
                  fontSize: 24,
                  fontWeight: "700",
                  fontFamily: mono,
                }}
              >
                {displayName
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((w) => w[0]?.toUpperCase() ?? "")
                  .join("") || "?"}
              </Text>
            </View>
          </View>

          <View>
            <Text style={labelStyle}>Display Name</Text>
            <TextInput
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="How others see you"
              placeholderTextColor={C.placeholder}
              style={inputStyle}
            />
            <Text style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
              This is how your name appears to other trip members.
            </Text>
          </View>

          <View>
            <Text style={labelStyle}>Venmo Username</Text>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                borderWidth: 1,
                borderColor: C.border,
                backgroundColor: C.surface,
                borderRadius: R.md,
                paddingHorizontal: 14,
              }}
            >
              <Text style={{ color: C.muted, fontSize: 16 }}>@</Text>
              <TextInput
                value={venmoHandle}
                onChangeText={setVenmoHandle}
                placeholder="your-venmo"
                placeholderTextColor={C.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                style={{
                  flex: 1,
                  color: C.fg,
                  paddingVertical: 14,
                  fontSize: 16,
                }}
              />
            </View>
            <Text style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
              Makes it easy for others to pay you when settling up.
            </Text>
          </View>

          <View>
            <Text style={labelStyle}>Color</Text>
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              {COLOR_OPTIONS.map((color) => (
                <Pressable
                  key={color}
                  onPress={() => setSelectedColor(color)}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    backgroundColor: color,
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: selectedColor === color ? 3 : 0,
                    borderColor: C.white,
                  }}
                >
                  {selectedColor === color && (
                    <Ionicons name="checkmark" size={20} color={C.white} />
                  )}
                </Pressable>
              ))}
            </View>
            <Text style={{ color: C.muted, fontSize: 12, marginTop: 8 }}>
              Your color on the map and in member lists.
            </Text>
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
            updateMutation.mutate({
              workspaceId,
              tripId: tripId ?? "",
              displayName: displayName.trim(),
              venmoHandle: venmoHandle.trim() || undefined,
              colorHex: selectedColor ?? undefined,
            });
          }}
          disabled={!canSave || updateMutation.isPending}
          style={{
            backgroundColor: C.info,
            borderRadius: R.md,
            paddingVertical: 16,
            alignItems: "center",
            opacity: !canSave || updateMutation.isPending ? 0.5 : 1,
          }}
        >
          {updateMutation.isPending ? (
            <ActivityIndicator color={C.white} />
          ) : (
            <Text style={{ color: C.white, fontSize: 16, fontWeight: "600" }}>
              Save Profile
            </Text>
          )}
        </Pressable>
      </View>
    </View>
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
  fontSize: 16,
};
