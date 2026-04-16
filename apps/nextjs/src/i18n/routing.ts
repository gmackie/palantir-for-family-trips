import { defineRouting } from "next-intl/routing";

export const defaultLocale = "en";
export const locales = ["en", "es"] as const;

export type Locale = (typeof locales)[number];

export const routing = defineRouting({
  locales,
  defaultLocale,
  // The current app routes are not locale-segmented, so prefix rewrites break
  // non-root pages like /faq and /sign-in. Keep locale state without URL prefixes
  // until the route tree is actually localized.
  localePrefix: "never",
});
