"use client";

import { getPusherClient } from "@gmacko/realtime";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useTRPC } from "~/trpc/react";

/**
 * Subscribe to realtime claim events for a specific expense.
 *
 * When a Pusher event fires (line-item:claimed, line-item:unclaimed,
 * line-item:assigned), invalidates the `expenses.get` query to
 * refresh the UI. Falls back to 3s polling when Pusher is unavailable.
 */
export function useExpenseRealtime(input: {
  expenseId: string;
  workspaceId: string;
  tripId: string;
}) {
  const queryClient = useQueryClient();
  const trpc = useTRPC();

  useEffect(() => {
    const client = getPusherClient();
    const channelName = `private-expense-${input.expenseId}`;

    // Query key for invalidation
    const getQueryKey = trpc.expenses.get.queryKey({
      workspaceId: input.workspaceId,
      tripId: input.tripId,
      expenseId: input.expenseId,
    });

    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: getQueryKey });
    };

    if (client) {
      const channel = client.subscribe(channelName);
      channel.bind("line-item:claimed", invalidate);
      channel.bind("line-item:unclaimed", invalidate);
      channel.bind("line-item:assigned", invalidate);

      return () => {
        channel.unbind_all();
        client.unsubscribe(channelName);
      };
    }

    // Fallback: 3s polling when Pusher is disabled.
    // Pauses when tab is hidden.
    let timer: ReturnType<typeof setInterval> | null = null;

    function startPolling() {
      timer = setInterval(() => {
        if (document.visibilityState === "visible") {
          invalidate();
        }
      }, 3000);
    }

    function stopPolling() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    startPolling();

    return () => {
      stopPolling();
    };
  }, [input.expenseId, input.workspaceId, input.tripId, queryClient, trpc]);
}
