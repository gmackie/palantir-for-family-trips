import {
  supportedLocales,
  useLocaleNative,
  useTranslationsNative,
} from "@gmacko/i18n/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { Stack } from "expo-router";
import { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";
import { setLocale } from "~/utils/i18n";

const PERMISSIONS = ["read", "write", "delete", "admin"] as const;
const COLLABORATION_ROLES = ["member", "admin"] as const;

const C = {
  bg: "#141116",
  fg: "#f9f7fb",
  muted: "#8c8691",
  card: "#1e1b24",
  border: "#2f2a33",
  primary: "#d66daa",
  primaryFg: "#141116",
  danger: "#ef4444",
  dangerFg: "#ffffff",
  green: "#22c55e",
  greenBg: "#052e16",
  greenText: "#86efac",
  greenMuted: "#4ade80",
  inputBg: "#0d0b0f",
} as const;

function formatMoney(amountInCents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountInCents / 100);
}

function formatDate(value: Date | string | null) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  }).format(new Date(value));
}

function PreferencesSection() {
  "use no memo";
  const queryClient = useQueryClient();
  const _t = useTranslationsNative();
  const currentLocale = useLocaleNative();

  const { data: preferences, isLoading } = useQuery(
    trpc.settings.getPreferences.queryOptions(),
  );

  const { mutate: updatePreferences } = useMutation(
    trpc.settings.updatePreferences.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(
          trpc.settings.getPreferences.queryFilter(),
        );
      },
    }),
  );

  const handleThemeChange = (theme: "light" | "dark" | "system") => {
    updatePreferences({ theme });
  };

  const handleLanguageChange = (lang: string) => {
    void setLocale(lang);
    updatePreferences({ language: lang });
  };

  const toggleNotification = (type: "email" | "push") => {
    if (!preferences) return;

    if (type === "email") {
      updatePreferences({
        emailNotifications: !preferences.emailNotifications,
      });
    } else {
      updatePreferences({ pushNotifications: !preferences.pushNotifications });
    }
  };

  if (isLoading) {
    return (
      <View
        style={{
          borderWidth: 1,
          borderColor: C.border,
          backgroundColor: C.card,
          borderRadius: 8,
          padding: 16,
        }}
      >
        <Text style={{ color: C.fg, fontSize: 18, fontWeight: "600" }}>
          Preferences
        </Text>
        <Text style={{ color: C.muted, marginTop: 8 }}>Loading...</Text>
      </View>
    );
  }

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: C.border,
        backgroundColor: C.card,
        borderRadius: 8,
        padding: 16,
      }}
    >
      <Text
        style={{
          color: C.fg,
          fontSize: 18,
          fontWeight: "600",
          marginBottom: 16,
        }}
      >
        Preferences
      </Text>

      <Text
        style={{
          color: C.fg,
          fontSize: 14,
          fontWeight: "500",
          marginBottom: 8,
        }}
      >
        Theme
      </Text>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
        {(["light", "dark", "system"] as const).map((theme) => {
          const active = preferences?.theme === theme;
          return (
            <Pressable
              key={theme}
              onPress={() => handleThemeChange(theme)}
              style={{
                backgroundColor: active ? C.primary : C.bg,
                borderWidth: active ? 0 : 1,
                borderColor: C.border,
                borderRadius: 6,
                paddingHorizontal: 16,
                paddingVertical: 8,
              }}
            >
              <Text style={{ color: active ? C.primaryFg : C.fg }}>
                {theme.charAt(0).toUpperCase() + theme.slice(1)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text
        style={{
          color: C.fg,
          fontSize: 14,
          fontWeight: "500",
          marginBottom: 8,
        }}
      >
        Language
      </Text>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 16,
        }}
      >
        {supportedLocales.map((lang) => {
          const active = currentLocale === lang;
          return (
            <Pressable
              key={lang}
              onPress={() => handleLanguageChange(lang)}
              style={{
                backgroundColor: active ? C.primary : C.bg,
                borderWidth: active ? 0 : 1,
                borderColor: C.border,
                borderRadius: 6,
                paddingHorizontal: 16,
                paddingVertical: 8,
              }}
            >
              <Text style={{ color: active ? C.primaryFg : C.fg }}>
                {lang.toUpperCase()}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text
        style={{
          color: C.fg,
          fontSize: 14,
          fontWeight: "500",
          marginBottom: 8,
        }}
      >
        Notifications
      </Text>
      <View style={{ gap: 8 }}>
        <Pressable
          onPress={() => toggleNotification("email")}
          style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
        >
          <View
            style={{
              width: 20,
              height: 20,
              borderRadius: 4,
              borderWidth: 1,
              borderColor: preferences?.emailNotifications
                ? C.primary
                : C.border,
              backgroundColor: preferences?.emailNotifications
                ? C.primary
                : C.bg,
            }}
          />
          <Text style={{ color: C.fg }}>Email notifications</Text>
        </Pressable>
        <Pressable
          onPress={() => toggleNotification("push")}
          style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
        >
          <View
            style={{
              width: 20,
              height: 20,
              borderRadius: 4,
              borderWidth: 1,
              borderColor: preferences?.pushNotifications
                ? C.primary
                : C.border,
              backgroundColor: preferences?.pushNotifications
                ? C.primary
                : C.bg,
            }}
          />
          <Text style={{ color: C.fg }}>Push notifications</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ApiKeysSection() {
  "use no memo";
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([
    "read",
  ]);
  const [newKey, setNewKey] = useState<string | null>(null);

  const { data: apiKeys, isLoading } = useQuery(
    trpc.settings.listApiKeys.queryOptions(),
  );

  const { mutate: createKey, isPending: isCreating } = useMutation(
    trpc.settings.createApiKey.mutationOptions({
      onSuccess: (data) => {
        setNewKey(data.key);
        setNewKeyName("");
        setSelectedPermissions(["read"]);
        setShowCreateForm(false);
        void queryClient.invalidateQueries(
          trpc.settings.listApiKeys.queryFilter(),
        );
      },
    }),
  );

  const { mutate: revokeKey, isPending: isRevoking } = useMutation(
    trpc.settings.revokeApiKey.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(
          trpc.settings.listApiKeys.queryFilter(),
        );
      },
    }),
  );

  const handleCreateKey = () => {
    if (!newKeyName.trim() || selectedPermissions.length === 0) return;
    createKey({
      name: newKeyName,
      permissions: selectedPermissions as (
        | "read"
        | "write"
        | "delete"
        | "admin"
      )[],
    });
  };

  const handleRevokeKey = (id: string, name: string) => {
    Alert.alert(
      "Revoke API Key",
      `Are you sure you want to revoke "${name}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revoke",
          style: "destructive",
          onPress: () => revokeKey({ id }),
        },
      ],
    );
  };

  const togglePermission = (permission: string) => {
    setSelectedPermissions((prev) =>
      prev.includes(permission)
        ? prev.filter((p) => p !== permission)
        : [...prev, permission],
    );
  };

  const copyToClipboard = async (text: string) => {
    await Clipboard.setStringAsync(text);
    Alert.alert("Copied", "API key copied to clipboard");
  };

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: C.border,
        backgroundColor: C.card,
        borderRadius: 8,
        padding: 16,
        marginTop: 16,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <Text style={{ color: C.fg, fontSize: 18, fontWeight: "600" }}>
          API Keys
        </Text>
        {!showCreateForm && (
          <Pressable
            onPress={() => setShowCreateForm(true)}
            style={{
              backgroundColor: C.primary,
              borderRadius: 6,
              paddingHorizontal: 12,
              paddingVertical: 4,
            }}
          >
            <Text style={{ color: C.primaryFg }}>New Key</Text>
          </Pressable>
        )}
      </View>

      {newKey && (
        <View
          style={{
            marginBottom: 16,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: C.green,
            backgroundColor: C.greenBg,
            padding: 12,
          }}
        >
          <Text
            style={{
              fontWeight: "500",
              color: C.greenText,
              marginBottom: 4,
            }}
          >
            API Key Created
          </Text>
          <Text
            style={{
              fontSize: 12,
              color: C.greenMuted,
              marginBottom: 8,
            }}
          >
            Copy now. You won&apos;t see this again.
          </Text>
          <Pressable
            onPress={() => void copyToClipboard(newKey)}
            style={{
              backgroundColor: C.bg,
              borderRadius: 4,
              padding: 8,
            }}
          >
            <Text
              style={{
                color: C.fg,
                fontSize: 12,
                fontFamily: "Menlo",
              }}
            >
              {newKey}
            </Text>
          </Pressable>
          <Pressable onPress={() => setNewKey(null)} style={{ marginTop: 8 }}>
            <Text style={{ fontSize: 14, color: C.greenMuted }}>Dismiss</Text>
          </Pressable>
        </View>
      )}

      {showCreateForm && (
        <View
          style={{
            borderWidth: 1,
            borderColor: C.border,
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
          }}
        >
          <Text style={{ color: C.fg, fontWeight: "500", marginBottom: 8 }}>
            Create New API Key
          </Text>

          <TextInput
            value={newKeyName}
            onChangeText={setNewKeyName}
            placeholder="Key name"
            placeholderTextColor="#888"
            style={{
              borderWidth: 1,
              borderColor: C.border,
              backgroundColor: C.inputBg,
              color: C.fg,
              borderRadius: 6,
              paddingHorizontal: 12,
              paddingVertical: 8,
              marginBottom: 12,
            }}
          />

          <Text style={{ color: C.fg, fontSize: 14, marginBottom: 8 }}>
            Permissions
          </Text>
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 8,
              marginBottom: 12,
            }}
          >
            {PERMISSIONS.map((permission) => (
              <Pressable
                key={permission}
                onPress={() => togglePermission(permission)}
                style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
              >
                <View
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 4,
                    borderWidth: 1,
                    borderColor: selectedPermissions.includes(permission)
                      ? C.primary
                      : C.border,
                    backgroundColor: selectedPermissions.includes(permission)
                      ? C.primary
                      : C.bg,
                  }}
                />
                <Text
                  style={{
                    color: C.fg,
                    textTransform: "capitalize",
                  }}
                >
                  {permission}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              onPress={handleCreateKey}
              disabled={
                isCreating ||
                !newKeyName.trim() ||
                selectedPermissions.length === 0
              }
              style={{
                backgroundColor: C.primary,
                borderRadius: 6,
                paddingHorizontal: 16,
                paddingVertical: 8,
              }}
            >
              <Text style={{ color: C.primaryFg }}>Create</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setShowCreateForm(false);
                setNewKeyName("");
                setSelectedPermissions(["read"]);
              }}
              style={{
                borderWidth: 1,
                borderColor: C.border,
                borderRadius: 6,
                paddingHorizontal: 16,
                paddingVertical: 8,
              }}
            >
              <Text style={{ color: C.fg }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}

      {isLoading ? (
        <Text style={{ color: C.muted }}>Loading...</Text>
      ) : apiKeys?.length === 0 ? (
        <Text style={{ color: C.muted }}>No API keys created yet.</Text>
      ) : (
        <View style={{ gap: 8 }}>
          {apiKeys?.map((key) => (
            <View
              key={key.id}
              style={{
                borderWidth: 1,
                borderColor: C.border,
                borderRadius: 8,
                padding: 12,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.fg, fontWeight: "500" }}>
                  {key.name}
                </Text>
                <Text style={{ color: C.muted, fontSize: 12 }}>
                  {key.keyPrefix}... | {key.permissions.join(", ")}
                </Text>
                {key.lastUsedAt && (
                  <Text style={{ color: C.muted, fontSize: 12 }}>
                    Last used: {new Date(key.lastUsedAt).toLocaleDateString()}
                  </Text>
                )}
              </View>
              <Pressable
                onPress={() => handleRevokeKey(key.id, key.name)}
                disabled={isRevoking}
                style={{
                  backgroundColor: C.danger,
                  borderRadius: 6,
                  paddingHorizontal: 12,
                  paddingVertical: 4,
                }}
              >
                <Text style={{ color: C.dangerFg }}>Revoke</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function CollaborationSection() {
  "use no memo";
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");

  const { data: workspaceContext, isLoading: isWorkspaceLoading } = useQuery(
    trpc.settings.getWorkspaceContext.queryOptions(),
  );

  const { data: invites, isLoading: isInvitesLoading } = useQuery({
    ...trpc.settings.listInvites.queryOptions(),
    enabled: workspaceContext?.canManageWorkspace ?? false,
  });

  const { mutate: createInvite, isPending: isCreatingInvite } = useMutation(
    trpc.settings.createInvite.mutationOptions({
      onSuccess: async () => {
        setInviteEmail("");
        setInviteRole("member");
        await queryClient.invalidateQueries(
          trpc.settings.getWorkspaceContext.queryFilter(),
        );
        await queryClient.invalidateQueries(
          trpc.settings.listInvites.queryFilter(),
        );
        Alert.alert("Invite created", "The teammate invite is now pending.");
      },
      onError: (error) => {
        Alert.alert(
          "Could not create invite",
          error.message || "Try again from the current workspace.",
        );
      },
    }),
  );

  if (isWorkspaceLoading || !workspaceContext?.canManageWorkspace) {
    return null;
  }

  const handleCreateInvite = () => {
    if (!inviteEmail.trim()) {
      return;
    }

    createInvite({
      email: inviteEmail.trim(),
      role: inviteRole,
    });
  };

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: C.border,
        backgroundColor: C.card,
        borderRadius: 8,
        padding: 16,
        marginTop: 16,
      }}
    >
      <Text
        style={{
          color: C.fg,
          fontSize: 18,
          fontWeight: "600",
          marginBottom: 8,
        }}
      >
        Collaboration
      </Text>
      <Text style={{ color: C.muted, marginBottom: 16 }}>
        Invite teammates into{" "}
        {workspaceContext.workspace?.name ?? "this workspace"}. v1 keeps each
        account on a single active workspace and limits invites to member/admin
        roles.
      </Text>

      <Text
        style={{
          color: C.fg,
          fontSize: 14,
          fontWeight: "500",
          marginBottom: 8,
        }}
      >
        Invite teammate
      </Text>
      <TextInput
        value={inviteEmail}
        onChangeText={setInviteEmail}
        placeholder="teammate@example.com"
        placeholderTextColor="#888"
        autoCapitalize="none"
        keyboardType="email-address"
        style={{
          borderWidth: 1,
          borderColor: C.border,
          backgroundColor: C.inputBg,
          color: C.fg,
          borderRadius: 6,
          paddingHorizontal: 12,
          paddingVertical: 8,
          marginBottom: 12,
        }}
      />

      <Text
        style={{
          color: C.fg,
          fontSize: 14,
          fontWeight: "500",
          marginBottom: 8,
        }}
      >
        Role
      </Text>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 16,
        }}
      >
        {COLLABORATION_ROLES.map((role) => {
          const active = inviteRole === role;
          return (
            <Pressable
              key={role}
              onPress={() => setInviteRole(role)}
              style={{
                backgroundColor: active ? C.primary : C.bg,
                borderWidth: active ? 0 : 1,
                borderColor: C.border,
                borderRadius: 6,
                paddingHorizontal: 16,
                paddingVertical: 8,
              }}
            >
              <Text
                style={{
                  color: active ? C.primaryFg : C.fg,
                  textTransform: "capitalize",
                }}
              >
                {role}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        onPress={handleCreateInvite}
        disabled={isCreatingInvite || inviteEmail.trim().length === 0}
        style={{
          backgroundColor: C.primary,
          borderRadius: 6,
          paddingHorizontal: 16,
          paddingVertical: 12,
          marginBottom: 16,
        }}
      >
        <Text
          style={{
            color: C.primaryFg,
            textAlign: "center",
            fontWeight: "500",
          }}
        >
          {isCreatingInvite ? "Sending..." : "Send Invite"}
        </Text>
      </Pressable>

      <Text
        style={{
          color: C.fg,
          fontSize: 14,
          fontWeight: "500",
          marginBottom: 8,
        }}
      >
        Pending invites
      </Text>
      {isInvitesLoading ? (
        <Text style={{ color: C.muted }}>Loading...</Text>
      ) : invites && invites.length > 0 ? (
        <View style={{ gap: 8 }}>
          {invites.map((invite) => (
            <View
              key={invite.id}
              style={{
                borderWidth: 1,
                borderColor: C.border,
                borderRadius: 8,
                padding: 12,
              }}
            >
              <Text style={{ color: C.fg, fontWeight: "500" }}>
                {invite.email}
              </Text>
              <Text style={{ color: C.muted, textTransform: "capitalize" }}>
                {invite.role}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={{ color: C.muted }}>No pending invites yet.</Text>
      )}
    </View>
  );
}

function BillingUsageSection() {
  "use no memo";
  const { data, isLoading } = useQuery(
    trpc.settings.getBillingOverview.queryOptions(),
  );

  if (isLoading) {
    return (
      <View
        style={{
          borderWidth: 1,
          borderColor: C.border,
          backgroundColor: C.card,
          borderRadius: 8,
          padding: 16,
          marginTop: 16,
        }}
      >
        <Text style={{ color: C.fg, fontSize: 18, fontWeight: "600" }}>
          Billing & Usage
        </Text>
        <Text style={{ color: C.muted, marginTop: 8 }}>Loading...</Text>
      </View>
    );
  }

  if (!data?.billing.visible && !data?.usage.visible) {
    return null;
  }

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: C.border,
        backgroundColor: C.card,
        borderRadius: 8,
        padding: 16,
        marginTop: 16,
      }}
    >
      <Text
        style={{
          color: C.fg,
          fontSize: 18,
          fontWeight: "600",
          marginBottom: 8,
        }}
      >
        Billing
      </Text>
      <Text style={{ color: C.muted, marginBottom: 16 }}>
        Billing stays per-workspace in v1, and seat billing is intentionally
        deferred.
      </Text>

      <View
        style={{
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: 8,
          padding: 12,
          marginBottom: 16,
        }}
      >
        <Text style={{ color: C.fg, fontWeight: "500" }}>Current plan</Text>
        {data?.billing.plan ? (
          <>
            <Text style={{ color: C.fg, marginTop: 8 }}>
              {data.billing.plan.name}
            </Text>
            <Text style={{ color: C.muted }}>
              {formatMoney(
                data.billing.plan.amountInCents,
                data.billing.plan.currency,
              )}{" "}
              / {data.billing.plan.interval}
            </Text>
          </>
        ) : (
          <Text style={{ color: C.muted, marginTop: 8 }}>
            No workspace plan is configured yet.
          </Text>
        )}
      </View>

      <View
        style={{
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: 8,
          padding: 12,
          marginBottom: 16,
        }}
      >
        <Text style={{ color: C.fg, fontWeight: "500" }}>Subscription</Text>
        {data?.billing.subscription ? (
          <>
            <Text
              style={{
                color: C.fg,
                marginTop: 8,
                textTransform: "capitalize",
              }}
            >
              {data.billing.subscription.status.replaceAll("_", " ")}
            </Text>
            <Text style={{ color: C.muted, textTransform: "capitalize" }}>
              Provider: {data.billing.subscription.provider}
            </Text>
            <Text style={{ color: C.muted }}>
              Current period ends{" "}
              {formatDate(data.billing.subscription.currentPeriodEnd)}
            </Text>
          </>
        ) : (
          <Text style={{ color: C.muted, marginTop: 8 }}>
            No paid subscription is attached yet.
          </Text>
        )}
      </View>

      <View
        style={{
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: 8,
          padding: 12,
        }}
      >
        <Text style={{ color: C.fg, fontWeight: "500" }}>Usage & Limits</Text>
        {data?.usage.limits.length ? (
          <View style={{ marginTop: 12, gap: 8 }}>
            {data.usage.limits.map(
              (limit: (typeof data.usage.limits)[number]) => (
                <View
                  key={limit.key}
                  style={{
                    borderWidth: 1,
                    borderColor: C.border,
                    borderRadius: 6,
                    padding: 12,
                  }}
                >
                  <Text style={{ color: C.fg, fontWeight: "500" }}>
                    {limit.key}
                  </Text>
                  <Text style={{ color: C.muted, textTransform: "capitalize" }}>
                    {limit.period.replaceAll("_", " ")}
                  </Text>
                  <Text style={{ color: C.fg, marginTop: 4 }}>
                    {limit.currentUsage} /{" "}
                    {limit.value === null ? "Unlimited" : limit.value}
                  </Text>
                </View>
              ),
            )}
          </View>
        ) : (
          <Text style={{ color: C.muted, marginTop: 8 }}>
            No limits are configured yet.
          </Text>
        )}

        {data?.usage.meters.length ? (
          <View style={{ marginTop: 16, gap: 8 }}>
            {data.usage.meters.map(
              (meter: (typeof data.usage.meters)[number]) => (
                <View
                  key={meter.key}
                  style={{
                    borderWidth: 1,
                    borderColor: C.border,
                    borderRadius: 6,
                    padding: 12,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <Text style={{ color: C.fg, fontWeight: "500" }}>
                      {meter.name}
                    </Text>
                    <Text style={{ color: C.fg }}>
                      {meter.currentUsage} {meter.unit}
                    </Text>
                  </View>
                  <Text style={{ color: C.muted, marginTop: 4 }}>
                    {meter.key} - {meter.aggregation}
                  </Text>
                  <Text style={{ color: C.muted, marginTop: 4 }}>
                    {formatDate(meter.latestPeriodStart)} -{" "}
                    {formatDate(meter.latestPeriodEnd)}
                  </Text>
                </View>
              ),
            )}
          </View>
        ) : (
          <Text style={{ color: C.muted, marginTop: 16 }}>
            No usage meters are configured yet.
          </Text>
        )}
      </View>
    </View>
  );
}

function AccountSection() {
  const { mutate: deleteAccount, isPending } = useMutation(
    trpc.settings.deleteAccount.mutationOptions({
      onSuccess: async () => {
        await authClient.signOut();
        Alert.alert("Account deleted", "Your account has been deleted.");
      },
    }),
  );

  const handleDeleteAccount = () => {
    Alert.alert(
      "Delete Account",
      "This permanently deletes your account, sessions, API keys, and preferences.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Account",
          style: "destructive",
          onPress: () => deleteAccount(),
        },
      ],
    );
  };

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: C.border,
        backgroundColor: C.card,
        borderRadius: 8,
        padding: 16,
        marginTop: 16,
      }}
    >
      <Text
        style={{
          color: C.fg,
          fontSize: 18,
          fontWeight: "600",
          marginBottom: 8,
        }}
      >
        Account
      </Text>
      <Text style={{ color: C.muted, marginBottom: 16 }}>
        App Store review requires in-app account deletion when account creation
        is supported.
      </Text>
      <Pressable
        onPress={handleDeleteAccount}
        disabled={isPending}
        style={{
          backgroundColor: C.danger,
          borderRadius: 6,
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        <Text
          style={{
            color: C.dangerFg,
            textAlign: "center",
            fontWeight: "500",
          }}
        >
          {isPending ? "Deleting..." : "Delete Account"}
        </Text>
      </Pressable>
    </View>
  );
}

export default function SettingsScreen() {
  "use no memo";
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: "Settings",
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.fg,
        }}
      />
      <ScrollView style={{ flex: 1, padding: 16 }}>
        <Text
          style={{
            color: C.fg,
            fontSize: 24,
            fontWeight: "bold",
            marginBottom: 16,
          }}
        >
          Settings
        </Text>
        <PreferencesSection />
        <ApiKeysSection />
        <BillingUsageSection />
        <CollaborationSection />
        <AccountSection />
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}
