"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";

import { useTRPC } from "~/trpc/react";

type ProposalType = "flight" | "lodging" | "car_rental" | "activity" | "other";

const FILTER_OPTIONS: { label: string; value: ProposalType | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Flights", value: "flight" },
  { label: "Lodging", value: "lodging" },
  { label: "Cars", value: "car_rental" },
  { label: "Activities", value: "activity" },
];

const TYPE_LABELS: Record<string, string> = {
  flight: "Flight",
  lodging: "Lodging",
  car_rental: "Car",
  activity: "Activity",
  other: "Other",
};

const STATUS_PILL: Record<string, string> = {
  proposed: "bg-[#D29922]/20 text-[#D29922]",
  selected: "bg-[#58A6FF]/20 text-[#58A6FF]",
  booked: "bg-[#3FB950]/20 text-[#3FB950]",
  rejected: "bg-[#F85149]/20 text-[#F85149]",
};

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function ProposalsPanel(props: {
  tripId: string;
  workspaceId: string;
}) {
  const { tripId, workspaceId } = props;
  const trpc = useTRPC();
  const [filter, setFilter] = useState<ProposalType | "all">("all");

  const { data: proposals, isLoading } = useQuery(
    trpc.planning.listProposals.queryOptions({
      workspaceId,
      tripId,
      ...(filter !== "all" ? { proposalType: filter } : {}),
    }),
  );

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
          Proposals
        </h3>
        <Link
          href={`/trips/${tripId}/plan`}
          className="rounded-[2px] bg-[#58A6FF]/15 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-[#58A6FF] hover:bg-[#58A6FF]/25 transition-colors"
        >
          + Add
        </Link>
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-1">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            className={`rounded-[2px] px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition-colors ${
              filter === opt.value
                ? "bg-[#58A6FF]/20 text-[#58A6FF]"
                : "bg-[#161B22] text-[#8B949E] hover:text-[#C9D1D9] border border-[#21262D]"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="py-8 text-center text-xs text-[#484F58]">
          Loading proposals...
        </div>
      )}

      {!isLoading && proposals?.length === 0 && (
        <div className="rounded-[4px] border border-[#21262D] bg-[#161B22] p-6 text-center">
          <p className="text-xs text-[#484F58]">No proposals yet.</p>
        </div>
      )}

      {/* Proposal cards */}
      {proposals?.map((proposal) => (
        <ProposalCard
          key={proposal.id}
          proposal={proposal}
          tripId={tripId}
        />
      ))}
    </div>
  );
}

type ProposalWithReactions = {
  id: string;
  title: string;
  proposalType: string;
  status: string;
  priceCents: number | null;
  currency: string;
  description: string | null;
  url: string | null;
  reactionCounts: Record<string, number>;
};

function ProposalCard(props: {
  proposal: ProposalWithReactions;
  tripId: string;
}) {
  const { proposal, tripId } = props;

  const upCount = proposal.reactionCounts["up"] ?? 0;
  const downCount = proposal.reactionCounts["down"] ?? 0;

  return (
    <div className="rounded-[4px] border border-[#21262D] bg-[#161B22] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-white">
              {proposal.title}
            </span>
            <span
              className={`shrink-0 rounded-[2px] px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${STATUS_PILL[proposal.status] ?? "bg-[#8B949E]/20 text-[#8B949E]"}`}
            >
              {proposal.status}
            </span>
          </div>
          <div className="mt-0.5 flex gap-3 text-[10px] text-[#484F58]">
            <span>{TYPE_LABELS[proposal.proposalType] ?? proposal.proposalType}</span>
            {proposal.url && (
              <a
                href={proposal.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#58A6FF] hover:underline"
              >
                Link
              </a>
            )}
          </div>
        </div>

        {proposal.priceCents != null && (
          <span className="shrink-0 font-mono text-base font-bold text-white tabular-nums">
            {formatCents(proposal.priceCents)}
          </span>
        )}
      </div>

      {proposal.description && (
        <p className="mt-2 text-xs text-[#8B949E] line-clamp-2">
          {proposal.description}
        </p>
      )}

      {/* Reaction buttons */}
      <div className="mt-2 flex items-center gap-2">
        <ReactionButton
          label={`+${upCount}`}
          active={false}
          variant="up"
        />
        <ReactionButton
          label={`-${downCount}`}
          active={false}
          variant="down"
        />

        <Link
          href={`/trips/${tripId}/plan`}
          className="ml-auto text-[10px] text-[#58A6FF] hover:underline"
        >
          Details
        </Link>
      </div>
    </div>
  );
}

function ReactionButton(props: {
  label: string;
  active: boolean;
  variant: "up" | "down";
}) {
  const { label, active, variant } = props;
  const borderColor = active ? "border-[#58A6FF]" : "border-[#21262D]";
  const textColor = variant === "up"
    ? (active ? "text-[#3FB950]" : "text-[#8B949E]")
    : (active ? "text-[#F85149]" : "text-[#8B949E]");

  return (
    <span
      className={`inline-flex items-center rounded-[2px] border px-2 py-0.5 text-[10px] font-mono tabular-nums ${borderColor} ${textColor}`}
    >
      {label}
    </span>
  );
}
