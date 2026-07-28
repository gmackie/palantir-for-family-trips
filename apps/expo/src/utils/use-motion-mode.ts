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
export const STOPPED_SPEED_MPS = 2.2;
/** Must stay slow this long before flipping to stopped (avoids light reds). */
export const STOPPED_HOLD_MS = 45_000;
/** Must stay fast this long before flipping to moving. */
export const MOVING_HOLD_MS = 20_000;

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

/** Normalize a raw GPS speed reading: negative/NaN/missing → null. */
export function normalizeSpeedMps(
  speed: number | null | undefined,
): number | null {
  return speed != null && Number.isFinite(speed) && speed >= 0 ? speed : null;
}

export interface MotionDebounceState {
  mode: MotionMode;
  candidate: { mode: MotionMode; since: number } | null;
}

export const INITIAL_MOTION_STATE: MotionDebounceState = {
  mode: "unknown",
  candidate: null,
};

/**
 * Pure debounce state machine for motion mode. A raw reading only flips the
 * settled mode after persisting for the direction's hold time; null speed
 * keeps the previous mode (GPS position still updates).
 */
export function nextMotionState(
  state: MotionDebounceState,
  speedMps: number | null,
  now: number,
): MotionDebounceState {
  const raw: MotionMode =
    speedMps == null
      ? "unknown"
      : speedMps > STOPPED_SPEED_MPS
        ? "moving"
        : "stopped";

  if (raw === "unknown") return state;
  if (state.mode === "unknown" || state.mode === raw) {
    return { mode: raw, candidate: null };
  }
  if (!state.candidate || state.candidate.mode !== raw) {
    return { mode: state.mode, candidate: { mode: raw, since: now } };
  }
  const holdMs = raw === "moving" ? MOVING_HOLD_MS : STOPPED_HOLD_MS;
  if (now - state.candidate.since >= holdMs) {
    return { mode: raw, candidate: null };
  }
  return state;
}

export function useMotionMode(enabled: boolean): MotionSnapshot {
  const [snap, setSnap] = useState<MotionSnapshot>(INITIAL);
  // Debounce state lives in a ref so bookkeeping happens outside the setState
  // updater (React may invoke updaters more than once).
  const stateRef = useRef<MotionDebounceState>(INITIAL_MOTION_STATE);

  useEffect(() => {
    if (!enabled) {
      setSnap(INITIAL);
      stateRef.current = INITIAL_MOTION_STATE;
      return;
    }

    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    stateRef.current = INITIAL_MOTION_STATE;

    void (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted" || cancelled) return;

      const watcher = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 5_000,
          distanceInterval: 15,
        },
        (loc) => {
          const speedMps = normalizeSpeedMps(loc.coords.speed);
          const now = Date.now();
          const next = nextMotionState(stateRef.current, speedMps, now);
          stateRef.current = next;

          setSnap({
            mode: next.mode,
            speedMps,
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
            heading: loc.coords.heading ?? null,
            updatedAt: now,
          });
        },
      );

      if (cancelled) {
        // Effect cleaned up while the watch promise was pending — the cleanup
        // already ran, so remove the subscription here or it leaks GPS forever.
        watcher.remove();
        return;
      }
      sub = watcher;
    })();

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [enabled]);

  return snap;
}
