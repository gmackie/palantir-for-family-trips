"use client";

import { Button } from "@sortey/ui/button";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";

import { useTRPC } from "~/trpc/react";

export function JoinButton(props: { token: string }) {
  const router = useRouter();
  const trpc = useTRPC();
  const [error, setError] = useState<string | null>(null);

  const join = useMutation(trpc.trips.joinByShareToken.mutationOptions());

  return (
    <div className="space-y-3">
      <Button
        className="w-full"
        disabled={join.isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const result = await join.mutateAsync({ token: props.token });
              router.push(`/trips/${result.tripId}`);
            } catch (mutationError) {
              setError(
                mutationError instanceof Error
                  ? mutationError.message
                  : "Could not join trip",
              );
            }
          });
        }}
      >
        {join.isPending ? "Joining..." : "Join trip"}
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
