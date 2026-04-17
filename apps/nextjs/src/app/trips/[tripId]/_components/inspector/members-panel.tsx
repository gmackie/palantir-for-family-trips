"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useTRPC } from "~/trpc/react";

export function MembersPanel(props: {
  tripId: string;
  workspaceId: string;
}) {
  const { tripId, workspaceId } = props;
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);

  const { data: summary, isLoading } = useQuery(
    trpc.settlements.summary.queryOptions({ workspaceId, tripId }),
  );

  const createInvite = useMutation(
    trpc.trips.createInvite.mutationOptions({
      onSuccess: (data) => {
        const inviteUrl = `${window.location.origin}/invite/${data.token}`;
        setInviteStatus(`Invite sent! Link: ${inviteUrl}`);
        setInviteEmail("");
        void queryClient.invalidateQueries();
      },
      onError: (error) => {
        setInviteStatus(`Error: ${error.message}`);
      },
    }),
  );

  const members = summary?.members ?? [];
  const palette = ["#58A6FF", "#3FB950", "#D29922", "#F85149", "#BC8CFF", "#F778BA", "#79C0FF", "#56D364"];

  return (
    <div className="space-y-3 p-4">
      <h3 className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
        Trip Members
      </h3>

      {isLoading && (
        <p className="text-xs text-[#484F58]">Loading...</p>
      )}

      <div className="space-y-2">
        {members.map((member, idx) => {
          const colorHex = palette[idx % palette.length]!;
          return (
            <div
              key={member.userId}
              className="flex items-center gap-3 rounded-[4px] border border-[#21262D] bg-[#161B22] p-3"
            >
              <div
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: colorHex }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">
                  {member.displayName ?? member.userId.slice(0, 8)}
                </p>
                {member.venmoHandle && (
                  <p className="text-[10px] text-[#484F58]">
                    @{member.venmoHandle}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Invite section */}
      <div className="mt-4 space-y-2">
        <h3 className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
          Invite Member
        </h3>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!inviteEmail.trim()) return;
            setInviteStatus(null);
            createInvite.mutate({
              workspaceId,
              tripId,
              email: inviteEmail.trim().toLowerCase(),
            });
          }}
        >
          <input
            type="email"
            placeholder="email@example.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="flex-1 rounded-[4px] border border-[#21262D] bg-[#161B22] px-3 py-2 text-xs text-[#C9D1D9] placeholder-[#484F58] outline-none focus:border-[#58A6FF]"
          />
          <button
            type="submit"
            disabled={createInvite.isPending || !inviteEmail.trim()}
            className="shrink-0 rounded-[4px] border border-[#58A6FF]/30 bg-[#58A6FF]/10 px-3 py-2 text-[10px] font-semibold text-[#58A6FF] hover:bg-[#58A6FF]/20 disabled:opacity-50 transition-colors"
          >
            {createInvite.isPending ? "..." : "Invite"}
          </button>
        </form>
        {inviteStatus && (
          <p className={`text-[10px] break-all ${inviteStatus.startsWith("Error") ? "text-[#F85149]" : "text-[#3FB950]"}`}>
            {inviteStatus}
          </p>
        )}
      </div>
    </div>
  );
}
