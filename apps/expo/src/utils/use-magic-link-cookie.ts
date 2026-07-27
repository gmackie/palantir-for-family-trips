import { parseSetCookieHeader } from "better-auth/cookies";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import { useEffect } from "react";

import { authClient } from "./auth";

// Must match the expoClient({ storagePrefix: "expo" }) cookie key.
const COOKIE_STORAGE_KEY = "expo_cookie";

type StoredCookies = Record<string, { value: string; expires: string | null }>;

// Mirrors the merge the better-auth Expo plugin applies to Set-Cookie
// headers so the stored shape stays compatible with authClient.getCookie().
function mergeSetCookie(header: string, prev: string | null): string {
  const parsed = parseSetCookieHeader(header);
  let merged: StoredCookies = {};
  if (prev) {
    try {
      merged = JSON.parse(prev) as StoredCookies;
    } catch {
      merged = {};
    }
  }
  parsed.forEach((cookie, key) => {
    const maxAge = cookie["max-age"];
    if (maxAge !== undefined && Number(maxAge) <= 0) {
      delete merged[key];
      return;
    }
    const expires = maxAge
      ? new Date(Date.now() + Number(maxAge) * 1000)
      : cookie.expires
        ? new Date(String(cookie.expires))
        : null;
    if (expires && expires.getTime() <= Date.now()) {
      delete merged[key];
      return;
    }
    merged[key] = {
      value: cookie.value ?? "",
      expires: expires ? expires.toISOString() : null,
    };
  });
  return JSON.stringify(merged);
}

/**
 * better-auth's Expo plugin only captures session cookies from its own
 * fetch responses and openAuthSessionAsync results. A magic link opened in
 * the system browser redirects back to the app as
 * `<scheme>://?cookie=<set-cookie>`, which nothing consumed — so a fresh
 * install could never finish magic-link sign-in. Capture that cookie from
 * any incoming deep link and store it where the plugin expects it.
 */
export function useMagicLinkCookie() {
  const url = Linking.useURL();

  useEffect(() => {
    if (!url) return;
    let cookie: string | null | undefined;
    try {
      const parsed = Linking.parse(url);
      const raw = parsed.queryParams?.cookie;
      cookie = Array.isArray(raw) ? raw[0] : raw;
    } catch {
      return;
    }
    if (!cookie) return;

    void (async () => {
      try {
        const prev = await SecureStore.getItemAsync(COOKIE_STORAGE_KEY);
        await SecureStore.setItemAsync(
          COOKIE_STORAGE_KEY,
          mergeSetCookie(cookie, prev),
        );
        authClient.$store.notify("$sessionSignal");
      } catch {
        // Best effort — the user can retry from the sign-in screen.
      }
    })();
  }, [url]);
}
