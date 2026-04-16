import { useQuery } from "@tanstack/react-query";
import { Link, Stack, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

const STATUS_COLORS: Record<string, string> = {
  planning: "bg-yellow-500",
  confirmed: "bg-blue-500",
  active: "bg-green-500",
  completed: "bg-gray-500",
};

function formatDate(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
    new Date(value),
  );
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
        <Text className="text-muted-foreground mb-6 text-center">
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
        Trip Planner
      </Text>
      <Text className="text-muted-foreground mb-8 text-center">
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

      {error && (
        <Text className="text-destructive mb-3 text-sm">{error}</Text>
      )}

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
  const router = useRouter();
  const workspaceId = getActiveWorkspaceId();

  const { data: trips, isLoading } = useQuery(
    trpc.trips.list.queryOptions({
      workspaceId: workspaceId ?? "",
    }),
  );

  if (!workspaceId) {
    return (
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-muted-foreground text-center">
          No workspace selected. Please set up your workspace in settings.
        </Text>
        <Link href="/settings" asChild>
          <Pressable className="bg-primary mt-4 rounded-md px-4 py-2">
            <Text className="text-primary-foreground font-medium">
              Go to Settings
            </Text>
          </Pressable>
        </Link>
      </View>
    );
  }

  return (
    <View className="flex-1 px-4 pt-4">
      <View className="mb-4 flex-row items-center justify-between">
        <Text className="text-foreground text-2xl font-bold">Your Trips</Text>
        <View className="flex-row gap-2">
          <Link href="/settings" asChild>
            <Pressable className="border-border rounded-md border px-3 py-2">
              <Text className="text-foreground text-sm">Settings</Text>
            </Pressable>
          </Link>
        </View>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" />
        </View>
      ) : !trips || trips.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-muted-foreground mb-2 text-lg">
            No trips yet
          </Text>
          <Text className="text-muted-foreground text-center text-sm">
            Create your first trip to get started planning.
          </Text>
        </View>
      ) : (
        <FlatList
          data={trips}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={() => <View className="h-3" />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: "/trip/[tripId]",
                  params: { tripId: item.id },
                })
              }
              className="border-border bg-card rounded-lg border p-4"
            >
              <View className="mb-2 flex-row items-center justify-between">
                <Text className="text-foreground text-lg font-semibold">
                  {item.name}
                </Text>
                <View
                  className={`rounded-full px-2 py-0.5 ${STATUS_COLORS[item.status] ?? "bg-gray-400"}`}
                >
                  <Text className="text-xs font-medium capitalize text-white">
                    {item.status}
                  </Text>
                </View>
              </View>
              {item.destinationName && (
                <Text className="text-muted-foreground mb-1 text-sm">
                  {item.destinationName}
                </Text>
              )}
              {(item.startDate || item.endDate) && (
                <Text className="text-muted-foreground text-xs">
                  {formatDate(item.startDate)}
                  {item.startDate && item.endDate ? " - " : ""}
                  {formatDate(item.endDate)}
                </Text>
              )}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

export default function Index() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <SafeAreaView className="bg-background flex-1">
        <Stack.Screen options={{ title: "Trip Planner" }} />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="bg-background flex-1">
      <Stack.Screen options={{ title: "Trip Planner" }} />
      {session?.user ? <TripList /> : <SignIn />}
    </SafeAreaView>
  );
}
