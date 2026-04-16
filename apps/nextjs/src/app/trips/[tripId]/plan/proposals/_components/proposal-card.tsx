"use client";

import { Button } from "@gmacko/ui/button";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useTRPC } from "~/trpc/react";

interface ProposalData {
  id: string;
  title: string;
  proposalType: string;
  description: string | null;
  url: string | null;
  priceCents: number | null;
  currency: string;
  priceNote: string | null;
  status: string;
  reactionCounts: Record<string, number>;
}

const REACTIONS = [
  { value: "up", label: "Thumbs up", emoji: "+1" },
  { value: "down", label: "Thumbs down", emoji: "-1" },
  { value: "interested", label: "Interested", emoji: "?" },
] as const;

export function ProposalCard({
  proposal,
  tripId,
  workspaceId,
}: {
  proposal: ProposalData;
  tripId: string;
  workspaceId: string;
}) {
  const router = useRouter();
  const trpc = useTRPC();
  const [error, setError] = useState<string | null>(null);

  const react = useMutation(
    trpc.planning.reactToProposal.mutationOptions({
      onSuccess: () => router.refresh(),
    }),
  );

  async function handleReact(reaction: "up" | "down" | "interested") {
    setError(null);
    try {
      await react.mutateAsync({
        workspaceId,
        tripId,
        proposalId: proposal.id,
        reaction,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to react");
    }
  }

  return (
    <div className="bg-card rounded-2xl border p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold">
              {proposal.title}
            </h3>
            <span
              className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                proposal.status === "selected"
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : proposal.status === "rejected"
                    ? "bg-red-500/15 text-red-600 dark:text-red-400"
                    : proposal.status === "booked"
                      ? "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                      : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
              }`}
            >
              {proposal.status}
            </span>
          </div>
          <div className="text-muted-foreground mt-1 flex flex-wrap gap-3 text-xs">
            <span className="capitalize">
              {proposal.proposalType.replace("_", " ")}
            </span>
            {proposal.priceCents != null && (
              <span className="tabular-nums">
                ${(proposal.priceCents / 100).toFixed(2)} {proposal.currency}
              </span>
            )}
            {proposal.priceNote && <span>{proposal.priceNote}</span>}
          </div>
          {proposal.description && (
            <p className="text-muted-foreground mt-2 text-sm">
              {proposal.description}
            </p>
          )}
          {proposal.url && (
            <a
              href={proposal.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-xs text-blue-500 underline"
            >
              View link
            </a>
          )}
        </div>
      </div>

      {error && (
        <p className="mt-2 text-xs text-red-600">{error}</p>
      )}

      <div className="mt-3 flex items-center gap-2">
        {REACTIONS.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => handleReact(r.value)}
            disabled={react.isPending}
            className="bg-muted hover:bg-accent rounded-full px-3 py-1 text-xs font-medium transition-colors"
          >
            {r.emoji}{" "}
            {proposal.reactionCounts[r.value] != null
              ? proposal.reactionCounts[r.value]
              : 0}
          </button>
        ))}
      </div>
    </div>
  );
}
