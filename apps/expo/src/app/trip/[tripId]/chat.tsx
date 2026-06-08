import type { ChatMessage } from "@sortey/realtime";
import { useTripChat } from "@sortey/realtime";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { trpc, trpcClient } from "~/utils/api";
import { authClient } from "~/utils/auth";
import { getBaseUrl } from "~/utils/base-url";
import { C, mono, PALETTE, R } from "~/utils/design";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

/**
 * `useTripChat` appends `/api/chat/${tripId}/ws`, so it wants just the
 * `wss://host` (or `ws://host` on plain-http dev) origin. We derive it from the
 * same base URL the tRPC client uses, swapping the HTTP scheme for the WS one.
 */
function deriveWsBaseUrl(): string {
  const base = getBaseUrl();
  if (base.startsWith("https://"))
    return `wss://${base.slice("https://".length)}`;
  if (base.startsWith("http://")) return `ws://${base.slice("http://".length)}`;
  return base;
}

function formatTime(value: ChatMessage["createdAt"]): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function isDeleted(message: ChatMessage): boolean {
  return message.deletedAt != null || message.body === "";
}

function colorForUser(userId: string): string {
  // Deterministic palette pick so a sender keeps the same color across renders.
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length]!;
}

export default function ChatScreen() {
  "use no memo";
  const { tripId: tripIdParam } = useLocalSearchParams<{ tripId: string }>();
  const tripId = tripIdParam ?? "";
  const workspaceId = getActiveWorkspaceId() ?? "";

  const session = authClient.useSession();
  const currentUserId = session.data?.user?.id ?? "";

  // Roster -> sender display names / colors. Cheap, cached query.
  const { data: members } = useQuery({
    ...trpc.trips.listMembers.queryOptions({ workspaceId, tripId }),
    retry: false,
  });

  const memberMap = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    for (const m of members ?? []) {
      map.set(m.userId, {
        name: m.displayName ?? "Member",
        color: m.colorHex ?? colorForUser(m.userId),
      });
    }
    return map;
  }, [members]);

  // Bridge the vanilla tRPC client into the plain callbacks `useTripChat` wants
  // (it keeps these in refs, so identity changes never tear down a healthy
  // socket). This mirrors the web panel's `trpcClient.chat.*` wiring — the expo
  // options-proxy only exposes `queryOptions`/`mutationOptions`, so the vanilla
  // client (exported alongside it from `~/utils/api`) is the clean imperative
  // path: `chat.history.query(...)` for backfill, `chat.send.mutate(...)` for
  // optimistic send.
  const history = useCallback(
    (opts: { tripId: string; limit?: number }) =>
      trpcClient.chat.history.query({
        workspaceId,
        tripId: opts.tripId,
        ...(opts.limit != null ? { limit: opts.limit } : {}),
      }),
    [workspaceId],
  );

  const sendMessage = useCallback(
    (body: string) =>
      trpcClient.chat.send.mutate({ workspaceId, tripId, body }),
    [workspaceId, tripId],
  );

  const wsBaseUrl = useMemo(() => deriveWsBaseUrl(), []);

  const { messages, presence, typing, connected, loading, send, sendTyping } =
    useTripChat({ tripId, wsBaseUrl, history, sendMessage });

  // Reconnecting = initial load done but socket down (connected is legitimately
  // false during the first load, so gate on !loading).
  const reconnecting = !loading && !connected;

  // Inverted list renders newest-at-bottom, so feed it newest-first.
  const ordered = useMemo(() => [...messages].reverse(), [messages]);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);

  const handleSend = useCallback(async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setSendFailed(false);
    setDraft("");
    try {
      await send(body);
    } catch {
      // Restore the draft AND surface the failure (no silent drop).
      setDraft(body);
      setSendFailed(true);
    } finally {
      setSending(false);
    }
  }, [draft, sending, send]);

  const othersTyping = typing.filter((u) => u !== currentUserId);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: "Chat",
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.fg,
        }}
      />

      {/* Presence line */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: C.border,
          backgroundColor: C.surface,
        }}
      >
        <View
          style={{
            width: 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: connected
              ? C.success
              : reconnecting
                ? C.warning
                : C.muted,
          }}
        />
        <Text
          style={{
            color: C.muted,
            fontSize: 11,
            fontWeight: "600",
            textTransform: "uppercase",
            letterSpacing: 1,
            fontFamily: mono,
          }}
        >
          {reconnecting ? "reconnecting…" : `${presence.length} online`}
        </Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 96 : 0}
        style={{ flex: 1 }}
      >
        <FlatList
          data={ordered}
          inverted
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const meta = memberMap.get(item.userId);
            const mine = item.userId === currentUserId;
            const name = mine ? "You" : (meta?.name ?? "Member");
            const color = mine
              ? C.info
              : (meta?.color ?? colorForUser(item.userId));
            const deleted = isDeleted(item);

            return (
              <View style={{ gap: 2 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "baseline",
                    gap: 8,
                  }}
                >
                  <Text style={{ color, fontSize: 13, fontWeight: "700" }}>
                    {name}
                  </Text>
                  <Text
                    style={{
                      color: C.placeholder,
                      fontSize: 11,
                      fontFamily: mono,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {formatTime(item.createdAt)}
                  </Text>
                </View>
                {deleted ? (
                  <Text
                    style={{
                      color: C.placeholder,
                      fontSize: 14,
                      fontStyle: "italic",
                    }}
                  >
                    message deleted
                  </Text>
                ) : (
                  <Text style={{ color: C.fg, fontSize: 15, lineHeight: 20 }}>
                    {item.body}
                  </Text>
                )}
              </View>
            );
          }}
          ListEmptyComponent={
            <View
              style={{
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: 60,
                // Counteract `inverted` so the empty/loading state reads upright.
                transform: [{ scaleY: -1 }],
              }}
            >
              {loading ? (
                <ActivityIndicator color={C.muted} size="small" />
              ) : (
                <Text style={{ color: C.muted, fontSize: 15 }}>
                  No messages yet. Say hello.
                </Text>
              )}
            </View>
          }
        />

        {/* Typing indicator */}
        <View
          style={{
            height: 18,
            justifyContent: "center",
            paddingHorizontal: 16,
          }}
        >
          {sendFailed ? (
            <Pressable onPress={() => void handleSend()}>
              <Text
                style={{
                  color: C.critical,
                  fontSize: 11,
                  fontFamily: mono,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                failed to send — retry
              </Text>
            </Pressable>
          ) : othersTyping.length > 0 ? (
            <Text style={{ color: C.muted, fontSize: 11, fontFamily: mono }}>
              {othersTyping.length === 1
                ? "typing…"
                : `${othersTyping.length} people typing…`}
            </Text>
          ) : null}
        </View>

        {/* Composer */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-end",
            gap: 8,
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: 28,
            borderTopWidth: 1,
            borderTopColor: C.border,
            backgroundColor: C.surface,
          }}
        >
          <TextInput
            value={draft}
            onChangeText={(text) => {
              setDraft(text);
              if (sendFailed) setSendFailed(false);
              sendTyping();
            }}
            placeholder="Message the trip…"
            placeholderTextColor={C.placeholder}
            multiline
            style={{
              flex: 1,
              maxHeight: 120,
              minHeight: 44,
              backgroundColor: C.bg,
              borderWidth: 1,
              borderColor: C.border,
              borderRadius: R.md,
              paddingHorizontal: 12,
              paddingTop: 12,
              paddingBottom: 12,
              color: C.fg,
              fontSize: 15,
            }}
          />
          <Pressable
            onPress={() => {
              void handleSend();
            }}
            disabled={sending || draft.trim().length === 0}
            style={{
              backgroundColor: C.info,
              borderRadius: R.md,
              paddingHorizontal: 18,
              minHeight: 44,
              alignItems: "center",
              justifyContent: "center",
              opacity: sending || draft.trim().length === 0 ? 0.5 : 1,
            }}
          >
            {sending ? (
              <ActivityIndicator color={C.white} size="small" />
            ) : (
              <Text
                style={{
                  color: C.white,
                  fontWeight: "700",
                  fontSize: 13,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                Send
              </Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
