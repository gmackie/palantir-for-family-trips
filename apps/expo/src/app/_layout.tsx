import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { useEffect } from "react";

import { ErrorBoundary } from "~/components/error-boundary";
import { OutboxSyncHost } from "~/components/outbox-sync-host";
import { queryClient } from "~/utils/api";
import { C } from "~/utils/design";
import {
  restoreQueryClient,
  schedulePersist,
} from "~/utils/query-persist";
import { useMagicLinkCookie } from "~/utils/use-magic-link-cookie";
import { useOtaUpdates } from "~/utils/use-ota-updates";
import { usePushNotifications } from "~/utils/use-push-notifications";
import { Providers } from "../providers";

function PushNotificationRegistrar() {
  usePushNotifications();
  return null;
}

/** Stores the session cookie from magic-link deep-link redirects. */
function MagicLinkCookieCatcher() {
  useMagicLinkCookie();
  return null;
}

/** Checks EAS Update channel on load / foreground (preview + production). */
function OtaUpdateChecker() {
  useOtaUpdates({ promptOnReady: true, autoCheck: true });
  return null;
}

function QueryCachePersistHost() {
  useEffect(() => {
    void restoreQueryClient(queryClient);
    return schedulePersist(queryClient);
  }, []);
  return null;
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <Providers>
          <QueryCachePersistHost />
          <PushNotificationRegistrar />
          <OtaUpdateChecker />
          <MagicLinkCookieCatcher />
          <OutboxSyncHost />
          <Stack
            screenOptions={{
              headerStyle: {
                backgroundColor: C.bg,
              },
              headerTintColor: C.fg,
              contentStyle: {
                backgroundColor: C.bg,
              },
            }}
          />
          <StatusBar style="light" />
        </Providers>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
