"use client";

import { Button } from "@sortey/ui/button";
import { toast } from "@sortey/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { useTRPC } from "~/trpc/react";

interface Buffered {
  lat: number;
  lng: number;
  speed: number | null;
  recordedAt: string;
}

// Flush the buffer to the server once it reaches this many fixes.
const FLUSH_EVERY = 10;

/**
 * Records a GPS breadcrumb trail from the browser (usable from a phone in the
 * van). Watches geolocation, buffers fixes, and flushes batches to
 * `location.recordBreadcrumbs`. The recap then reports actual driven miles.
 */
export function TrackRecorder({
  workspaceId,
  tripId,
}: {
  workspaceId: string;
  tripId: string;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [recording, setRecording] = useState(false);
  const [session, setSession] = useState(0); // fixes captured this session
  const watchId = useRef<number | null>(null);
  const buffer = useRef<Buffered[]>([]);

  const statsQuery = useQuery(
    trpc.location.trackStats.queryOptions({ workspaceId, tripId }),
  );

  const record = useMutation(
    trpc.location.recordBreadcrumbs.mutationOptions({
      onSuccess: () => {
        void qc.invalidateQueries({
          queryKey: trpc.location.trackStats.queryKey({ workspaceId, tripId }),
        });
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const flush = useCallback(() => {
    if (buffer.current.length === 0) return;
    const points = buffer.current;
    buffer.current = [];
    record.mutate({ workspaceId, tripId, points });
  }, [record, workspaceId, tripId]);

  const stop = useCallback(() => {
    if (watchId.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId.current);
    }
    watchId.current = null;
    flush();
    setRecording(false);
  }, [flush]);

  // Clean up the watch if the component unmounts mid-recording.
  useEffect(() => {
    return () => {
      if (watchId.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId.current);
      }
    };
  }, []);

  function start() {
    if (!navigator.geolocation) {
      toast.error("Geolocation not available");
      return;
    }
    setSession(0);
    buffer.current = [];
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        buffer.current.push({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          speed: pos.coords.speed ?? null,
          recordedAt: new Date(pos.timestamp).toISOString(),
        });
        setSession((n) => n + 1);
        if (buffer.current.length >= FLUSH_EVERY) flush();
      },
      () => toast.error("Couldn't read your location"),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    setRecording(true);
  }

  const stats = statsQuery.data;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[#21262D] bg-[#0D1117] p-4">
      <div className="font-mono text-xs uppercase tracking-widest text-[#8B949E]">
        GPS track
      </div>
      <p className="text-sm text-[#8B949E]">
        Record the actual path as you drive (keep this tab open). The recap
        reports real driven miles from your breadcrumbs.
      </p>

      {stats && stats.points > 0 && (
        <div className="font-mono text-xs text-[#C9D1D9]">
          {stats.points.toLocaleString()} points ·{" "}
          <span className="text-[#3FB950]">{stats.actualMiles} mi driven</span>
        </div>
      )}

      <div className="flex items-center gap-3">
        {recording ? (
          <Button
            type="button"
            onClick={stop}
            className="border-[#F85149] bg-[#F85149]/10 text-[#F85149] hover:bg-[#F85149]/20"
          >
            ⏹ Stop recording
          </Button>
        ) : (
          <Button type="button" variant="outline" onClick={start}>
            ● Record track
          </Button>
        )}
        {recording && (
          <span className="font-mono text-xs text-[#8B949E]">
            {session} fix{session === 1 ? "" : "es"} this session
          </span>
        )}
      </div>
    </div>
  );
}
