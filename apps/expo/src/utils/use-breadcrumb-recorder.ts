import { useMutation } from "@tanstack/react-query";
import * as Location from "expo-location";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";

import { trpc } from "./api";

interface Buffered {
  lat: number;
  lng: number;
  speed: number | null;
  recordedAt: string;
}

// Flush the buffer to the server once it holds this many fixes.
const FLUSH_EVERY = 8;

/**
 * Records a GPS breadcrumb trail while Driving Mode is open (foreground only —
 * no background-location entitlement needed). Watches position, buffers fixes,
 * and flushes batches to `location.recordBreadcrumbs`; the recap then reports
 * actual driven miles and the map can draw the real route.
 */
export function useBreadcrumbRecorder(workspaceId: string, tripId: string) {
  const [recording, setRecording] = useState(false);
  const [count, setCount] = useState(0);
  const sub = useRef<Location.LocationSubscription | null>(null);
  const buffer = useRef<Buffered[]>([]);

  const record = useMutation(
    trpc.location.recordBreadcrumbs.mutationOptions({
      onError: (e) => Alert.alert("Track upload failed", e.message),
    }),
  );

  const flush = useCallback(() => {
    if (buffer.current.length === 0) return;
    const points = buffer.current;
    buffer.current = [];
    record.mutate({ workspaceId, tripId, points });
  }, [record, workspaceId, tripId]);

  const stop = useCallback(() => {
    sub.current?.remove();
    sub.current = null;
    flush();
    setRecording(false);
  }, [flush]);

  const start = useCallback(async () => {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") {
      Alert.alert("Location needed", "Enable location to record your track.");
      return;
    }
    setCount(0);
    buffer.current = [];
    sub.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 15_000,
        distanceInterval: 50, // meters
      },
      (loc) => {
        buffer.current.push({
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          speed: loc.coords.speed ?? null,
          recordedAt: new Date(loc.timestamp).toISOString(),
        });
        setCount((n) => n + 1);
        if (buffer.current.length >= FLUSH_EVERY) flush();
      },
    );
    setRecording(true);
  }, [flush]);

  // Stop watching + flush if the screen unmounts mid-recording.
  useEffect(() => {
    return () => {
      sub.current?.remove();
      sub.current = null;
    };
  }, []);

  return { recording, count, start, stop };
}
