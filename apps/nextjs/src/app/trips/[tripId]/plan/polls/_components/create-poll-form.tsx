"use client";

import { Button } from "@gmacko/ui/button";
import { Input } from "@gmacko/ui/input";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useTRPC } from "~/trpc/react";

const POLL_TYPES = [
  { value: "single_choice", label: "Single Choice" },
  { value: "multi_choice", label: "Multiple Choice" },
  { value: "date_range", label: "Date Range" },
  { value: "ranked", label: "Ranked" },
] as const;

export function CreatePollForm({
  tripId,
  workspaceId,
}: {
  tripId: string;
  workspaceId: string;
}) {
  const router = useRouter();
  const trpc = useTRPC();
  const [error, setError] = useState<string | null>(null);

  const createPoll = useMutation(trpc.planning.createPoll.mutationOptions());

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = new FormData(e.currentTarget);
    const title = form.get("title") as string;
    const pollType = form.get("pollType") as
      | "single_choice"
      | "multi_choice"
      | "date_range"
      | "ranked";

    try {
      const poll = await createPoll.mutateAsync({
        workspaceId,
        tripId,
        title,
        pollType,
      });

      router.push(`/trips/${tripId}/plan/polls/${poll.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create poll");
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label
            htmlFor="poll-title"
            className="text-muted-foreground mb-1 block text-sm font-medium"
          >
            Title
          </label>
          <Input
            id="poll-title"
            name="title"
            placeholder="When should we go?"
            required
            maxLength={200}
          />
        </div>

        <div className="w-full sm:w-48">
          <label
            htmlFor="poll-type"
            className="text-muted-foreground mb-1 block text-sm font-medium"
          >
            Type
          </label>
          <select
            id="poll-type"
            name="pollType"
            defaultValue="single_choice"
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
          >
            {POLL_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit" disabled={createPoll.isPending}>
          {createPoll.isPending ? "Creating..." : "Create poll"}
        </Button>
      </div>
    </form>
  );
}
