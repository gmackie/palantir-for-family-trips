import { expo } from "@better-auth/expo";
import { db } from "@sortey/db/client";
import type { WorkspaceRole } from "@sortey/db/schema";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthEndpoint } from "better-auth/api";
import { oAuthProxy } from "better-auth/plugins";
import { z } from "zod/v4";

const devMagicLinkBodySchema = z.object({
  email: z.email(),
  name: z.string().optional(),
  callbackURL: z.string().optional(),
});
function generateMagicLinkToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
// dev-stage: magic-link bypass for demo login (env flag doesn't reach the vinext worker; gate before real prod)
// Demo/verification accounts allowed to use the magic-link bypass. Restricted to
// these (several per app) so it can never mint a session for a real user. Demo
// accounts = any email at the reserved domain below, plus an optional
// DEMO_LOGIN_EMAILS allowlist. SECURITY: keep restricted to demo accounts.
const DEMO_EMAIL_DOMAIN = "@demo.preflight.app";
function isDemoLoginEmail(email: string): boolean {
  const e = (email ?? "").trim().toLowerCase();
  if (e.endsWith(DEMO_EMAIL_DOMAIN)) return true;
  const extra = (process.env.DEMO_LOGIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return extra.includes(e);
}

function devMagicLinkBypass(enabled: boolean | undefined) {
  return {
    id: "sortey-dev-magic-link-bypass",
    endpoints: {
      devSignInMagicLink: createAuthEndpoint(
        "/dev/sign-in/magic-link",
        { method: "POST", requireHeaders: true, body: devMagicLinkBodySchema },
        async (ctx) => {
          if (!enabled)
            throw ctx.error("FORBIDDEN", {
              message: "Magic link bypass is disabled",
            });
          const { callbackURL, email, name } = ctx.body;
          if (!isDemoLoginEmail(email)) {
            throw ctx.error("FORBIDDEN", {
              message:
                "Magic link bypass is restricted to demo/verification accounts",
            });
          }
          const token = generateMagicLinkToken();
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: token,
            value: JSON.stringify({ email, name, attempt: 0 }),
            expiresAt: new Date(Date.now() + 300 * 1000),
          });
          const realBaseURL = new URL(ctx.context.baseURL);
          const pathname =
            realBaseURL.pathname === "/" ? "" : realBaseURL.pathname;
          const basePath = pathname ? "" : ctx.context.options.basePath || "";
          const url = new URL(
            `${pathname}${basePath}/magic-link/verify`,
            realBaseURL.origin,
          );
          url.searchParams.set("token", token);
          url.searchParams.set("callbackURL", callbackURL || "/");
          return ctx.json({
            status: true,
            bypass: true,
            email,
            token,
            url: url.toString(),
          });
        },
      ),
    },
  };
}

export function isPlatformAdminRole(
  role: "user" | "admin" | null | undefined,
): role is "admin" {
  return role === "admin";
}

export function canManageWorkspace(
  role: WorkspaceRole | null | undefined,
): boolean {
  return role === "owner" || role === "admin";
}

export function initAuth<
  TExtraPlugins extends BetterAuthPlugin[] = [],
>(options: {
  baseUrl: string;
  productionUrl: string;
  secret: string | undefined;

  discordClientId?: string;
  discordClientSecret?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  appleClientId?: string;
  appleClientSecret?: string;
  appleBundleIdentifier?: string;
  devMagicLinkBypassEnabled?: boolean;
  extraPlugins?: TExtraPlugins;
}) {
  const config = {
    database: drizzleAdapter(db, {
      provider: "pg",
    }),
    baseURL: options.baseUrl,
    secret: options.secret,
    user: {
      deleteUser: {
        enabled: true,
      },
    },
    plugins: [
      devMagicLinkBypass(options.devMagicLinkBypassEnabled),
      oAuthProxy({
        productionURL: options.productionUrl,
      }),
      expo(),
      ...(options.extraPlugins ?? []),
    ],
    socialProviders: {
      ...(options.googleClientId && options.googleClientSecret
        ? {
            google: {
              clientId: options.googleClientId,
              clientSecret: options.googleClientSecret,
            },
          }
        : {}),
      ...(options.appleClientId && options.appleClientSecret
        ? {
            apple: {
              clientId: options.appleClientId,
              clientSecret: options.appleClientSecret,
              appBundleIdentifier: options.appleBundleIdentifier,
            },
          }
        : {}),
      ...(options.discordClientId && options.discordClientSecret
        ? {
            discord: {
              clientId: options.discordClientId,
              clientSecret: options.discordClientSecret,
              redirectURI: `${options.productionUrl}/api/auth/callback/discord`,
            },
          }
        : {}),
    },
    trustedOrigins: [
      "sortey://",
      "sortey-dev://",
      "sortey-expo://",
      "exp://",
      "https://appleid.apple.com",
    ],
    onAPIError: {
      onError(error, ctx) {
        console.error("BETTER AUTH API ERROR", error, ctx);
      },
    },
  } satisfies BetterAuthOptions;

  return betterAuth(config);
}

export type Auth = ReturnType<typeof initAuth>;
export type Session = Auth["$Infer"]["Session"];
