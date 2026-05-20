"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useTRPC } from "~/trpc/react";

/**
 * Poll for realtime claim updates on a specific expense.
 *
 * Invalidates the `expenses.get` query every 3 seconds so the UI
 * reflects line-item claims/unclaims made by other users. Polling
 * pauses automatically when the browser tab is hidden.
 *
 * This replaces the previous Pusher-based subscription with a
 * dependency-free polling approach. A future SSE upgrade can hook
 * into the server-side event log without changing this interface.
 */
export function useExpenseRealtime(input: {
  expenseId: string;
  workspaceId: string;
  tripId: string;
}) {
  const queryClient = useQueryClient();
  const trpc = useTRPC();

  useEffect(() => {
    const getQueryKey = trpc.expenses.get.queryKey({
      workspaceId: input.workspaceId,
      tripId: input.tripId,
      expenseId: input.expenseId,
    });

    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: getQueryKey });
    };

    // 3-second polling, pauses when the tab is hidden
    let timer: ReturnType<typeof setInterval> | null = null;

    function startPolling() {
      timer = setInterval(() => {
        if (document.visibilityState === "visible") {
          invalidate();
        }
      }, 3_000);
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
