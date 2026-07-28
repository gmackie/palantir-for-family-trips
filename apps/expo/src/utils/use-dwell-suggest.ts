/**
 * Foreground dwell detection — if the van has been nearly stopped in one place
 * for DWELL_MS, suggest logging a stop (Today / Drive companion).
 */
import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";

const DWELL_MS = 12 * 60 * 1000; // 12 minutes
const MAX_SPEED_MPS = 1.2; // ~2.7 mph
const MAX_DRIFT_M = 80;

function metersBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sLat = Math.sin(dLat / 2);
  const sLng = Math.sin(dLng / 2);
  const h =
    sLat * sLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sLng *
      sLng;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export interface DwellSuggestion {
  lat: number;
  lng: number;
  minutes: number;
}

export function useDwellSuggest(enabled: boolean) {
  const [suggestion, setSuggestion] = useState<DwellSuggestion | null>(null);
  const anchor = useRef<{ lat: number; lng: number; since: number } | null>(
    null,
  );
  const dismissed = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setSuggestion(null);
      anchor.current = null;
      return;
    }

    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;

    void (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted" || cancelled) return;

      const watcher = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 20_000,
          distanceInterval: 25,
        },
        (loc) => {
          const here = {
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
          };
          const speed = loc.coords.speed ?? 0;
          const moving = speed > MAX_SPEED_MPS;

          if (moving) {
            anchor.current = null;
            dismissed.current = false;
            setSuggestion(null);
            return;
          }

          if (!anchor.current) {
            anchor.current = { ...here, since: Date.now() };
            return;
          }

          const drift = metersBetween(anchor.current, here);
          if (drift > MAX_DRIFT_M) {
            anchor.current = { ...here, since: Date.now() };
            dismissed.current = false;
            setSuggestion(null);
            return;
          }

          const elapsed = Date.now() - anchor.current.since;
          if (elapsed >= DWELL_MS && !dismissed.current) {
            setSuggestion({
              lat: anchor.current.lat,
              lng: anchor.current.lng,
              minutes: Math.round(elapsed / 60_000),
            });
          }
        },
      );

      if (cancelled) {
        // Effect cleaned up while the watch promise was pending — remove the
        // subscription here or it leaks GPS forever.
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

  const dismiss = () => {
    dismissed.current = true;
    setSuggestion(null);
  };

  return { suggestion, dismiss };
}
