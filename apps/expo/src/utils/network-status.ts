import NetInfo, {
  type NetInfoState,
  type NetInfoSubscription,
} from "@react-native-community/netinfo";
import { useEffect, useState } from "react";

export type NetworkStatus = {
  /** True when the device reports a usable connection (best-effort). */
  online: boolean;
  /** Raw NetInfo snapshot for debugging. */
  state: NetInfoState | null;
};

function isOnline(state: NetInfoState | null): boolean {
  if (!state) return true; // optimistic until first reading
  if (state.isInternetReachable === false) return false;
  if (state.isConnected === false) return false;
  return true;
}

/**
 * Subscribe to connectivity. Defaults to online until NetInfo answers so cold
 * start does not flash "offline" before the first callback.
 */
export function useNetworkStatus(): NetworkStatus {
  const [state, setState] = useState<NetInfoState | null>(null);

  useEffect(() => {
    let sub: NetInfoSubscription | null = null;
    void NetInfo.fetch().then(setState);
    sub = NetInfo.addEventListener(setState);
    return () => {
      sub?.();
    };
  }, []);

  return { online: isOnline(state), state };
}

/** One-shot check for non-hook callers (outbox flush gate). */
export async function fetchIsOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return isOnline(state);
}
