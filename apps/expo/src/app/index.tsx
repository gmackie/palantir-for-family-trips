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
import { SafeAreaView } from "react-native-safe-area-context";

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
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-foreground mb-2 text-2xl font-bold">
          Check your email
        </Text>
        <Text style={{ color: "#8c8691" }} className=" mb-6 text-center">
          We sent a magic link to {email}. Tap the link in your email to sign
          in.
        </Text>
        <Pressable
          onPress={() => {
            setSent(false);
            setEmail("");
          }}
          className="rounded-md px-4 py-2"
        >
          <Text className="text-primary font-medium">Try another email</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 items-center justify-center px-6">
      <Text className="text-foreground mb-2 text-3xl font-bold">
        SORTIE DEV
      </Text>
      <Text style={{ color: "#8c8691" }} className=" mb-8 text-center">
        Sign in with your email to get started
      </Text>

      <TextInput
        className="border-input bg-background text-foreground mb-4 w-full rounded-md border px-4 py-3 text-base"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        placeholderTextColor="#888"
        autoCapitalize="none"
        keyboardType="email-address"
        autoCorrect={false}
      />

      {error && <Text className="text-destructive mb-3 text-sm">{error}</Text>}

      <Pressable
        onPress={() => void handleSend()}
        disabled={loading || !email.trim()}
        className="bg-primary w-full items-center rounded-md px-4 py-3"
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-primary-foreground font-semibold">
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
      <View style={{ padding: 16 }}>
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
        <Text style={{ color: "#8c8691", textAlign: "center", marginTop: 40 }}>
          No trips yet
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ padding: 16 }}>
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
      <SafeAreaView className="bg-background flex-1">
        <Stack.Screen options={{ title: "Sortie" }} />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="bg-background flex-1">
      <Stack.Screen options={{ title: "Sortie" }} />
      {session?.user ? <TripList /> : <SignIn />}
    </SafeAreaView>
  );
}
