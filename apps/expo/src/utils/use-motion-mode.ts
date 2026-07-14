/**
 * Foreground motion mode for Driving Mode vs Stopped Mode chrome.
 *
 * Uses the same speed/dwell thresholds as dwell suggest. Not a navigator —
 * only decides whether the companion UI should be glanceable (moving) or
 * full (stopped).
 */
import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";

export type MotionMode = "moving" | "stopped" | "unknown";

/** ~5 mph — below this we treat the van as stopped for UI purposes. */
const STOPPED_SPEED_MPS = 2.2;
/** Must stay slow this long before flipping to stopped (avoids light reds). */
const STOPPED_HOLD_MS = 45_000;
/** Must stay fast this long before flipping to moving. */
const MOVING_HOLD_MS = 20_000;

export interface MotionSnapshot {
  mode: MotionMode;
  speedMps: number | null;
  lat: number | null;
  lng: number | null;
  heading: number | null;
  updatedAt: number | null;
}

const INITIAL: MotionSnapshot = {
  mode: "unknown",
  speedMps: null,
  lat: null,
  lng: null,
  heading: null,
  updatedAt: null,
};

export function useMotionMode(enabled: boolean): MotionSnapshot {
  const [snap, setSnap] = useState<MotionSnapshot>(INITIAL);
  const candidate = useRef<{ mode: MotionMode; since: number } | null>(null);

  useEffect(() => {
    if (!enabled) {
      setSnap(INITIAL);
      candidate.current = null;
      return;
    }

    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;

    void (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted" || cancelled) return;

      sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 5_000,
          distanceInterval: 15,
        },
        (loc) => {
          const speed = loc.coords.speed;
          const speedMps =
            speed != null && Number.isFinite(speed) && speed >= 0 ? speed : null;
          const raw: MotionMode =
            speedMps == null
              ? "unknown"
              : speedMps > STOPPED_SPEED_MPS
                ? "moving"
                : "stopped";

          const now = Date.now();
          const holdMs =
            raw === "moving"
              ? MOVING_HOLD_MS
              : raw === "stopped"
                ? STOPPED_HOLD_MS
                : 0;

          setSnap((prev) => {
            let mode = prev.mode;

            if (raw === "unknown") {
              // Keep previous mode when GPS lacks speed; still update position.
            } else if (prev.mode === "unknown" || prev.mode === raw) {
              mode = raw;
              candidate.current = null;
            } else {
              // Debounce transitions
              if (!candidate.current || candidate.current.mode !== raw) {
                candidate.current = { mode: raw, since: now };
              } else if (now - candidate.current.since >= holdMs) {
                mode = raw;
                candidate.current = null;
              }
            }

            return {
              mode,
              speedMps,
              lat: loc.coords.latitude,
              lng: loc.coords.longitude,
              heading: loc.coords.heading ?? null,
              updatedAt: now,
            };
          });
        },
      );
    })();

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [enabled]);

  return snap;
}
