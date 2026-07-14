/**
 * EAS Update (OTA) check for preview/production clients.
 * Development clients + Expo Go skip — they load from Metro.
 */

import * as Updates from "expo-updates";
import { useCallback, useEffect, useState } from "react";
import { Alert, AppState, type AppStateStatus } from "react-native";

import { env } from "~/config/env";

export interface OtaState {
  checking: boolean;
  downloading: boolean;
  available: boolean;
  error: string | null;
  updateId: string | null;
  channel: string | null;
  check: () => Promise<void>;
  apply: () => Promise<void>;
}

/**
 * On non-dev builds, check for OTA on mount and when the app returns to
 * foreground. Call `check()` from Settings for a manual pass.
 */
export function useOtaUpdates(opts?: {
  /** Prompt the user when an update is ready (default true). */
  promptOnReady?: boolean;
  /** Auto-check on mount / foreground (default true outside development). */
  autoCheck?: boolean;
}): OtaState {
  const promptOnReady = opts?.promptOnReady ?? true;
  const autoCheck = opts?.autoCheck ?? !env.isDevelopment;

  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updateId, setUpdateId] = useState<string | null>(
    Updates.updateId ?? null,
  );

  const apply = useCallback(async () => {
    try {
      setDownloading(true);
      await Updates.reloadAsync();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply update");
      setDownloading(false);
    }
  }, []);

  const check = useCallback(async () => {
    if (__DEV__ || !Updates.isEnabled) {
      setError(null);
      setAvailable(false);
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) {
        setAvailable(false);
        return;
      }
      setDownloading(true);
      const fetched = await Updates.fetchUpdateAsync();
      setDownloading(false);
      if (fetched.isNew) {
        setAvailable(true);
        setUpdateId(fetched.manifest?.id ?? null);
        if (promptOnReady) {
          Alert.alert(
            "Update ready",
            "A new Sortey JS update is ready (active trip, map, planner). Restart to apply — no App Store reinstall needed.",
            [
              { text: "Later", style: "cancel" },
              {
                text: "Restart",
                onPress: () => {
                  void apply();
                },
              },
            ],
          );
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update check failed");
      setAvailable(false);
    } finally {
      setChecking(false);
      setDownloading(false);
    }
  }, [apply, promptOnReady]);

  useEffect(() => {
    if (!autoCheck) return;
    void check();
  }, [autoCheck, check]);

  useEffect(() => {
    if (!autoCheck) return;
    const onChange = (state: AppStateStatus) => {
      if (state === "active") void check();
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [autoCheck, check]);

  return {
    checking,
    downloading,
    available,
    error,
    updateId,
    channel: Updates.channel ?? null,
    check,
    apply,
  };
}
