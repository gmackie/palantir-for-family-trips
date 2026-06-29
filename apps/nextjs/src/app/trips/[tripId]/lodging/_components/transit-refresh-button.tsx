"use client";

import { Button } from "@sortey/ui/button";
import { toast } from "@sortey/ui/toast";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { useTRPC } from "~/trpc/react";

interface TransitRefreshButtonProps {
  workspaceId: string;
  tripId: string;
  transitId: string;
}

/**
 * Pulls live AviationStack status for a flight transit and, on a real update,
 * refreshes the server-rendered lodging page so the badge + times update.
 */
export function TransitRefreshButton({
  workspaceId,
  tripId,
  transitId,
}: TransitRefreshButtonProps) {
  const trpc = useTRPC();
  const router = useRouter();

  const refresh = useMutation(
    trpc.lodging.refreshTransitStatus.mutationOptions({
      onSuccess: (res) => {
        if (res.refreshed) {
          toast.success("Flight status updated");
          router.refresh();
        } else {
          toast.message("No live status available yet");
        }
      },
      onError: () => toast.error("Couldn't refresh flight status"),
    }),
  );

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={refresh.isPending}
      onClick={() => refresh.mutate({ workspaceId, tripId, transitId })}
    >
      {refresh.isPending ? "…" : "Refresh"}
    </Button>
  );
}
