import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";

import { trpc } from "~/utils/api";
import { C, mono, R } from "~/utils/design";

export default function InviteScreen() {
  "use no memo";
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();

  const {
    data: invite,
    isLoading,
    error,
  } = useQuery(
    trpc.trips.getInviteByToken.queryOptions({ token: token ?? "" }),
  );

  const acceptMutation = useMutation(
    trpc.trips.acceptInvite.mutationOptions({
      onSuccess: (data) => {
        router.replace(`/trip/${data.tripId}`);
      },
      onError: (err) => {
        Alert.alert("Could not join", err.message);
      },
    }),
  );

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: C.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Stack.Screen
          options={{
            title: "",
            headerStyle: { backgroundColor: C.bg },
            headerTintColor: C.fg,
          }}
        />
        <ActivityIndicator size="large" color={C.info} />
        <Text style={{ color: C.muted, fontSize: 14, marginTop: 12 }}>
          Checking invitation...
        </Text>
      </View>
    );
  }

  if (error || !invite) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: C.bg,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 32,
        }}
      >
        <Stack.Screen
          options={{
            title: "Invalid Invite",
            headerStyle: { backgroundColor: C.bg },
            headerTintColor: C.fg,
          }}
        />
        <Ionicons name="alert-circle-outline" size={48} color={C.critical} />
        <Text
          style={{
            color: C.fg,
            fontSize: 18,
            fontWeight: "600",
            marginTop: 16,
            textAlign: "center",
          }}
        >
          Invitation not found
        </Text>
        <Text
          style={{
            color: C.muted,
            fontSize: 14,
            textAlign: "center",
            marginTop: 8,
          }}
        >
          This link may be invalid or expired. Ask the trip organizer for a new
          invite.
        </Text>
        <Pressable
          onPress={() => router.replace("/")}
          style={{
            marginTop: 24,
            backgroundColor: C.info,
            borderRadius: R.md,
            paddingHorizontal: 24,
            paddingVertical: 14,
            minHeight: 48,
          }}
        >
          <Text style={{ color: C.white, fontSize: 16, fontWeight: "600" }}>
            Go Home
          </Text>
        </Pressable>
      </View>
    );
  }

  if (invite.status === "expired") {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: C.bg,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 32,
        }}
      >
        <Stack.Screen
          options={{
            title: "Expired",
            headerStyle: { backgroundColor: C.bg },
            headerTintColor: C.fg,
          }}
        />
        <Ionicons name="time-outline" size={48} color={C.warning} />
        <Text
          style={{
            color: C.fg,
            fontSize: 18,
            fontWeight: "600",
            marginTop: 16,
          }}
        >
          Invite Expired
        </Text>
        <Text
          style={{
            color: C.muted,
            fontSize: 14,
            textAlign: "center",
            marginTop: 8,
          }}
        >
          This invitation has expired. Ask the trip organizer to send a new one.
        </Text>
        <Pressable
          onPress={() => router.replace("/")}
          style={{
            marginTop: 24,
            backgroundColor: C.info,
            borderRadius: R.md,
            paddingHorizontal: 24,
            paddingVertical: 14,
            minHeight: 48,
          }}
        >
          <Text style={{ color: C.white, fontSize: 16, fontWeight: "600" }}>
            Go Home
          </Text>
        </Pressable>
      </View>
    );
  }

  if (invite.status === "already_accepted") {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: C.bg,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 32,
        }}
      >
        <Stack.Screen
          options={{
            title: "Already Joined",
            headerStyle: { backgroundColor: C.bg },
            headerTintColor: C.fg,
          }}
        />
        <Ionicons name="checkmark-circle" size={48} color={C.success} />
        <Text
          style={{
            color: C.fg,
            fontSize: 18,
            fontWeight: "600",
            marginTop: 16,
          }}
        >
          Already a member
        </Text>
        <Text
          style={{
            color: C.muted,
            fontSize: 14,
            textAlign: "center",
            marginTop: 8,
          }}
        >
          You&apos;ve already joined{" "}
          <Text style={{ fontWeight: "600", color: C.fg }}>
            {invite.tripName}
          </Text>
        </Text>
        <Pressable
          onPress={() => router.replace(`/trip/${invite.tripId}`)}
          style={{
            marginTop: 24,
            backgroundColor: C.info,
            borderRadius: R.md,
            paddingHorizontal: 24,
            paddingVertical: 14,
            minHeight: 48,
          }}
        >
          <Text style={{ color: C.white, fontSize: 16, fontWeight: "600" }}>
            Open Trip
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: C.bg,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 32,
      }}
    >
      <Stack.Screen
        options={{
          title: "Join Trip",
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.fg,
        }}
      />

      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: `${C.info}22`,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 24,
        }}
      >
        <Ionicons name="airplane" size={32} color={C.info} />
      </View>

      <Text
        style={{
          color: C.fg,
          fontSize: 22,
          fontWeight: "700",
          textAlign: "center",
        }}
      >
        You&apos;re invited!
      </Text>

      <Text
        style={{
          color: C.muted,
          fontSize: 15,
          textAlign: "center",
          marginTop: 8,
          lineHeight: 22,
        }}
      >
        You&apos;ve been invited to join
      </Text>
      <Text
        style={{
          color: C.fg,
          fontSize: 18,
          fontWeight: "600",
          textAlign: "center",
          marginTop: 4,
        }}
      >
        {invite.tripName}
      </Text>

      <View
        style={{
          marginTop: 24,
          backgroundColor: C.surface,
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: R.md,
          padding: 16,
          width: "100%",
          gap: 8,
        }}
      >
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Ionicons name="mail-outline" size={16} color={C.muted} />
          <Text style={{ color: C.muted, fontSize: 13 }}>Invited as</Text>
          <Text style={{ color: C.fg, fontSize: 13, fontFamily: mono }}>
            {invite.email}
          </Text>
        </View>
      </View>

      <Pressable
        onPress={() => acceptMutation.mutate({ token: token ?? "" })}
        disabled={acceptMutation.isPending}
        style={{
          marginTop: 32,
          backgroundColor: C.info,
          borderRadius: R.md,
          paddingHorizontal: 32,
          paddingVertical: 16,
          minHeight: 52,
          width: "100%",
          alignItems: "center",
          flexDirection: "row",
          justifyContent: "center",
          gap: 8,
          opacity: acceptMutation.isPending ? 0.6 : 1,
        }}
      >
        {acceptMutation.isPending ? (
          <ActivityIndicator color={C.white} />
        ) : (
          <>
            <Ionicons name="checkmark-circle" size={20} color={C.white} />
            <Text style={{ color: C.white, fontSize: 16, fontWeight: "600" }}>
              Join Trip
            </Text>
          </>
        )}
      </Pressable>

      <Pressable
        onPress={() => router.replace("/")}
        style={{ marginTop: 16, minHeight: 44, justifyContent: "center" }}
      >
        <Text style={{ color: C.muted, fontSize: 14 }}>Not now</Text>
      </Pressable>
    </View>
  );
}
