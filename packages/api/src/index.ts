import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "./root";

type RouterInputs = inferRouterInputs<AppRouter>;
type RouterOutputs = inferRouterOutputs<AppRouter>;

export { CAST_PUMP_TIME_BUDGET_MS, runCastPump } from "./cast/job";
export {
  assertRateLimit,
  RECEIPT_OCR_RATE_LIMIT,
  receiptOcrRateLimitKey,
  resetRateLimitBuckets,
} from "./rate-limit";
export type { RealtimeBroadcast, RealtimeRuntime } from "./realtime-runtime";
export { getRealtimeRuntime, runWithRealtimeRuntime } from "./realtime-runtime";
export { type AppRouter, appRouter } from "./root";
export {
  createDefaultTripDashboardState,
  LEGACY_TRIP_DOCUMENT_STORAGE_KEY,
  LEGACY_VIEWER_PROFILE_STORAGE_KEY,
  type TripDashboardNavItem,
  type TripDashboardState,
} from "./trips/dashboard-state";
export { createTRPCContext } from "./trpc";
export type {
  ApiVersion,
  VersionContext,
  VersioningConfig,
} from "./versioning";
export {
  API_VERSIONS,
  CURRENT_API_VERSION,
  createVersionContext,
  DEFAULT_API_VERSION,
  extractVersionFromHeaders,
  extractVersionFromUrl,
  getVersionResponseHeaders,
  resolveApiVersion,
} from "./versioning";
export type { RouterInputs, RouterOutputs };
