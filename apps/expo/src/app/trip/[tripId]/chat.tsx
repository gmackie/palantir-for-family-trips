import type { PlanOption } from "@sortey/api/copilot";
import { steerCopilot } from "@sortey/api/copilot";
import type { ChatMessage } from "@sortey/realtime";
import { useTripChat } from "@sortey/realtime";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
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

import { PlanChrome } from "~/components/trip/plan-chrome";
import { PlanOptionCards } from "~/components/trip/plan-option-cards";
import { trpc, trpcClient } from "~/utils/api";
import { authClient } from "~/utils/auth";
import { getBaseUrl } from "~/utils/base-url";
import { C, mono, PALETTE, R } from "~/utils/design";
import { fetchIsOnline } from "~/utils/network-status";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

type LocalCopilotTurn = {
  id: string;
  role: "user" | "copilot";
  body: string;
  options?: PlanOption[];
  recommendedOptionId?: string;
  createdAt: Date;
};

function deriveWsBaseUrl(): string {
  const base = getBaseUrl();
  if (base.startsWith("https://"))
    return `wss://${base.slice("https://".length)}`;
  if (base.startsWith("http://")) return `ws://${base.slice("http://".length)}`;
  return base;
}

function formatTime(value: Date | string | number): string {
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
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length]!;
}

function looksLikePlanning(text: string): boolean {
  return /camp|tonight|zion|bryce|utah|costco|laundry|truck|denver|yosemite|drive|hours|hike|heat|stage|gj|grand junction|omaha|tahoe|fuel|how long/i.test(
    text,
  );
}

export default function ChatScreen() {
  "use no memo";
  const { tripId: tripIdParam } = useLocalSearchParams<{ tripId: string }>();
  const tripId = tripIdParam ?? "";
  const workspaceId = getActiveWorkspaceId() ?? "";
  const router = useRouter();

  const session = authClient.useSession();
  const currentUserId = session.data?.user?.id ?? "";

  const { data: members } = useQuery({
    ...trpc.trips.listMembers.queryOptions({ workspaceId, tripId }),
    retry: false,
  });

  const { data: todayCmd } = useQuery({
    ...trpc.planner.todayCommand.queryOptions({
      workspaceId,
      tripId,
    }),
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

  const reconnecting = !loading && !connected;
  const ordered = useMemo(() => [...messages].reverse(), [messages]);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [copilotBusy, setCopilotBusy] = useState(false);
  const [localTurns, setLocalTurns] = useState<LocalCopilotTurn[]>([]);
  const [chrome, setChrome] = useState<{
    tonightPlace?: string;
    tonightKind?: string;
    nextNights?: Array<{ date: string; place: string }>;
    nextAnchorTitle?: string;
    nextAnchorDate?: string;
    facts?: string[];
  }>({});
  const [appliedOptionId, setAppliedOptionId] = useState<string | null>(null);

  // Merge server messages with local co-pilot turns for display (local on top when inverted = appear newest)
  type Row =
    | { kind: "server"; msg: ChatMessage }
    | { kind: "local"; turn: LocalCopilotTurn };

  const listData: Row[] = useMemo(() => {
    const serverRows: Row[] = ordered.map((msg) => ({ kind: "server", msg }));
    const localRows: Row[] = [...localTurns]
      .reverse()
      .map((turn) => ({ kind: "local", turn }));
    // inverted list: index 0 is bottom (newest). Put newest locals first.
    return [...localRows, ...serverRows];
  }, [ordered, localTurns]);

  const runCopilot = useCallback(
    async (message: string) => {
      setCopilotBusy(true);
      const userTurn: LocalCopilotTurn = {
        id: `local-user-${Date.now()}`,
        role: "user",
        body: message,
        createdAt: new Date(),
      };
      setLocalTurns((prev) => [...prev, userTurn]);

      try {
        const online = await fetchIsOnline();
        let result: ReturnType<typeof steerCopilot>;
        if (online && workspaceId && tripId) {
          try {
            result = await trpcClient.copilot.steer.mutate({
              workspaceId,
              tripId,
              message,
              today: new Date().toISOString().slice(0, 10),
            });
          } catch {
            result = steerCopilot({
              message,
              today: new Date().toISOString().slice(0, 10),
            });
          }
        } else {
          result = steerCopilot({
            message,
            today: new Date().toISOString().slice(0, 10),
          });
        }

        const copilotTurn: LocalCopilotTurn = {
          id: `local-copilot-${Date.now()}`,
          role: "copilot",
          body: result.reply,
          options: result.options,
          recommendedOptionId: result.recommendedOptionId,
          createdAt: new Date(),
        };
        setLocalTurns((prev) => [...prev, copilotTurn]);

        if (result.chrome) {
          setChrome((prev) => ({
            ...prev,
            tonightPlace: result.chrome?.tonightPlace ?? prev.tonightPlace,
            tonightKind: result.chrome?.tonightKind ?? prev.tonightKind,
            nextAnchorTitle:
              result.chrome?.nextAnchorTitle ?? prev.nextAnchorTitle,
            nextAnchorDate: result.chrome?.nextAnchorDate ?? prev.nextAnchorDate,
            facts: result.chrome?.facts ?? prev.facts,
          }));
        }

        // Mirror co-pilot prose into trip chat when online (so party sees it)
        if (online && workspaceId && tripId) {
          const cardNote =
            result.options.length > 0
              ? `\n\n[Plan options: ${result.options.map((o) => o.title).join(" | ")}]`
              : "";
          try {
            await trpcClient.chat.send.mutate({
              workspaceId,
              tripId,
              body: `🧭 Sortie: ${result.reply}${cardNote}`.slice(0, 3900),
            });
          } catch {
            // local UI already has the turn
          }
        }
      } finally {
        setCopilotBusy(false);
      }
    },
    [workspaceId, tripId],
  );

  const handleSend = useCallback(async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setSendFailed(false);
    setDraft("");

    const planning = looksLikePlanning(body);

    try {
      // Always try party chat when possible
      try {
        await send(body);
      } catch {
        if (!planning) {
          setDraft(body);
          setSendFailed(true);
          return;
        }
        // Planning can continue offline without server chat
      }

      if (planning) {
        await runCopilot(body);
      }
    } finally {
      setSending(false);
    }
  }, [draft, sending, send, runCopilot]);

  const handleApply = useCallback((opt: PlanOption) => {
    setAppliedOptionId(opt.id);
    const tonight = opt.nights[0];
    setChrome((prev) => ({
      ...prev,
      tonightPlace: tonight?.place ?? prev.tonightPlace,
      tonightKind: tonight?.kind ?? prev.tonightKind,
      nextNights: opt.nights.slice(0, 5).map((n) => ({
        date: n.date,
        place: n.place,
      })),
      facts: [
        `Applied: ${opt.title}`,
        `${opt.costs.totalDriveHours.toFixed(1)}h total in option`,
        ...(prev.facts ?? []).slice(0, 2),
      ],
    }));
  }, []);

  const othersTyping = typing.filter((u) => u !== currentUserId);

  // Seed chrome from today command when available
  const chromeMerged = {
    tonightPlace:
      chrome.tonightPlace ??
      todayCmd?.day?.overnightName ??
      todayCmd?.day?.title ??
      null,
    tonightKind: chrome.tonightKind ?? null,
    nextNights: chrome.nextNights,
    nextAnchorTitle:
      chrome.nextAnchorTitle ?? todayCmd?.nextAnchor?.title ?? null,
    nextAnchorDate:
      chrome.nextAnchorDate ??
      todayCmd?.nextAnchor?.startDate ??
      null,
    facts: chrome.facts,
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: "Chat",
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.fg,
        }}
      />

      <PlanChrome
        tonightPlace={chromeMerged.tonightPlace}
        tonightKind={chromeMerged.tonightKind}
        nextNights={chromeMerged.nextNights}
        nextAnchorTitle={chromeMerged.nextAnchorTitle}
        nextAnchorDate={chromeMerged.nextAnchorDate}
        facts={chromeMerged.facts}
        offline={!connected}
        onOpenMap={() =>
          router.push({
            pathname: "/trip/[tripId]/map" as never,
            params: { tripId },
          })
        }
      />

      {/* Presence */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 16,
          paddingVertical: 8,
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
          {reconnecting
            ? "reconnecting…"
            : `${presence.length} online · co-pilot ${copilotBusy ? "thinking" : "ready"}`}
        </Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 96 : 0}
        style={{ flex: 1 }}
      >
        <FlatList
          data={listData}
          inverted
          keyExtractor={(item) =>
            item.kind === "server" ? item.msg.id : item.turn.id
          }
          contentContainerStyle={{ padding: 16, gap: 12 }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            if (item.kind === "local") {
              const turn = item.turn;
              const copilot = turn.role === "copilot";
              return (
                <View style={{ gap: 4 }}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "baseline",
                      gap: 8,
                    }}
                  >
                    <Text
                      style={{
                        color: copilot ? C.warning : C.info,
                        fontSize: 13,
                        fontWeight: "700",
                      }}
                    >
                      {copilot ? "Sortie" : "You"}
                    </Text>
                    <Text
                      style={{
                        color: C.placeholder,
                        fontSize: 11,
                        fontFamily: mono,
                      }}
                    >
                      {formatTime(turn.createdAt)}
                      {copilot ? " · co-pilot" : ""}
                    </Text>
                  </View>
                  <Text style={{ color: C.fg, fontSize: 15, lineHeight: 20 }}>
                    {turn.body}
                  </Text>
                  {copilot && turn.options && turn.options.length > 0 ? (
                    <PlanOptionCards
                      options={turn.options}
                      recommendedId={turn.recommendedOptionId}
                      appliedId={appliedOptionId}
                      onApply={handleApply}
                    />
                  ) : null}
                </View>
              );
            }

            const msg = item.msg;
            const meta = memberMap.get(msg.userId);
            const mine = msg.userId === currentUserId;
            const name = mine ? "You" : (meta?.name ?? "Member");
            const color = mine
              ? C.info
              : (meta?.color ?? colorForUser(msg.userId));
            const deleted = isDeleted(msg);
            const isCopilotMirror = msg.body.startsWith("🧭 Sortie:");

            return (
              <View style={{ gap: 2 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "baseline",
                    gap: 8,
                  }}
                >
                  <Text
                    style={{
                      color: isCopilotMirror ? C.warning : color,
                      fontSize: 13,
                      fontWeight: "700",
                    }}
                  >
                    {isCopilotMirror ? "Sortie" : name}
                  </Text>
                  <Text
                    style={{
                      color: C.placeholder,
                      fontSize: 11,
                      fontFamily: mono,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {formatTime(msg.createdAt)}
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
                    {isCopilotMirror
                      ? msg.body.replace(/^🧭 Sortie:\s*/, "")
                      : msg.body}
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
                paddingVertical: 40,
                transform: [{ scaleY: -1 }],
                paddingHorizontal: 12,
                gap: 8,
              }}
            >
              {loading ? (
                <ActivityIndicator color={C.muted} size="small" />
              ) : (
                <>
                  <Text
                    style={{
                      color: C.fg,
                      fontSize: 15,
                      fontWeight: "700",
                      textAlign: "center",
                    }}
                  >
                    Trip chat + co-pilot
                  </Text>
                  <Text
                    style={{
                      color: C.muted,
                      fontSize: 13,
                      textAlign: "center",
                      lineHeight: 18,
                    }}
                  >
                    Try: “laundry near Tracy”, “2 Zion or 2 Bryce”, “how long
                    Bryce to Denver”
                  </Text>
                </>
              )}
            </View>
          }
        />

        <View
          style={{
            minHeight: 18,
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
          ) : copilotBusy ? (
            <Text style={{ color: C.warning, fontSize: 11, fontFamily: mono }}>
              co-pilot…
            </Text>
          ) : othersTyping.length > 0 ? (
            <Text style={{ color: C.muted, fontSize: 11, fontFamily: mono }}>
              {othersTyping.length === 1
                ? "typing…"
                : `${othersTyping.length} people typing…`}
            </Text>
          ) : null}
        </View>

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
              sendTyping();
            }}
            placeholder="Message party or co-pilot…"
            placeholderTextColor={C.placeholder}
            multiline
            style={{
              flex: 1,
              maxHeight: 120,
              color: C.fg,
              fontSize: 15,
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderWidth: 1,
              borderColor: C.border,
              borderRadius: R.md,
              backgroundColor: C.bg,
            }}
          />
          <Pressable
            onPress={() => void handleSend()}
            disabled={!draft.trim() || sending || copilotBusy}
            style={{
              backgroundColor:
                !draft.trim() || sending || copilotBusy ? C.border : C.info,
              borderRadius: R.md,
              paddingHorizontal: 16,
              paddingVertical: 12,
              minHeight: 44,
              justifyContent: "center",
            }}
          >
            <Text style={{ color: C.white, fontWeight: "800", fontSize: 14 }}>
              {sending || copilotBusy ? "…" : "Send"}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
