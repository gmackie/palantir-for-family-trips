import "server-only";

import { initAuth } from "@sortey/auth";
import { sendEmail } from "@sortey/email";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import { headers } from "next/headers";
import { cache } from "react";

import { env } from "~/env";
import { devMagicLinkStore } from "./dev-magic-link";

const baseUrl =
  env.APP_URL ?? env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export const auth = initAuth({
  baseUrl,
  productionUrl: env.APP_URL ?? env.NEXT_PUBLIC_APP_URL ?? baseUrl,
  secret: env.AUTH_SECRET,
  discordClientId: env.AUTH_DISCORD_ID ?? undefined,
  discordClientSecret: env.AUTH_DISCORD_SECRET ?? undefined,
  googleClientId: env.AUTH_GOOGLE_ID,
  googleClientSecret: env.AUTH_GOOGLE_SECRET,
  appleClientId: env.AUTH_APPLE_ID,
  appleClientSecret: env.AUTH_APPLE_SECRET,
  appleBundleIdentifier: env.AUTH_APPLE_BUNDLE_ID,
  extraPlugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        devMagicLinkStore.remember({ email, url });

        if (env.NODE_ENV === "development") {
          console.log(`\n\n🔗 MAGIC LINK for ${email}:\n${url}\n\n`);
          return;
        }

        await sendEmail(
          {
            to: email,
            subject: "Sign in to Sortey",
            html: `<p>Open the button below to sign in.</p><p><a href="${url}">Sign in to Sortey</a></p>`,
            text: `Sign in to Sortey: ${url}`,
          },
          "Sortey <noreply@gmac.io>",
        );
      },
    }),
    nextCookies(),
  ],
});

export const getSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);
