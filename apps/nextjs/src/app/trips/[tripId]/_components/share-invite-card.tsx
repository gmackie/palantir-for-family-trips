"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useTRPC } from "~/trpc/react";

export function ShareInviteCard(props: {
  workspaceId: string;
  tripId: string;
  tripName: string;
}) {
  const { workspaceId, tripId, tripName } = props;
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const shareLinkOptions = trpc.trips.getShareLink.queryOptions({
    workspaceId,
    tripId,
  });
  const { data, isLoading, isError } = useQuery(shareLinkOptions);

  const regenerate = useMutation(
    trpc.trips.regenerateShareLink.mutationOptions({
      onSuccess: () => {
        setActionError(null);
        setCopied(false);
        void queryClient.invalidateQueries({
          queryKey: shareLinkOptions.queryKey,
        });
      },
      onError: (error) => setActionError(error.message),
    }),
  );

  const setEnabled = useMutation(
    trpc.trips.setShareLinkEnabled.mutationOptions({
      onSuccess: () => {
        setActionError(null);
        void queryClient.invalidateQueries({
          queryKey: shareLinkOptions.queryKey,
        });
      },
      onError: (error) => setActionError(error.message),
    }),
  );

  const url = data?.url ?? "";
  const enabled = data?.enabled ?? true;
  const message = `You're invited to ${tripName} on Sortey 🚗 Tap to join: ${url}`;
  const smsHref = `sms:?&body=${encodeURIComponent(message)}`;

  async function handleCopy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setActionError("Could not copy link");
    }
  }

  return (
    <div className="space-y-3 rounded-[4px] border border-[#21262D] bg-[#161B22] p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
          Invite by Text
        </h3>
        <span
          className={`rounded-[2px] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${
            enabled
              ? "bg-[#3FB950]/20 text-[#3FB950]"
              : "bg-[#8B949E]/20 text-[#8B949E]"
          }`}
        >
          {enabled ? "Active" : "Disabled"}
        </span>
      </div>

      {isLoading && <p className="text-xs text-[#484F58]">Loading link...</p>}
      {isError && (
        <p className="text-[10px] text-[#F85149]">
          Only organizers can manage the invite link.
        </p>
      )}

      {data && (
        <>
          <p className="break-all rounded-[4px] border border-[#21262D] bg-[#0D1117] px-3 py-2 font-mono text-[11px] text-[#C9D1D9]">
            {url}
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="shrink-0 rounded-[4px] border border-[#58A6FF]/30 bg-[#58A6FF]/10 px-3 py-2 text-[10px] font-semibold text-[#58A6FF] transition-colors hover:bg-[#58A6FF]/20"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
            <a
              href={smsHref}
              className="shrink-0 rounded-[4px] border border-[#3FB950]/30 bg-[#3FB950]/10 px-3 py-2 text-[10px] font-semibold text-[#3FB950] transition-colors hover:bg-[#3FB950]/20"
            >
              Text it
            </a>
          </div>

          {/* Organizer-only controls. The server enforces organizer role on
              these procedures; the query above errors for non-organizers, so
              this block is only reached by organizers. */}
          <div className="flex items-center gap-2 border-t border-[#21262D] pt-3">
            <button
              type="button"
              disabled={regenerate.isPending}
              onClick={() => {
                if (
                  !window.confirm(
                    "Regenerate the invite link? The current link will stop working.",
                  )
                ) {
                  return;
                }
                regenerate.mutate({ workspaceId, tripId });
              }}
              className="rounded-[4px] border border-[#21262D] bg-[#0D1117] px-3 py-1.5 text-[10px] font-semibold text-[#8B949E] transition-colors hover:border-[#D29922]/40 hover:text-[#D29922] disabled:opacity-50"
            >
              {regenerate.isPending ? "..." : "Regenerate"}
            </button>
            <button
              type="button"
              disabled={setEnabled.isPending}
              onClick={() =>
                setEnabled.mutate({ workspaceId, tripId, enabled: !enabled })
              }
              className="rounded-[4px] border border-[#21262D] bg-[#0D1117] px-3 py-1.5 text-[10px] font-semibold text-[#8B949E] transition-colors hover:border-[#58A6FF]/40 hover:text-[#58A6FF] disabled:opacity-50"
            >
              {setEnabled.isPending ? "..." : enabled ? "Disable" : "Enable"}
            </button>
          </div>
        </>
      )}

      {actionError && (
        <p className="text-[10px] text-[#F85149]">{actionError}</p>
      )}
    </div>
  );
}
