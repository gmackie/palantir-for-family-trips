import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";

import { ErrorBoundary } from "~/components/error-boundary";
import { queryClient } from "~/utils/api";
import { Providers } from "../providers";

import "../styles.css";

// This is the main layout of the app
// It wraps your pages with the providers they need
export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <Providers>
          <Stack
            screenOptions={{
              headerStyle: {
                backgroundColor: "#0A0C10",
              },
              headerTintColor: "#C9D1D9",
              contentStyle: {
                backgroundColor: colorScheme == "dark" ? "#0A0C10" : "#FFFFFF",
              },
            }}
          />
          <StatusBar />
        </Providers>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
