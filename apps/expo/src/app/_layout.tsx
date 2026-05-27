import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { ErrorBoundary } from "~/components/error-boundary";
import { queryClient } from "~/utils/api";
import { C } from "~/utils/design";
import { Providers } from "../providers";

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <Providers>
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
