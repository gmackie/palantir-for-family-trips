import "server-only";

import { initAuth } from "@gmacko/auth";
import { sendEmail } from "@gmacko/email";
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
  discordClientId: env.AUTH_DISCORD_ID,
  discordClientSecret: env.AUTH_DISCORD_SECRET,
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
            subject: "Sign in to Trip Command Center",
            html: `<p>Open the button below to sign in.</p><p><a href="${url}">Sign in to Trip Command Center</a></p>`,
            text: `Sign in to Trip Command Center: ${url}`,
          },
          "Trip Command Center <onboarding@resend.dev>",
        );
      },
    }),
    nextCookies(),
  ],
});

export const getSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);
