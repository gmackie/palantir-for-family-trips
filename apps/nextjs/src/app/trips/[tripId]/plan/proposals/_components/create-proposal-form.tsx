"use client";

import { Button } from "@gmacko/ui/button";
import { Input } from "@gmacko/ui/input";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useTRPC } from "~/trpc/react";

const PROPOSAL_TYPES = [
  { value: "flight", label: "Flight" },
  { value: "lodging", label: "Lodging" },
  { value: "car_rental", label: "Car Rental" },
  { value: "activity", label: "Activity" },
  { value: "other", label: "Other" },
] as const;

export function CreateProposalForm({
  tripId,
  workspaceId,
}: {
  tripId: string;
  workspaceId: string;
}) {
  const router = useRouter();
  const trpc = useTRPC();
  const [error, setError] = useState<string | null>(null);

  const createProposal = useMutation(
    trpc.planning.createProposal.mutationOptions(),
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = new FormData(e.currentTarget);
    const title = form.get("title") as string;
    const proposalType = form.get("proposalType") as
      | "flight"
      | "lodging"
      | "car_rental"
      | "activity"
      | "other";
    const url = (form.get("url") as string) || undefined;
    const priceStr = form.get("price") as string;
    const priceCents = priceStr
      ? Math.round(parseFloat(priceStr) * 100)
      : undefined;
    const description = (form.get("description") as string) || undefined;

    try {
      await createProposal.mutateAsync({
        workspaceId,
        tripId,
        title,
        proposalType,
        url,
        priceCents: priceCents && !isNaN(priceCents) ? priceCents : undefined,
        description,
      });

      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create proposal",
      );
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="proposal-title"
            className="text-muted-foreground mb-1 block text-sm font-medium"
          >
            Title
          </label>
          <Input
            id="proposal-title"
            name="title"
            placeholder="e.g. Delta flight LAX-NRT"
            required
            maxLength={200}
          />
        </div>

        <div>
          <label
            htmlFor="proposal-type"
            className="text-muted-foreground mb-1 block text-sm font-medium"
          >
            Type
          </label>
          <select
            id="proposal-type"
            name="proposalType"
            defaultValue="other"
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
          >
            {PROPOSAL_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="proposal-url"
            className="text-muted-foreground mb-1 block text-sm font-medium"
          >
            URL (optional)
          </label>
          <Input id="proposal-url" name="url" type="url" placeholder="https://..." />
        </div>

        <div>
          <label
            htmlFor="proposal-price"
            className="text-muted-foreground mb-1 block text-sm font-medium"
          >
            Price (optional)
          </label>
          <Input
            id="proposal-price"
            name="price"
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            className="tabular-nums"
          />
        </div>

        <div className="sm:col-span-2">
          <label
            htmlFor="proposal-description"
            className="text-muted-foreground mb-1 block text-sm font-medium"
          >
            Description (optional)
          </label>
          <Input
            id="proposal-description"
            name="description"
            placeholder="Any notes about this option..."
            maxLength={2000}
          />
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button type="submit" disabled={createProposal.isPending}>
          {createProposal.isPending ? "Adding..." : "Add proposal"}
        </Button>
      </div>
    </form>
  );
}
