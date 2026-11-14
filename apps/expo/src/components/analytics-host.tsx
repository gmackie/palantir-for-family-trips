import { usePathname } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { authClient } from "~/utils/auth";
import {
  flushAnalytics,
  syncAnalyticsUser,
  trackScreen,
} from "~/utils/observe-analytics";

/**
 * observe.gmac.io wiring (SORTEY-32): one screen view per route change,
 * identify/reset following the auth session, and a flush whenever the app
 * leaves the foreground.
 */
export function AnalyticsHost() {
  const pathname = usePathname();
  const { data, isPending } = authClient.useSession();
  const userId = data?.user.id ?? null;
  const lastUserId = useRef<string | null>(null);

  useEffect(() => {
    trackScreen(pathname);
  }, [pathname]);

  useEffect(() => {
    if (isPending) return;
    lastUserId.current = syncAnalyticsUser(lastUserId.current, userId);
  }, [userId, isPending]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") flushAnalytics();
    });
    return () => subscription.remove();
  }, []);

  return null;
}
