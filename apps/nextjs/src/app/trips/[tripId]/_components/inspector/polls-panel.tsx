"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";

import { useTRPC } from "~/trpc/react";

const POLL_TYPE_LABELS: Record<string, string> = {
  date_range: "Date Range",
  single_choice: "Single Choice",
  multi_choice: "Multi Choice",
  ranked: "Ranked",
};

const POLL_STATUS_PILL: Record<string, string> = {
  open: "bg-[#3FB950]/20 text-[#3FB950]",
  closed: "bg-[#8B949E]/20 text-[#8B949E]",
};

const RESPONSE_COLORS: Record<string, string> = {
  yes: "bg-[#3FB950]/30",
  maybe: "bg-[#D29922]/20",
  no: "bg-[#F85149]/15",
  prefer: "bg-[#58A6FF]/25",
};

export function PollsPanel(props: {
  tripId: string;
  workspaceId: string;
}) {
  const { tripId, workspaceId } = props;
  const trpc = useTRPC();
  const [expandedPollId, setExpandedPollId] = useState<string | null>(null);

  const { data: polls, isLoading } = useQuery(
    trpc.planning.listPolls.queryOptions({ workspaceId, tripId }),
  );

  const openPolls = polls?.filter((p) => p.status === "open") ?? [];
  const closedPolls = polls?.filter((p) => p.status === "closed") ?? [];

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
          Active Polls
        </h3>
        <Link
          href={`/trips/${tripId}/plan`}
          className="rounded-[2px] bg-[#58A6FF]/15 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-[#58A6FF] hover:bg-[#58A6FF]/25 transition-colors"
        >
          + Create
        </Link>
      </div>

      {isLoading && (
        <div className="py-8 text-center text-xs text-[#484F58]">
          Loading polls...
        </div>
      )}

      {!isLoading && polls?.length === 0 && (
        <div className="rounded-[4px] border border-[#21262D] bg-[#161B22] p-6 text-center">
          <p className="text-xs text-[#484F58]">No polls created yet.</p>
        </div>
      )}

      {/* Open polls */}
      {openPolls.map((poll) => (
        <PollCard
          key={poll.id}
          poll={poll}
          isExpanded={expandedPollId === poll.id}
          onToggle={() =>
            setExpandedPollId(expandedPollId === poll.id ? null : poll.id)
          }
          tripId={tripId}
          workspaceId={workspaceId}
        />
      ))}

      {/* Closed polls */}
      {closedPolls.length > 0 && (
        <>
          <h4 className="text-[9px] font-black uppercase tracking-[0.2em] text-[#8B949E] pt-2">
            Closed Polls
          </h4>
          {closedPolls.map((poll) => (
            <PollCard
              key={poll.id}
              poll={poll}
              isExpanded={expandedPollId === poll.id}
              onToggle={() =>
                setExpandedPollId(expandedPollId === poll.id ? null : poll.id)
              }
              tripId={tripId}
              workspaceId={workspaceId}
            />
          ))}
        </>
      )}
    </div>
  );
}

type PollWithOptions = {
  id: string;
  tripId: string;
  title: string;
  pollType: string;
  status: string;
  closesAt: Date | null;
  createdAt: Date;
  options: Array<{
    id: string;
    pollId: string;
    label: string;
    description: string | null;
    url: string | null;
    sortOrder: number;
    createdAt: Date;
    voteCount: number;
  }>;
};

function PollCard(props: {
  poll: PollWithOptions;
  isExpanded: boolean;
  onToggle: () => void;
  tripId: string;
  workspaceId: string;
}) {
  const { poll, isExpanded, onToggle, tripId, workspaceId } = props;
  const trpc = useTRPC();

  const totalVotes = poll.options.reduce((s, o) => s + o.voteCount, 0);
  const maxVotes = Math.max(1, ...poll.options.map((o) => o.voteCount));

  const { data: pollResults } = useQuery({
    ...trpc.planning.getPollResults.queryOptions({
      workspaceId,
      tripId,
      pollId: poll.id,
    }),
    enabled: isExpanded && poll.pollType === "date_range",
  });

  return (
    <div className="rounded-[4px] border border-[#21262D] bg-[#161B22]">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between p-3 text-left hover:bg-[#1C2128] transition-colors"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-white">
              {poll.title}
            </span>
            <span
              className={`shrink-0 rounded-[2px] px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${POLL_STATUS_PILL[poll.status] ?? "bg-[#8B949E]/20 text-[#8B949E]"}`}
            >
              {poll.status}
            </span>
          </div>
          <div className="mt-0.5 flex gap-3 text-[10px] text-[#484F58]">
            <span>{POLL_TYPE_LABELS[poll.pollType] ?? poll.pollType}</span>
            <span>{poll.options.length} options</span>
            <span>{totalVotes} votes</span>
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-[#21262D] p-3 space-y-2">
          {/* Date range polls: availability grid */}
          {poll.pollType === "date_range" && pollResults ? (
            <DateAvailabilityGrid pollResults={pollResults} />
          ) : (
            /* Ranked / choice polls: vote bars */
            poll.options.map((option) => (
              <div key={option.id} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#C9D1D9] truncate">{option.label}</span>
                  <span className="font-mono text-[#8B949E] tabular-nums ml-2 shrink-0">
                    {option.voteCount}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-[#21262D] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#58A6FF] transition-all"
                    style={{
                      width: `${(option.voteCount / maxVotes) * 100}%`,
                    }}
                  />
                </div>
              </div>
            ))
          )}

          <Link
            href={`/trips/${tripId}/plan`}
            className="mt-2 block text-xs text-[#58A6FF] hover:underline"
          >
            View in planning
          </Link>
        </div>
      )}
    </div>
  );
}

type PollResultsData = {
  id: string;
  options: Array<{
    id: string;
    label: string;
    votes: Array<{
      userId: string;
      response: string;
    }>;
  }>;
};

function DateAvailabilityGrid(props: { pollResults: PollResultsData }) {
  const { pollResults } = props;

  // Collect unique voter IDs
  const voterIds = new Set<string>();
  for (const option of pollResults.options) {
    for (const vote of option.votes) {
      voterIds.add(vote.userId);
    }
  }
  const voters = Array.from(voterIds);

  if (voters.length === 0) {
    return (
      <p className="text-[10px] text-[#484F58]">No votes yet.</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="inline-grid gap-[2px]" style={{
        gridTemplateColumns: `auto repeat(${pollResults.options.length}, 28px)`,
      }}>
        {/* Header row: option labels */}
        <div /> {/* empty top-left cell */}
        {pollResults.options.map((option) => (
          <div
            key={option.id}
            className="text-[8px] text-[#8B949E] text-center truncate px-0.5"
            title={option.label}
          >
            {option.label.slice(0, 5)}
          </div>
        ))}

        {/* Grid rows: one per voter */}
        {voters.map((voterId) => (
          <GridRow
            key={voterId}
            voterId={voterId}
            options={pollResults.options}
          />
        ))}
      </div>
    </div>
  );
}

function GridRow(props: {
  voterId: string;
  options: PollResultsData["options"];
}) {
  const { voterId, options } = props;

  return (
    <>
      <div className="text-[8px] text-[#8B949E] truncate pr-1 self-center max-w-[60px]">
        {voterId.slice(0, 6)}
      </div>
      {options.map((option) => {
        const vote = option.votes.find((v) => v.userId === voterId);
        const bgClass = vote
          ? (RESPONSE_COLORS[vote.response] ?? "bg-[#161B22]")
          : "bg-[#161B22]";

        return (
          <div
            key={option.id}
            className={`h-5 w-7 rounded-[2px] ${bgClass}`}
            title={vote?.response ?? "no vote"}
          />
        );
      })}
    </>
  );
}
