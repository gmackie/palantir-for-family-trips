"use client";

import {
  createDefaultTripDashboardState,
  LEGACY_TRIP_DOCUMENT_STORAGE_KEY,
  LEGACY_VIEWER_PROFILE_STORAGE_KEY,
  type TripDashboardState,
} from "@sortey/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";

import { useTRPC } from "~/trpc/react";

function readLegacyLocalStorage(): {
  legacyTripDocument: string | null;
  legacyViewerProfile: string | null;
} {
  if (typeof window === "undefined") {
    return { legacyTripDocument: null, legacyViewerProfile: null };
  }

  try {
    return {
      legacyTripDocument: window.localStorage.getItem(
        LEGACY_TRIP_DOCUMENT_STORAGE_KEY,
      ),
      legacyViewerProfile: window.localStorage.getItem(
        LEGACY_VIEWER_PROFILE_STORAGE_KEY,
      ),
    };
  } catch {
    return { legacyTripDocument: null, legacyViewerProfile: null };
  }
}

function clearLegacyLocalStorage() {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(LEGACY_TRIP_DOCUMENT_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_VIEWER_PROFILE_STORAGE_KEY);
  } catch {
    // Ignore restricted storage environments.
  }
}

/**
 * Server-backed replacement for the demo's localStorage `usePersistedTripState`.
 * Persists per-user dashboard UI preferences for an authenticated trip.
 */
export function usePersistedTripState(input: {
  workspaceId: string;
  tripId: string;
  initialValue?: Partial<TripDashboardState>;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const legacyRef = useRef(readLegacyLocalStorage());
  const migratedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const queryKey = trpc.trips.getDashboardState.queryKey({
    workspaceId: input.workspaceId,
    tripId: input.tripId,
  });

  const { data, isLoading } = useQuery(
    trpc.trips.getDashboardState.queryOptions(
      {
        workspaceId: input.workspaceId,
        tripId: input.tripId,
        ...legacyRef.current,
      },
      {
        staleTime: 30_000,
      },
    ),
  );

  const updateMutation = useMutation(
    trpc.trips.updateDashboardState.mutationOptions({
      onSuccess: (nextState) => {
        queryClient.setQueryData(queryKey, nextState);
      },
    }),
  );

  useEffect(() => {
    if (!data || migratedRef.current) return;
    if (
      !legacyRef.current.legacyTripDocument &&
      !legacyRef.current.legacyViewerProfile
    ) {
      return;
    }

    migratedRef.current = true;
    clearLegacyLocalStorage();
    legacyRef.current = {
      legacyTripDocument: null,
      legacyViewerProfile: null,
    };
  }, [data]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const state =
    data ?? createDefaultTripDashboardState(input.initialValue ?? undefined);

  const persistState = useCallback(
    (next: TripDashboardState) => {
      queryClient.setQueryData(queryKey, next);

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        updateMutation.mutate({
          workspaceId: input.workspaceId,
          tripId: input.tripId,
          patch: next,
        });
      }, 250);
    },
    [input.tripId, input.workspaceId, queryClient, queryKey, updateMutation],
  );

  const setState = useCallback(
    (
      value:
        | TripDashboardState
        | ((prev: TripDashboardState) => TripDashboardState),
    ) => {
      const current =
        queryClient.getQueryData<TripDashboardState>(queryKey) ?? state;
      const next = typeof value === "function" ? value(current) : value;
      persistState(next);
    },
    [persistState, queryClient, queryKey, state],
  );

  return [
    state,
    setState,
    { isLoading, isSaving: updateMutation.isPending },
  ] as const;
}
