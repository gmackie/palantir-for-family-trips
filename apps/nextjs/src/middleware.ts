import { integrations } from "@gmacko/config";
import createMiddleware from "next-intl/middleware";

import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

export default function middleware(
  request: Parameters<typeof intlMiddleware>[0],
) {
  // The current app route tree is not locale-segmented, so locale rewrites from
  // next-intl make non-root pages unreachable. Keep middleware disabled until
  // the route structure is actually localized.
  if (integrations.i18n) {
    return;
  }

  return intlMiddleware(request);
}

export const config = {
  // Match all pathnames except for:
  // - API routes
  // - Static files (images, fonts, etc.)
  // - Next.js internals
  matcher: [
    "/((?!api|_next|.*\\..*).*)",
    // Also match the root
    "/",
  ],
};
