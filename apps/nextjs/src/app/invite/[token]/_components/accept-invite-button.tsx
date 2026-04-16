"use client";

import { Button } from "@gmacko/ui/button";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";

import { useTRPC } from "~/trpc/react";

export function AcceptInviteButton(props: { token: string }) {
  const router = useRouter();
  const trpc = useTRPC();
  const [error, setError] = useState<string | null>(null);

  const acceptInvite = useMutation(trpc.trips.acceptInvite.mutationOptions());

  return (
    <div className="space-y-3">
      <Button
        className="w-full"
        disabled={acceptInvite.isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const result = await acceptInvite.mutateAsync({
                token: props.token,
              });
              router.push(`/trips/${result.tripId}`);
            } catch (mutationError) {
              setError(
                mutationError instanceof Error
                  ? mutationError.message
                  : "Could not accept invite",
              );
            }
          });
        }}
      >
        {acceptInvite.isPending ? "Accepting..." : "Accept invite"}
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
