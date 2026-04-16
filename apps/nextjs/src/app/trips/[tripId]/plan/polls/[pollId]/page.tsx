"use client";

import { Button } from "@gmacko/ui/button";
import { Input } from "@gmacko/ui/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { useTRPC } from "~/trpc/react";

const VOTE_RESPONSES = [
  { value: "yes", label: "Yes", color: "bg-emerald-500/15 text-emerald-600" },
  { value: "no", label: "No", color: "bg-red-500/15 text-red-600" },
  { value: "maybe", label: "Maybe", color: "bg-amber-500/15 text-amber-600" },
  { value: "prefer", label: "Prefer", color: "bg-blue-500/15 text-blue-600" },
] as const;

export default function PollDetailPage() {
  const { tripId, pollId } = useParams<{ tripId: string; pollId: string }>();
  const router = useRouter();
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
        <p className="text-sm text-red-600">
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
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                isOpen
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400"
              }`}
            >
              {poll.status}
            </span>
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

      {error && (
        <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Add option */}
      {isOpen && (
        <form
          onSubmit={handleAddOption}
          className="bg-card mt-6 rounded-2xl border p-4 shadow-sm"
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
          <div className="bg-card rounded-2xl border p-6 text-center">
            <p className="text-muted-foreground text-sm">
              No options yet. Add one above.
            </p>
          </div>
        ) : (
          poll.options.map((option) => (
            <div
              key={option.id}
              className="bg-card rounded-2xl border p-4 shadow-sm"
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
                      className="mt-1 inline-block text-xs text-blue-500 underline"
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
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-opacity hover:opacity-80 ${vr.color}`}
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
                      className="bg-muted rounded-full px-2 py-0.5 text-xs"
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
