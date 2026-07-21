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
      onError: (e, vars) => {
        // Re-queue the failed batch so intermittent connectivity doesn't
        // leave permanent gaps in the track; the next flush retries them.
        const requeued: Buffered[] = vars.points.map((p) => ({
          lat: p.lat,
          lng: p.lng,
          speed: p.speed ?? null,
          recordedAt: p.recordedAt ?? new Date().toISOString(),
        }));
        buffer.current = [...requeued, ...buffer.current];
        Alert.alert("Track upload failed", e.message);
      },
    }),
  );

  const flush = useCallback(() => {
    if (buffer.current.length === 0) return;
    const points = buffer.current;
    buffer.current = [];
    record.mutate({ workspaceId, tripId, points });
  }, [record, workspaceId, tripId]);

  // Bumped by stop()/unmount to invalidate an in-flight start(); without it a
  // stop pressed during the permission prompt would be silently overridden
  // when the pending watchPositionAsync resolves.
  const generation = useRef(0);

  const stop = useCallback(() => {
    generation.current += 1;
    sub.current?.remove();
    sub.current = null;
    flush();
    setRecording(false);
  }, [flush]);

  const starting = useRef(false);

  const start = useCallback(async () => {
    // Guard double-start: the Drive screen auto-start effect can re-fire while
    // the permission prompt / watch setup is still pending (recording stays
    // false until setup completes), which would leak the first GPS watcher.
    if (starting.current || sub.current) return;
    starting.current = true;
    const gen = generation.current;
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (gen !== generation.current) return;
      if (perm.status !== "granted") {
        Alert.alert("Location needed", "Enable location to record your track.");
        return;
      }
      setCount(0);
      buffer.current = [];
      const watcher = await Location.watchPositionAsync(
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
      if (gen !== generation.current) {
        // stop() or unmount happened while the watch promise was pending.
        watcher.remove();
        return;
      }
      sub.current = watcher;
      setRecording(true);
    } finally {
      starting.current = false;
    }
  }, [flush]);

  // Stop watching + flush if the screen unmounts mid-recording. The mutation
  // outlives the unmount (react-query keeps it running), so trailing points
  // below the batch threshold still get uploaded. flush goes through a ref so
  // this cleanup-only effect keeps its empty dep list.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    return () => {
      generation.current += 1;
      sub.current?.remove();
      sub.current = null;
      flushRef.current();
    };
  }, []);

  return { recording, count, start, stop };
}
