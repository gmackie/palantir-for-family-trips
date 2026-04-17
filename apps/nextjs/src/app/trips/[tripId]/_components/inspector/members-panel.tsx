"use client";

import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

export function MembersPanel(props: {
  tripId: string;
  workspaceId: string;
}) {
  const { tripId, workspaceId } = props;
  const trpc = useTRPC();

  // Settlement summary includes members with displayName, role info
  const { data: summary, isLoading } = useQuery(
    trpc.settlements.summary.queryOptions({ workspaceId, tripId }),
  );

  const members = summary?.members ?? [];

  return (
    <div className="space-y-3 p-4">
      <h3 className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
        Trip Members
      </h3>

      {isLoading && (
        <p className="text-xs text-[#484F58]">Loading...</p>
      )}

      {!isLoading && members.length === 0 && (
        <div className="rounded-[4px] border border-[#21262D] bg-[#161B22] p-4 text-center">
          <p className="text-xs text-[#484F58]">No members found.</p>
        </div>
      )}

      <div className="space-y-2">
        {members.map((member, idx) => {
          // Assign a stable color from a palette based on index
          const palette = ["#58A6FF", "#3FB950", "#D29922", "#F85149", "#BC8CFF", "#F778BA", "#79C0FF", "#56D364"];
          const colorHex = palette[idx % palette.length]!;
          return (
            <div
              key={member.userId}
              className="flex items-center gap-3 rounded-[4px] border border-[#21262D] bg-[#161B22] p-3"
            >
              {/* Color chip */}
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
    </div>
  );
}
