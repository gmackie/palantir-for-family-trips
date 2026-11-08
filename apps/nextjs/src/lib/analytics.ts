/**
 * Journey analytics for observe.gmac.io (DATFLR-9).
 *
 * `public/dataflare.js` defines `window.dataflare`; these wrappers no-op when
 * it is missing (SSR, tests, kill switch off, blocked script) and never throw.
 * Event names are `object_action`, past tense. Props are small enums or counts:
 * never emails, names or free text.
 */
export type JourneyEvent = "trip_created" | "invite_sent" | "invite_accepted";

export type JourneyProps = Record<string, string | number | boolean | null>;

interface DataflareApi {
  track(event: string, props?: JourneyProps): void;
  identify(id: string, props?: JourneyProps): void;
  reset(): void;
}

declare global {
  interface Window {
    /** Defined by public/dataflare.js (journey loader v2). */
    dataflare?: DataflareApi;
  }
}

function api(): DataflareApi | undefined {
  return typeof window === "undefined" ? undefined : window.dataflare;
}

export function track(event: JourneyEvent, props?: JourneyProps): void {
  try {
    api()?.track(event, props);
  } catch {
    // Analytics must never break the app.
  }
}

/** Link this browser's journey to an opaque account id (never an email). */
export function identifyUser(id: string | number, props?: JourneyProps): void {
  try {
    api()?.identify(String(id), props);
  } catch {
    // Analytics must never break the app.
  }
}

/** Forget the account on sign-out. */
export function resetUser(): void {
  try {
    api()?.reset();
  } catch {
    // Analytics must never break the app.
  }
}

/**
 * Query flag the create-trip server action appends to its redirect, because a
 * server action's success is only visible to the client after navigation.
 * Value: `<tripMode>-<group|family>`, e.g. `roadtrip-group`.
 */
export const TRIP_CREATED_PARAM = "trip_created";

export function tripCreatedFlag(tripMode: string, groupMode: boolean): string {
  return `${tripMode}-${groupMode ? "group" : "family"}`;
}

/** Props for `trip_created` from a location search string, or null. */
export function tripCreatedProps(search: string): JourneyProps | null {
  const value = new URLSearchParams(search).get(TRIP_CREATED_PARAM);
  const match = value
    ? /^(destination|roadtrip)-(group|family)$/.exec(value)
    : null;
  if (!match) return null;
  return { trip_mode: match[1] ?? null, group_mode: match[2] === "group" };
}
