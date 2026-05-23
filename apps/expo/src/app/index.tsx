import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  DevSettings,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

function formatDate(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
    new Date(value),
  );
}

function useDevAutoLogin() {
  useEffect(() => {
    if (!__DEV__) return;
    void (async () => {
      let changed = false;

      const existing = await SecureStore.getItemAsync("expo_cookie");
      if (!existing?.includes("nHwwBLRgZE4MQRsbm20yPgv6e9puGpb2")) {
        const token =
          "nHwwBLRgZE4MQRsbm20yPgv6e9puGpb2.0PJnRaPtejB3cPYGSnREzkpJuVakXQcbKyhxhSOk1M8=";
        const expires = new Date(Date.now() + 604800 * 1000).toISOString();
        const cookieData = JSON.stringify({
          "__Secure-better-auth.session_token": { value: token, expires },
        });
        await SecureStore.setItemAsync("expo_cookie", cookieData);
        changed = true;
      }

      const wsId = SecureStore.getItem("active_workspace_id");
      if (wsId !== "c0e43b67-ba9f-4542-be41-42ee9232687d") {
        SecureStore.setItem(
          "active_workspace_id",
          "c0e43b67-ba9f-4542-be41-42ee9232687d",
        );
        changed = true;
      }

      if (changed) DevSettings.reload();
    })();
  }, []);
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await authClient.signIn.magicLink({ email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send link");
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 24,
        }}
      >
        <Text
          style={{
            color: "#f9f7fb",
            fontSize: 24,
            fontWeight: "bold",
            marginBottom: 8,
          }}
        >
          Check your email
        </Text>
        <Text
          style={{
            color: "#8c8691",
            textAlign: "center",
            marginBottom: 24,
          }}
        >
          We sent a magic link to {email}. Tap the link in your email to sign
          in.
        </Text>
        <Pressable
          onPress={() => {
            setSent(false);
            setEmail("");
          }}
          style={{ borderRadius: 6, paddingHorizontal: 16, paddingVertical: 8 }}
        >
          <Text style={{ color: "#d66daa", fontWeight: "500" }}>
            Try another email
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 24,
      }}
    >
      <Text
        style={{
          color: "#f9f7fb",
          fontSize: 30,
          fontWeight: "bold",
          marginBottom: 8,
        }}
      >
        SORTIE DEV
      </Text>
      <Text
        style={{
          color: "#8c8691",
          textAlign: "center",
          marginBottom: 32,
        }}
      >
        Sign in with your email to get started
      </Text>

      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        placeholderTextColor="#888"
        autoCapitalize="none"
        keyboardType="email-address"
        autoCorrect={false}
        style={{
          borderWidth: 1,
          borderColor: "#2f2a33",
          backgroundColor: "#0d0b0f",
          color: "#f9f7fb",
          borderRadius: 6,
          paddingHorizontal: 16,
          paddingVertical: 12,
          fontSize: 16,
          width: "100%",
          marginBottom: 16,
        }}
      />

      {error && (
        <Text style={{ color: "#ef4444", fontSize: 14, marginBottom: 12 }}>
          {error}
        </Text>
      )}

      <Pressable
        onPress={() => void handleSend()}
        disabled={loading || !email.trim()}
        style={{
          backgroundColor: "#d66daa",
          width: "100%",
          alignItems: "center",
          borderRadius: 6,
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={{ color: "#141116", fontWeight: "600" }}>
            Send magic link
          </Text>
        )}
      </Pressable>
    </View>
  );
}

function TripList() {
  "use no memo";
  const workspaceId = getActiveWorkspaceId();
  const router = useRouter();
  const { data: trips, isLoading } = useQuery(
    trpc.trips.list.queryOptions({
      workspaceId: workspaceId ?? "",
    }),
  );

  if (!workspaceId) {
    return (
      <View
        style={{ alignItems: "center", justifyContent: "center", padding: 24 }}
      >
        <Text style={{ color: "#8c8691", textAlign: "center" }}>
          No workspace selected.
        </Text>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={{ padding: 40, alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!trips || trips.length === 0) {
    return (
      <View style={{ padding: 16, flex: 1 }}>
        <Text
          style={{
            color: "#f9f7fb",
            fontSize: 24,
            fontWeight: "bold",
            marginBottom: 16,
          }}
        >
          Your Trips
        </Text>
        <View
          style={{
            alignItems: "center",
            justifyContent: "center",
            marginTop: 60,
            gap: 16,
          }}
        >
          <Text style={{ color: "#8c8691", textAlign: "center" }}>
            No trips yet
          </Text>
          <Pressable
            onPress={() => router.push("/new-trip")}
            style={{
              backgroundColor: "#d66daa",
              borderRadius: 12,
              paddingVertical: 14,
              paddingHorizontal: 28,
            }}
          >
            <Text
              style={{
                color: "#141116",
                fontSize: 16,
                fontWeight: "700",
              }}
            >
              + New Trip
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={{ padding: 16 }}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <Text
          style={{
            color: "#f9f7fb",
            fontSize: 24,
            fontWeight: "bold",
          }}
        >
          Your Trips
        </Text>
        <Pressable
          onPress={() => router.push("/new-trip")}
          style={{
            backgroundColor: "#d66daa",
            borderRadius: 8,
            paddingVertical: 8,
            paddingHorizontal: 16,
          }}
        >
          <Text style={{ color: "#141116", fontSize: 14, fontWeight: "700" }}>
            + New
          </Text>
        </Pressable>
      </View>
      {trips.map((item) => (
        <Pressable
          key={item.id}
          onPress={() =>
            router.push({
              pathname: "/trip/[tripId]",
              params: { tripId: item.id },
            })
          }
          style={{
            backgroundColor: "#1e1b24",
            borderRadius: 8,
            padding: 16,
            marginBottom: 12,
            borderWidth: 1,
            borderColor: "#2f2a33",
          }}
        >
          <Text style={{ color: "#f9f7fb", fontSize: 18, fontWeight: "600" }}>
            {item.name}
          </Text>
          {item.destinationName && (
            <Text style={{ color: "#8c8691", fontSize: 14, marginTop: 4 }}>
              {item.destinationName}
            </Text>
          )}
          {(item.startDate || item.endDate) && (
            <Text style={{ color: "#8c8691", fontSize: 12, marginTop: 4 }}>
              {formatDate(item.startDate)}
              {item.startDate && item.endDate ? " - " : ""}
              {formatDate(item.endDate)}
            </Text>
          )}
        </Pressable>
      ))}
    </ScrollView>
  );
}

export default function Index() {
  const { data: session, isPending } = authClient.useSession();
  useDevAutoLogin();

  if (isPending) {
    return (
      <View style={{ flex: 1, backgroundColor: "#141116" }}>
        <Stack.Screen options={{ title: "Sortie" }} />
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <ActivityIndicator size="large" />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#141116" }}>
      <Stack.Screen options={{ title: "Sortie" }} />
      {session?.user ? <TripList /> : <SignIn />}
    </View>
  );
}
