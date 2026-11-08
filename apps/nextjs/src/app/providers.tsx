"use client";

import { PostHogProvider } from "@sortey/analytics/web";
import { integrations } from "@sortey/config";
import type { ReactNode } from "react";

import { env } from "~/env";

import { AnalyticsBridge } from "./_components/analytics-bridge";

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  if (integrations.posthog && env.NEXT_PUBLIC_POSTHOG_KEY) {
    return (
      <PostHogProvider
        apiKey={env.NEXT_PUBLIC_POSTHOG_KEY}
        apiHost={env.NEXT_PUBLIC_POSTHOG_HOST}
      >
        <AnalyticsBridge />
        {children}
      </PostHogProvider>
    );
  }

  return (
    <>
      <AnalyticsBridge />
      {children}
    </>
  );
}
