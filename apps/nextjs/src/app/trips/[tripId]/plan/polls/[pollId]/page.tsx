"use client";

import { Button } from "@sortey/ui/button";
import { Input } from "@sortey/ui/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { EmptyState, ErrorBanner, StatusPill } from "~/app/trips/_components/command-panel";
import { useTRPC } from "~/trpc/react";

const VOTE_RESPONSES = [
  {
    value: "yes",
    label: "Yes",
    color: "border border-[#3FB950]/30 bg-[#3FB950]/10 text-[#3FB950]",
  },
  {
    value: "no",
    label: "No",
    color: "border border-[#F85149]/30 bg-[#F85149]/10 text-[#F85149]",
  },
  {
    value: "maybe",
    label: "Maybe",
    color: "border border-[#D29922]/30 bg-[#D29922]/10 text-[#D29922]",
  },
  {
    value: "prefer",
    label: "Prefer",
    color: "border border-[#58A6FF]/30 bg-[#58A6FF]/10 text-[#58A6FF]",
  },
] as const;

export default function PollDetailPage() {
  const { tripId, pollId } = useParams<{ tripId: string; pollId: string }>();
  const trpc = useTRPC();

  const [newOptionLabel, setNewOptionLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const workspaceQuery = useQuery(
    trpc.settings.getWorkspaceContext.queryOptions(),
  );
  const workspaceId = workspaceQuery.data?.workspace?.id;

  const pollQuery = useQuery(
    trpc.planning.getPollResults.queryOptions(
      { workspaceId: workspaceId!, tripId, pollId },
      { enabled: !!workspaceId },
    ),
  );

  const addOption = useMutation(
    trpc.planning.addPollOption.mutationOptions({
      onSuccess: () => {
        setNewOptionLabel("");
        pollQuery.refetch();
      },
    }),
  );

  const vote = useMutation(
    trpc.planning.vote.mutationOptions({
      onSuccess: () => {
        pollQuery.refetch();
      },
    }),
  );

  const closePoll = useMutation(
    trpc.planning.closePoll.mutationOptions({
      onSuccess: () => {
        pollQuery.refetch();
      },
    }),
  );

  if (!workspaceId || pollQuery.isLoading) {
    return (
      <main className="container mx-auto max-w-3xl px-4 py-10">
        <p className="text-muted-foreground text-sm">Loading poll...</p>
      </main>
    );
  }

  if (pollQuery.error) {
    return (
      <main className="container mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-[#F85149]">
          Failed to load poll: {pollQuery.error.message}
        </p>
      </main>
    );
  }

  const poll = pollQuery.data!;
  const isOpen = poll.status === "open";

  async function handleAddOption(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !newOptionLabel.trim()) return;
    setError(null);

    try {
      await addOption.mutateAsync({
        workspaceId,
        tripId,
        pollId,
        label: newOptionLabel.trim(),
        sortOrder: poll.options.length,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add option");
    }
  }

  async function handleVote(
    pollOptionId: string,
    response: "yes" | "no" | "maybe" | "prefer",
  ) {
    if (!workspaceId) return;

    try {
      await vote.mutateAsync({
        workspaceId,
        tripId,
        pollOptionId,
        response,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to vote");
    }
  }

  async function handleClosePoll() {
    if (!workspaceId) return;

    try {
      await closePoll.mutateAsync({ workspaceId, tripId, pollId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to close poll");
    }
  }

  return (
    <main className="container mx-auto max-w-3xl px-4 py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm uppercase tracking-[0.24em]">
            Poll
          </p>
          <h1 className="text-4xl font-black tracking-tight">{poll.title}</h1>
          <div className="flex items-center gap-2">
            <StatusPill tone={isOpen ? "success" : "neutral"}>
              {poll.status}
            </StatusPill>
            <span className="text-muted-foreground text-xs">
              {poll.pollType.replace("_", " ")}
            </span>
          </div>
        </div>

        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/trips/${tripId}/plan/polls`}>Back to polls</Link>
          </Button>
          {isOpen && (
            <Button variant="outline" size="sm" onClick={handleClosePoll}>
              Close poll
            </Button>
          )}
        </div>
      </div>

      {error && <ErrorBanner className="mt-4">{error}</ErrorBanner>}

      {/* Add option */}
      {isOpen && (
        <form
          onSubmit={handleAddOption}
          className="bg-card mt-6 rounded-[4px] border p-4"
        >
          <p className="text-muted-foreground mb-2 text-sm font-medium">
            Add an option
          </p>
          <div className="flex gap-2">
            <Input
              value={newOptionLabel}
              onChange={(e) => setNewOptionLabel(e.target.value)}
              placeholder="Option label"
              maxLength={200}
            />
            <Button
              type="submit"
              size="sm"
              disabled={addOption.isPending || !newOptionLabel.trim()}
            >
              Add
            </Button>
          </div>
        </form>
      )}

      {/* Options and voting */}
      <div className="mt-6 grid gap-3">
        {poll.options.length === 0 ? (
          <EmptyState>No options yet. Add one above.</EmptyState>
        ) : (
          poll.options.map((option) => (
            <div
              key={option.id}
              className="bg-card rounded-[4px] border p-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">{option.label}</h3>
                  {option.description && (
                    <p className="text-muted-foreground mt-1 text-xs">
                      {option.description}
                    </p>
                  )}
                  {option.url && (
                    <a
                      href={option.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block text-xs text-[#58A6FF] underline"
                    >
                      Link
                    </a>
                  )}
                </div>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {option.votes.length} vote
                  {option.votes.length !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Vote buttons */}
              {isOpen && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {VOTE_RESPONSES.map((vr) => (
                    <button
                      key={vr.value}
                      type="button"
                      onClick={() => handleVote(option.id, vr.value)}
                      disabled={vote.isPending}
                      className={`rounded-[2px] px-3 py-1 text-xs font-medium transition-opacity hover:opacity-80 ${vr.color}`}
                    >
                      {vr.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Vote breakdown */}
              {option.votes.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {option.votes.map((v) => (
                    <span
                      key={v.id}
                      className="bg-muted rounded-[2px] px-2 py-0.5 text-xs"
                    >
                      {v.userId.slice(0, 8)}: {v.response}
                      {v.rank != null && ` (#${v.rank})`}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </main>
  );
}
