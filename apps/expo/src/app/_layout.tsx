import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { ErrorBoundary } from "~/components/error-boundary";
import { queryClient } from "~/utils/api";
import { Providers } from "../providers";

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <Providers>
          <Stack
            screenOptions={{
              headerStyle: {
                backgroundColor: "#141116",
              },
              headerTintColor: "#f9f7fb",
              contentStyle: {
                backgroundColor: "#141116",
              },
            }}
          />
          <StatusBar style="light" />
        </Providers>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
