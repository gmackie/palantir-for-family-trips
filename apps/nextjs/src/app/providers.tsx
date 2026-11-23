"use client";

import type { ReactNode } from "react";

import { AnalyticsBridge } from "./_components/analytics-bridge";

interface ProvidersProps {
  children: ReactNode;
}

/**
 * Analytics run on Dataflare (observe.gmac.io, project `trip`) through the
 * journey loader in public/dataflare.js and ~/lib/analytics; no provider is
 * needed. The bridge reports journey events that cross a server action.
 */
export function Providers({ children }: ProvidersProps) {
  return (
    <>
      <AnalyticsBridge />
      {children}
    </>
  );
}
