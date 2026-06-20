"use client";

import type { ChatMessage } from "@sortey/realtime";
import { useTripChat } from "@sortey/realtime";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useTRPC, useTRPCClient } from "~/trpc/react";

/**
 * Derive the WebSocket origin from the current page origin. `useTripChat`
 * appends `/api/chat/${tripId}/ws`, so we hand it just the `wss://host` (or
 * `ws://host` on plain-http dev). Empty string during SSR / first paint; the
 * hook no-ops without a `WebSocket` global there and (re)connects on the client.
 */
function deriveWsBaseUrl(): string {
  if (typeof window === "undefined") return "";
  const { protocol, host } = window.location;
  const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
  return `${wsProtocol}//${host}`;
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

export function ChatPanel(props: {
  workspaceId: string;
  tripId: string;
  currentUserId: string;
}) {
  const { workspaceId, tripId, currentUserId } = props;
  const trpc = useTRPC();
  // Vanilla tRPC client from the same provider as the React-Query hooks
  // (`createTRPCContext` -> `useTRPCClient`). The chat hook wants plain
  // `.query` / `.mutate` callbacks, so we adapt the hooks client to it here.
  const trpcClient = useTRPCClient();

  // Roster -> sender display names / colors. Cheap, cached query.
  const { data: members } = useQuery(
    trpc.trips.listMembers.queryOptions({ workspaceId, tripId }),
  );

  const memberMap = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    for (const m of members ?? []) {
      map.set(m.userId, {
        name: m.displayName ?? "Member",
        color: m.colorHex ?? "#58A6FF",
      });
    }
    return map;
  }, [members]);

  // Stable callbacks bridging the vanilla client into `useTripChat`. The hook
  // keeps these in refs, so identity changes don't tear down a healthy socket,
  // but we memoize anyway to avoid needless work.
  const history = useCallback(
    (opts: { tripId: string; limit?: number }) =>
      trpcClient.chat.history.query({
        workspaceId,
        tripId: opts.tripId,
        ...(opts.limit != null ? { limit: opts.limit } : {}),
      }),
    [trpcClient, workspaceId],
  );

  const sendMessage = useCallback(
    (body: string) =>
      trpcClient.chat.send.mutate({ workspaceId, tripId, body }),
    [trpcClient, workspaceId, tripId],
  );

  const wsBaseUrl = useMemo(() => deriveWsBaseUrl(), []);

  const { messages, presence, typing, connected, loading, send, sendTyping } =
    useTripChat({ tripId, wsBaseUrl, history, sendMessage });

  // Reconnecting = we finished the initial load but the socket is down. During
  // the initial load `connected` is legitimately false, so gate on !loading.
  const reconnecting = !loading && !connected;

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);

  // Auto-scroll to newest on new messages.
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  // Typing indicator: anyone typing other than us.
  const othersTyping = typing.filter((u) => u !== currentUserId);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header / presence */}
      <div className="flex items-center justify-between border-b border-[#21262D] px-1 pb-3">
        <h1 className="text-xl font-bold text-[#C9D1D9]">Chat</h1>
        <div className="flex items-center gap-2">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              connected
                ? "bg-[#3FB950]"
                : reconnecting
                  ? "bg-[#D29922]"
                  : "bg-[#8B949E]"
            }`}
            aria-hidden
          />
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#8B949E]">
            {reconnecting ? "reconnecting…" : `${presence.length} online`}
          </span>
        </div>
      </div>

      {/* Message list */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-1 py-4"
      >
        {loading ? (
          <div
            className="space-y-3"
            aria-busy="true"
            aria-label="Loading messages"
          >
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-1">
                <div className="h-2.5 w-24 animate-pulse rounded-[2px] bg-[#21262D]" />
                <div className="h-3 w-2/3 animate-pulse rounded-[2px] bg-[#161B22]" />
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <p className="py-12 text-center text-sm text-[#484F58]">
            No messages yet. Say hello.
          </p>
        ) : (
          messages.map((message) => {
            const meta = memberMap.get(message.userId);
            const name = meta?.name ?? "Member";
            const color = meta?.color ?? "#58A6FF";
            const mine = message.userId === currentUserId;
            const deleted = isDeleted(message);

            return (
              <div key={message.id} className="flex flex-col gap-0.5">
                <div className="flex items-baseline gap-2">
                  <span
                    className="text-xs font-semibold"
                    style={{ color: mine ? "#58A6FF" : color }}
                  >
                    {mine ? "You" : name}
                  </span>
                  <span className="font-mono text-[10px] tabular-nums text-[#484F58]">
                    {formatTime(message.createdAt)}
                  </span>
                </div>
                {deleted ? (
                  <p className="text-xs italic text-[#484F58]">
                    message deleted
                  </p>
                ) : (
                  <p className="whitespace-pre-wrap break-words text-sm text-[#C9D1D9]">
                    {message.body}
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Typing indicator / send-failure — static all-caps (minimal-functional motion per DESIGN.md) */}
      <div className="h-4 px-1">
        {sendFailed ? (
          <button
            type="button"
            onClick={() => void handleSend()}
            className="font-mono text-[10px] uppercase tracking-wider text-[#F85149] hover:underline"
          >
            failed to send — retry
          </button>
        ) : othersTyping.length > 0 ? (
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#8B949E]">
            {othersTyping.length === 1
              ? "typing"
              : `${othersTyping.length} typing`}
          </span>
        ) : null}
      </div>

      {/* Composer */}
      <div className="flex items-end gap-2 border-t border-[#21262D] px-1 pt-3">
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (sendFailed) setSendFailed(false);
            sendTyping();
          }}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="Message the trip..."
          className="max-h-32 min-h-11 flex-1 resize-none rounded-[4px] border border-[#21262D] bg-[#0D1117] px-3 py-2.5 text-sm text-[#C9D1D9] placeholder:text-[#484F58] focus:border-[#58A6FF]/40 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={sending || draft.trim().length === 0}
          className="min-h-11 shrink-0 rounded-[4px] border border-[#58A6FF]/30 bg-[#58A6FF]/10 px-4 text-[10px] font-semibold uppercase tracking-wider text-[#58A6FF] transition-colors hover:bg-[#58A6FF]/20 disabled:opacity-40"
        >
          {sending ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}
