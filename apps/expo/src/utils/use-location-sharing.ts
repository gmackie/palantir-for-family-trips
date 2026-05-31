import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Location from "expo-location";
import { useCallback, useEffect, useRef } from "react";

import { trpc } from "./api";
import { getActiveWorkspaceId } from "./workspace-store";

const UPDATE_INTERVAL_MS = 30_000;

export function useLocationSharing(tripId: string) {
  const workspaceId = getActiveWorkspaceId() ?? "";
  const queryClient = useQueryClient();
  const watchRef = useRef<Location.LocationSubscription | null>(null);

  const { data: sharingStatus } = useQuery({
    ...trpc.location.getSharingStatus.queryOptions({ workspaceId, tripId }),
    retry: false,
  });

  const updateLocation = useMutation(
    trpc.location.updateLocation.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.location.listMemberLocations.queryKey({
            workspaceId,
            tripId,
          }),
        });
      },
    }),
  );

  const setSharing = useMutation(
    trpc.location.setSharingEnabled.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.location.getSharingStatus.queryKey({
            workspaceId,
            tripId,
          }),
        });
      },
    }),
  );

  const sendLocation = useCallback(
    (loc: Location.LocationObject) => {
      updateLocation.mutate({
        workspaceId,
        tripId,
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        heading: loc.coords.heading ?? null,
        speed: loc.coords.speed ?? null,
        accuracy: loc.coords.accuracy ?? null,
      });
    },
    [workspaceId, tripId, updateLocation],
  );

  const startSharing = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return false;

    setSharing.mutate({ workspaceId, tripId, enabled: true });

    const current = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    sendLocation(current);

    if (watchRef.current) {
      watchRef.current.remove();
    }
    watchRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: UPDATE_INTERVAL_MS,
        distanceInterval: 50,
      },
      sendLocation,
    );

    return true;
  }, [workspaceId, tripId, sendLocation, setSharing]);

  const stopSharing = useCallback(() => {
    if (watchRef.current) {
      watchRef.current.remove();
      watchRef.current = null;
    }
    setSharing.mutate({ workspaceId, tripId, enabled: false });
  }, [workspaceId, tripId, setSharing]);

  useEffect(() => {
    return () => {
      if (watchRef.current) {
        watchRef.current.remove();
        watchRef.current = null;
      }
    };
  }, []);

  return {
    isSharing: sharingStatus?.sharingEnabled ?? false,
    startSharing,
    stopSharing,
    isPending: setSharing.isPending,
  };
}
