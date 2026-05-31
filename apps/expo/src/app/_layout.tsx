import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { ErrorBoundary } from "~/components/error-boundary";
import { queryClient } from "~/utils/api";
import { C } from "~/utils/design";
import { usePushNotifications } from "~/utils/use-push-notifications";
import { Providers } from "../providers";

function PushNotificationRegistrar() {
  usePushNotifications();
  return null;
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <Providers>
          <PushNotificationRegistrar />
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
