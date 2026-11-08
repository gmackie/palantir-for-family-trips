"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { authClient } from "~/auth/client";
import {
  identifyUser,
  resetUser,
  TRIP_CREATED_PARAM,
  track,
  tripCreatedProps,
} from "~/lib/analytics";

const IDENTIFIED_KEY = "sortey.analytics.identified";

function readMarker(): string | null {
  try {
    return window.localStorage.getItem(IDENTIFIED_KEY);
  } catch {
    return null;
  }
}

function writeMarker(value: string | null): void {
  try {
    if (value) window.localStorage.setItem(IDENTIFIED_KEY, value);
    else window.localStorage.removeItem(IDENTIFIED_KEY);
  } catch {
    // Storage blocked: identify still works for this page.
  }
}

/**
 * observe.gmac.io journey wiring (TRIP-3, DATFLR-9):
 * - identifies the better-auth session user by opaque id once per user, and
 *   resets once the session is gone (sign-out is a server action, so the
 *   client only sees the signed-out session afterwards);
 * - records `trip_created` from the create-trip action's redirect flag, then
 *   strips the flag from the URL.
 */
export function AnalyticsBridge() {
  const { data, isPending } = authClient.useSession();
  const userId = data?.user.id ?? null;
  const pathname = usePathname();

  useEffect(() => {
    if (isPending) return;
    const marker = readMarker();
    if (userId) {
      identifyUser(userId);
      writeMarker(userId);
    } else if (marker) {
      resetUser();
      writeMarker(null);
    }
  }, [userId, isPending]);

  useEffect(() => {
    const props = tripCreatedProps(window.location.search);
    if (!props) return;
    track("trip_created", props);
    const params = new URLSearchParams(window.location.search);
    params.delete(TRIP_CREATED_PARAM);
    const query = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  }, [pathname]);

  return null;
}
