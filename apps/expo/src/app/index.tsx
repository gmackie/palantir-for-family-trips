import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  DevSettings,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { queryClient, trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";
import { C, mono, R } from "~/utils/design";
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

function getDaysUntilTrip(dateStr: string): number | null {
  const target = new Date(dateStr);
  const now = new Date();
  const diff = Math.ceil(
    (target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );
  return diff;
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
        borderColor: C.border,
        backgroundColor: C.bg,
        width: "100%",
        alignItems: "center",
        borderRadius: R.md,
        paddingVertical: 12,
        opacity: loading ? 0.5 : 1,
      }}
    >
      {loading ? (
        <ActivityIndicator color={C.muted} size="small" />
      ) : (
        <Text style={{ color: C.muted, fontWeight: "600", fontSize: 15 }}>
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
      await SecureStore.deleteItemAsync("expo_cookie");
      await SecureStore.deleteItemAsync("expo_session_data");

      await authClient.signIn.social({ provider, callbackURL: "/" });
      const cookie = authClient.getCookie();
      if (!cookie || !cookie.includes("session_token")) {
        await authClient.getSession();
      }
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
            color: C.fg,
            fontSize: 24,
            fontWeight: "bold",
            marginBottom: 8,
          }}
        >
          Check your email
        </Text>
        <Text
          style={{
            color: C.muted,
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
          style={{
            borderRadius: R.md,
            paddingHorizontal: 16,
            paddingVertical: 8,
          }}
        >
          <Text style={{ color: C.info, fontWeight: "500" }}>
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
          color: C.info,
          fontSize: 9,
          fontWeight: "900",
          letterSpacing: 2,
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        Sortey
      </Text>
      <Text
        style={{
          color: C.fg,
          fontSize: 28,
          fontWeight: "800",
          marginBottom: 8,
        }}
      >
        Sign in
      </Text>
      <Text
        style={{
          color: C.muted,
          textAlign: "center",
          marginBottom: 32,
          fontSize: 15,
        }}
      >
        Use a magic link or continue with a provider.
      </Text>

      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        placeholderTextColor={C.placeholder}
        autoCapitalize="none"
        keyboardType="email-address"
        autoCorrect={false}
        style={{
          borderWidth: 1,
          borderColor: C.border,
          backgroundColor: C.bg,
          color: C.fg,
          borderRadius: R.md,
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
          backgroundColor: C.info,
          width: "100%",
          alignItems: "center",
          borderRadius: R.md,
          paddingVertical: 12,
          opacity: loading || !email.trim() ? 0.5 : 1,
          marginBottom: 24,
        }}
      >
        {loading ? (
          <ActivityIndicator color={C.white} size="small" />
        ) : (
          <Text style={{ color: C.white, fontWeight: "700", fontSize: 15 }}>
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
        <View style={{ flex: 1, height: 1, backgroundColor: C.border }} />
        <Text
          style={{
            color: C.placeholder,
            fontSize: 11,
            textTransform: "uppercase",
            paddingHorizontal: 12,
          }}
        >
          or
        </Text>
        <View style={{ flex: 1, height: 1, backgroundColor: C.border }} />
      </View>

      <View style={{ width: "100%", gap: 10 }}>
        <SocialButton
          label="Continue with Google"
          onPress={() => void handleSocial("google")}
          loading={socialLoading === "google"}
        />
        {Platform.OS === "ios" && (
          <SocialButton
            label="Continue with Apple"
            onPress={() => void handleSocial("apple")}
            loading={socialLoading === "apple"}
          />
        )}
      </View>

      {error && (
        <Text
          style={{
            color: C.critical,
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
            await authClient.signOut();
          } catch {
            // signOut may fail if session already expired
          }
          await SecureStore.deleteItemAsync("expo_cookie");
          await SecureStore.deleteItemAsync("expo_session_data");
          await SecureStore.deleteItemAsync("active_workspace_id");
          queryClient.clear();
          setSigningOut(false);
          if (__DEV__) DevSettings.reload();
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
          backgroundColor: C.border,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: C.fg, fontSize: 14, fontWeight: "700" }}>
          {initials}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        {user.name && (
          <Text
            style={{ color: C.fg, fontSize: 14, fontWeight: "600" }}
            numberOfLines={1}
          >
            {user.name}
          </Text>
        )}
        {user.email && (
          <Text style={{ color: C.muted, fontSize: 12 }} numberOfLines={1}>
            {user.email}
          </Text>
        )}
      </View>
      <Pressable
        onPress={() => router.push("/settings")}
        style={{
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: R.md,
          borderWidth: 1,
          borderColor: C.border,
        }}
      >
        <Text style={{ color: C.muted, fontSize: 13 }}>Settings</Text>
      </Pressable>
      <Pressable
        onPress={handleSignOut}
        disabled={signingOut}
        style={{
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: R.md,
          borderWidth: 1,
          borderColor: C.border,
          opacity: signingOut ? 0.5 : 1,
        }}
      >
        <Text style={{ color: C.critical, fontSize: 13 }}>
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
          <Text style={{ color: C.muted, textAlign: "center" }}>
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
    const features = [
      {
        icon: "receipt-outline" as const,
        title: "Split expenses",
        desc: "Scan receipts, claim items, settle up with Venmo",
      },
      {
        icon: "calendar-outline" as const,
        title: "Plan together",
        desc: "Polls, proposals, and a shared itinerary",
      },
      {
        icon: "map-outline" as const,
        title: "Stay coordinated",
        desc: "Live map, location sharing, and lodging info",
      },
    ];
    return (
      <ScrollView style={{ flex: 1 }}>
        <UserHeader user={user} />
        <View style={{ padding: 20, paddingTop: 32 }}>
          <Text
            style={{
              color: C.fg,
              fontSize: 28,
              fontWeight: "800",
              marginBottom: 8,
            }}
          >
            Welcome to Sortey
          </Text>
          <Text
            style={{
              color: C.muted,
              fontSize: 16,
              lineHeight: 24,
              marginBottom: 32,
            }}
          >
            Plan together. Split everything.
          </Text>

          <View style={{ gap: 16, marginBottom: 32 }}>
            {features.map((f) => (
              <View
                key={f.title}
                style={{
                  flexDirection: "row",
                  gap: 14,
                  alignItems: "flex-start",
                }}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    backgroundColor: `${C.info}15`,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name={f.icon} size={18} color={C.info} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: C.fg,
                      fontSize: 16,
                      fontWeight: "600",
                      marginBottom: 2,
                    }}
                  >
                    {f.title}
                  </Text>
                  <Text style={{ color: C.muted, fontSize: 14 }}>{f.desc}</Text>
                </View>
              </View>
            ))}
          </View>

          <Pressable
            onPress={() => router.push("/new-trip")}
            style={{
              backgroundColor: C.info,
              borderRadius: R.md,
              paddingVertical: 16,
              alignItems: "center",
              flexDirection: "row",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <Ionicons name="add-circle" size={20} color={C.white} />
            <Text style={{ color: C.white, fontSize: 16, fontWeight: "700" }}>
              Create Your First Trip
            </Text>
          </Pressable>

          <Text
            style={{
              color: C.muted,
              fontSize: 13,
              textAlign: "center",
              marginTop: 16,
            }}
          >
            Got an invite link? Open it to join an existing trip.
          </Text>
        </View>
      </ScrollView>
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
              color: C.fg,
              fontSize: 24,
              fontWeight: "bold",
            }}
          >
            Your Trips
          </Text>
          <Pressable
            onPress={() => router.push("/new-trip")}
            style={{
              backgroundColor: C.info,
              borderRadius: R.md,
              paddingVertical: 8,
              paddingHorizontal: 16,
            }}
          >
            <Text style={{ color: C.white, fontSize: 14, fontWeight: "700" }}>
              + New
            </Text>
          </Pressable>
        </View>
        {trips.map((item) => {
          const daysUntil = item.startDate
            ? getDaysUntilTrip(item.startDate)
            : null;
          return (
            <Pressable
              key={item.id}
              onPress={() =>
                router.push({
                  pathname: "/trip/[tripId]",
                  params: { tripId: item.id },
                })
              }
              style={{
                backgroundColor: C.surface,
                borderRadius: R.md,
                padding: 16,
                marginBottom: 12,
                borderWidth: 1,
                borderColor: C.border,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: 12,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: C.fg,
                      fontSize: 18,
                      fontWeight: "600",
                    }}
                  >
                    {item.name}
                  </Text>
                  {item.destinationName && (
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
                      <Text style={{ color: C.muted, fontSize: 14 }}>
                        {item.destinationName}
                      </Text>
                    </View>
                  )}
                  {(item.startDate || item.endDate) && (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 4,
                        marginTop: 4,
                      }}
                    >
                      <Ionicons
                        name="calendar-outline"
                        size={12}
                        color={C.muted}
                      />
                      <Text
                        style={{
                          color: C.muted,
                          fontSize: 13,
                          fontFamily: mono,
                        }}
                      >
                        {formatDate(item.startDate)}
                        {item.startDate && item.endDate ? " – " : ""}
                        {formatDate(item.endDate)}
                      </Text>
                    </View>
                  )}
                </View>
                {daysUntil !== null && daysUntil >= 0 && (
                  <View
                    style={{
                      backgroundColor: `${C.info}15`,
                      borderRadius: R.sm,
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                    }}
                  >
                    <Text
                      style={{
                        color: C.info,
                        fontSize: 12,
                        fontWeight: "700",
                        fontFamily: mono,
                      }}
                    >
                      {daysUntil === 0
                        ? "TODAY"
                        : daysUntil === 1
                          ? "1 DAY"
                          : `${daysUntil}d`}
                    </Text>
                  </View>
                )}
              </View>
            </Pressable>
          );
        })}
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
  const [debugInfo, setDebugInfo] = useState<string | null>(null);
  const [noCookie, setNoCookie] = useState(false);
  const retriesRef = useRef(0);

  const { mutate, isPending, isError, error, reset } = useMutation(
    trpc.settings.joinDefaultWorkspace.mutationOptions({
      onSuccess: (data) => {
        setActiveWorkspaceId(data.workspaceId);
        setWorkspaceReady(true);
      },
      onError: () => {
        const cookie = authClient.getCookie();
        const cookieNames = cookie
          ? cookie
              .split(";")
              .map((c: string) => c.trim().split("=")[0])
              .join(", ")
          : "NONE";
        const info = `cookie_names=[${cookieNames}] cookie_len=${cookie?.length ?? 0} cookie_preview=${cookie ? cookie.substring(0, 100) : "EMPTY"}`;
        setDebugInfo(info);
      },
    }),
  );

  useEffect(() => {
    if (workspaceReady) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    function attempt() {
      if (cancelled) return;
      const cookie = authClient.getCookie();
      if (!cookie && retriesRef.current < 5) {
        retriesRef.current += 1;
        timer = setTimeout(attempt, 400);
        return;
      }
      if (!cookie) {
        setNoCookie(true);
        return;
      }
      mutate();
    }

    attempt();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [workspaceReady, mutate]);

  if (noCookie) {
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
            color: C.critical,
            fontSize: 16,
            textAlign: "center",
            marginBottom: 12,
          }}
        >
          Session expired
        </Text>
        <Text
          style={{
            color: C.muted,
            fontSize: 13,
            textAlign: "center",
            marginBottom: 16,
          }}
        >
          Your cached session is no longer valid. Please sign in again.
        </Text>
        <Pressable
          onPress={async () => {
            try {
              await authClient.signOut();
            } catch {
              // ok
            }
            await SecureStore.deleteItemAsync("expo_cookie");
            await SecureStore.deleteItemAsync("expo_session_data");
            await SecureStore.deleteItemAsync("active_workspace_id");
            queryClient.clear();
            if (__DEV__) DevSettings.reload();
          }}
          style={{
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderRadius: R.md,
            borderWidth: 1,
            borderColor: C.info,
          }}
        >
          <Text style={{ color: C.info, fontWeight: "500" }}>Sign in</Text>
        </Pressable>
      </View>
    );
  }

  if (isError) {
    const canRetry = retriesRef.current < 3;
    const currentCookie = authClient.getCookie();
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
            color: C.info,
            fontSize: 10,
            fontFamily: mono,
            marginBottom: 8,
          }}
        >
          v3-fallback
        </Text>
        <Text
          style={{
            color: C.critical,
            fontSize: 16,
            textAlign: "center",
            marginBottom: 12,
          }}
        >
          Failed to join workspace
        </Text>
        <Text style={{ color: C.muted, fontSize: 13, textAlign: "center" }}>
          {error?.message}
        </Text>
        <Text
          selectable
          style={{
            color: C.info,
            fontSize: 9,
            fontFamily: mono,
            textAlign: "center",
            marginTop: 8,
            paddingHorizontal: 12,
          }}
        >
          cookie={currentCookie ? currentCookie.substring(0, 200) : "NONE"}
        </Text>
        {debugInfo && (
          <Text
            selectable
            style={{
              color: C.info,
              fontSize: 10,
              fontFamily: mono,
              textAlign: "center",
              marginTop: 8,
              paddingHorizontal: 12,
            }}
          >
            {debugInfo}
          </Text>
        )}
        <View style={{ flexDirection: "row", gap: 12, marginTop: 16 }}>
          {canRetry && (
            <Pressable
              onPress={() => {
                retriesRef.current += 1;
                reset();
                mutate();
              }}
              style={{
                paddingHorizontal: 16,
                paddingVertical: 8,
                borderRadius: R.md,
                borderWidth: 1,
                borderColor: C.border,
              }}
            >
              <Text style={{ color: C.info, fontWeight: "500" }}>Retry</Text>
            </Pressable>
          )}
          <Pressable
            onPress={async () => {
              try {
                await authClient.signOut();
              } catch {
                // ok
              }
              await SecureStore.deleteItemAsync("expo_cookie");
              await SecureStore.deleteItemAsync("expo_session_data");
              await SecureStore.deleteItemAsync("active_workspace_id");
              queryClient.clear();
              if (__DEV__) DevSettings.reload();
            }}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: R.md,
              borderWidth: 1,
              borderColor: C.critical,
            }}
          >
            <Text style={{ color: C.critical, fontWeight: "500" }}>
              Sign out & retry
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!workspaceReady || isPending) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" />
        <Text style={{ color: C.muted, marginTop: 12, fontSize: 13 }}>
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
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <Stack.Screen options={{ title: "Sortey" }} />
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <ActivityIndicator size="large" />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen options={{ title: "Sortey" }} />
      {session?.user ? <WorkspaceGate user={session.user} /> : <SignIn />}
    </View>
  );
}
