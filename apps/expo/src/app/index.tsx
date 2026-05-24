import { useMutation, useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  DevSettings,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";
import {
  getActiveWorkspaceId,
  setActiveWorkspaceId,
} from "~/utils/workspace-store";

function formatDate(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
    new Date(value),
  );
}

function SocialButton({
  label,
  onPress,
  loading,
}: {
  label: string;
  onPress: () => void;
  loading: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={{
        borderWidth: 1,
        borderColor: "#2f2a33",
        backgroundColor: "#0d0b0f",
        width: "100%",
        alignItems: "center",
        borderRadius: 6,
        paddingVertical: 12,
        opacity: loading ? 0.5 : 1,
      }}
    >
      {loading ? (
        <ActivityIndicator color="#8c8691" size="small" />
      ) : (
        <Text style={{ color: "#8c8691", fontWeight: "600", fontSize: 15 }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<string | null>(null);

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

  const handleSocial = async (provider: "google" | "apple" | "discord") => {
    setSocialLoading(provider);
    setError(null);
    try {
      await authClient.signIn.social({ provider, callbackURL: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to sign in`);
    } finally {
      setSocialLoading(null);
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
    <ScrollView
      contentContainerStyle={{
        flexGrow: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 24,
        paddingVertical: 40,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <Text
        style={{
          color: "#58A6FF",
          fontSize: 9,
          fontWeight: "900",
          letterSpacing: 2,
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        Sortie
      </Text>
      <Text
        style={{
          color: "#f9f7fb",
          fontSize: 28,
          fontWeight: "800",
          marginBottom: 8,
        }}
      >
        Sign in
      </Text>
      <Text
        style={{
          color: "#8c8691",
          textAlign: "center",
          marginBottom: 32,
          fontSize: 14,
        }}
      >
        Use a magic link or continue with a provider.
      </Text>

      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        placeholderTextColor="#555"
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
          marginBottom: 12,
        }}
      />

      <Pressable
        onPress={() => void handleSend()}
        disabled={loading || !email.trim()}
        style={{
          backgroundColor: "#d66daa",
          width: "100%",
          alignItems: "center",
          borderRadius: 6,
          paddingVertical: 12,
          opacity: loading || !email.trim() ? 0.5 : 1,
          marginBottom: 24,
        }}
      >
        {loading ? (
          <ActivityIndicator color="#141116" size="small" />
        ) : (
          <Text style={{ color: "#141116", fontWeight: "700", fontSize: 15 }}>
            Send magic link
          </Text>
        )}
      </Pressable>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          width: "100%",
          marginBottom: 24,
        }}
      >
        <View style={{ flex: 1, height: 1, backgroundColor: "#2f2a33" }} />
        <Text
          style={{
            color: "#484f58",
            fontSize: 11,
            textTransform: "uppercase",
            paddingHorizontal: 12,
          }}
        >
          or
        </Text>
        <View style={{ flex: 1, height: 1, backgroundColor: "#2f2a33" }} />
      </View>

      <View style={{ width: "100%", gap: 10 }}>
        <SocialButton
          label="Continue with Google"
          onPress={() => void handleSocial("google")}
          loading={socialLoading === "google"}
        />
        <SocialButton
          label="Continue with Apple"
          onPress={() => void handleSocial("apple")}
          loading={socialLoading === "apple"}
        />
      </View>

      {error && (
        <Text
          style={{
            color: "#ef4444",
            fontSize: 13,
            marginTop: 16,
            textAlign: "center",
          }}
        >
          {error}
        </Text>
      )}
    </ScrollView>
  );
}

function UserHeader({
  user,
}: {
  user: { name?: string | null; email?: string | null };
}) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = () => {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          setSigningOut(true);
          try {
            await SecureStore.deleteItemAsync("expo_cookie");
            await SecureStore.deleteItemAsync("active_workspace_id");
            await authClient.signOut();
          } catch {
            // signOut may fail if session already expired
          } finally {
            setSigningOut(false);
            if (__DEV__) DevSettings.reload();
          }
        },
      },
    ]);
  };

  const initials = (user.name ?? user.email ?? "?")
    .split(/[\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 8,
        gap: 12,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: "#2f2a33",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: "#f9f7fb", fontSize: 14, fontWeight: "700" }}>
          {initials}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        {user.name && (
          <Text
            style={{ color: "#f9f7fb", fontSize: 14, fontWeight: "600" }}
            numberOfLines={1}
          >
            {user.name}
          </Text>
        )}
        {user.email && (
          <Text style={{ color: "#8c8691", fontSize: 12 }} numberOfLines={1}>
            {user.email}
          </Text>
        )}
      </View>
      <Pressable
        onPress={() => router.push("/settings")}
        style={{
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: "#2f2a33",
        }}
      >
        <Text style={{ color: "#8c8691", fontSize: 13 }}>Settings</Text>
      </Pressable>
      <Pressable
        onPress={handleSignOut}
        disabled={signingOut}
        style={{
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: "#2f2a33",
          opacity: signingOut ? 0.5 : 1,
        }}
      >
        <Text style={{ color: "#ef4444", fontSize: 13 }}>
          {signingOut ? "..." : "Sign out"}
        </Text>
      </Pressable>
    </View>
  );
}

function TripList({
  user,
}: {
  user: { name?: string | null; email?: string | null };
}) {
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
      <View style={{ flex: 1 }}>
        <UserHeader user={user} />
        <View
          style={{
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <Text style={{ color: "#8c8691", textAlign: "center" }}>
            No workspace selected.
          </Text>
        </View>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={{ flex: 1 }}>
        <UserHeader user={user} />
        <View style={{ padding: 40, alignItems: "center" }}>
          <ActivityIndicator size="large" />
        </View>
      </View>
    );
  }

  if (!trips || trips.length === 0) {
    return (
      <View style={{ flex: 1 }}>
        <UserHeader user={user} />
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
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }}>
      <UserHeader user={user} />
      <View style={{ padding: 16 }}>
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
      </View>
    </ScrollView>
  );
}

function WorkspaceGate({
  user,
}: {
  user: { name?: string | null; email?: string | null };
}) {
  const [workspaceReady, setWorkspaceReady] = useState(
    () => !!getActiveWorkspaceId(),
  );

  const { mutate, isPending, isError, error } = useMutation(
    trpc.settings.joinDefaultWorkspace.mutationOptions({
      onSuccess: (data) => {
        setActiveWorkspaceId(data.workspaceId);
        setWorkspaceReady(true);
      },
    }),
  );

  useEffect(() => {
    if (workspaceReady) return;
    mutate();
  }, [workspaceReady, mutate]);

  if (isError) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <Text
          style={{
            color: "#ef4444",
            fontSize: 16,
            textAlign: "center",
            marginBottom: 12,
          }}
        >
          Failed to join workspace
        </Text>
        <Text style={{ color: "#8c8691", fontSize: 13, textAlign: "center" }}>
          {error?.message}
        </Text>
      </View>
    );
  }

  if (!workspaceReady || isPending) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" />
        <Text style={{ color: "#8c8691", marginTop: 12, fontSize: 13 }}>
          Setting up workspace...
        </Text>
      </View>
    );
  }

  return <TripList user={user} />;
}

export default function Index() {
  const { data: session, isPending } = authClient.useSession();

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
      {session?.user ? <WorkspaceGate user={session.user} /> : <SignIn />}
    </View>
  );
}
