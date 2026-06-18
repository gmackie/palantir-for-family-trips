// Shared semantic status → tone mapping.
//
// This module is intentionally platform-agnostic: it maps a status string to a
// semantic *tone*, not to a CSS class or hex value. Each surface renders the
// tone its own way (nextjs builds tailwind classes; expo uses hex from its
// design constants), but the status→meaning decision lives here once.

export type StatusTone =
  | "success"
  | "warning"
  | "critical"
  | "info"
  | "neutral";

/**
 * Canonical hex per tone — matches the Palantir command-center palette and the
 * expo `C.*` design constants. Use for expo (style objects) or anywhere a raw
 * color is needed; nextjs typically maps tone → tailwind classes instead.
 */
export const TONE_HEX: Record<StatusTone, string> = {
  success: "#3FB950",
  warning: "#D29922",
  critical: "#F85149",
  info: "#58A6FF",
  neutral: "#8B949E",
};

/** Trip lifecycle status (planning → confirmed → active/en_route → completed). */
export function tripStatusTone(status: string): StatusTone {
  switch (status) {
    case "active":
      return "success";
    case "confirmed":
      return "info";
    case "planning":
    case "en_route":
      return "warning";
    case "paused":
    case "completed":
      return "neutral";
    default:
      return "neutral";
  }
}

/** Arrival/tracking status (scheduled → en_route → arrived; delayed/cancelled). */
export function trackingStatusTone(status: string): StatusTone {
  switch (status) {
    case "arrived":
      return "success";
    case "scheduled":
      return "info";
    case "en_route":
      return "warning";
    case "delayed":
      return "critical";
    case "cancelled":
      return "neutral";
    default:
      return "neutral";
  }
}
