import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "~/auth/server";
import { env } from "~/env";
import { MagicLinkForm } from "./magic-link-form";

const hasGoogle = !!env.AUTH_GOOGLE_ID && !!env.AUTH_GOOGLE_SECRET;
const hasApple = !!env.AUTH_APPLE_ID && !!env.AUTH_APPLE_SECRET;

/**
 * The sign-in methods: magic link, then the configured providers. The
 * callback URLs default to the app (`/` for providers, `/trips` for the
 * magic link); the OAuth sign-in page passes its own URL so an MCP client's
 * authorization request resumes after sign-in.
 */
export function SignInOptions({
  socialCallbackURL = "/",
  magicLinkCallbackURL = "/trips",
}: {
  socialCallbackURL?: string;
  magicLinkCallbackURL?: string;
} = {}) {
  async function signInWithGoogle() {
    "use server";

    const res = await auth.api.signInSocial({
      body: {
        provider: "google",
        callbackURL: socialCallbackURL,
      },
      headers: await headers(),
    });

    if (!res.url) {
      throw new Error("No URL returned from signInSocial");
    }

    redirect(res.url);
  }

  async function signInWithApple() {
    "use server";

    const res = await auth.api.signInSocial({
      body: {
        provider: "apple",
        callbackURL: socialCallbackURL,
      },
      headers: await headers(),
    });

    if (!res.url) {
      throw new Error("No URL returned from signInSocial");
    }

    redirect(res.url);
  }

  return (
    <>
      <MagicLinkForm callbackURL={magicLinkCallbackURL} />

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-[#21262D]" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-[#161B22] px-2 text-[#484F58]">or</span>
        </div>
      </div>

      <div className="space-y-3">
        {hasGoogle && (
          <form action={signInWithGoogle}>
            <button
              className="flex h-10 w-full items-center justify-center rounded-[2px] border border-[#21262D] bg-[#0D1117] text-sm font-semibold text-[#8B949E] transition-colors hover:border-[#484F58] hover:text-[#C9D1D9]"
              type="submit"
            >
              Sign in with Google
            </button>
          </form>
        )}
        {hasApple && (
          <form action={signInWithApple}>
            <button
              className="flex h-10 w-full items-center justify-center rounded-[2px] border border-[#21262D] bg-[#0D1117] text-sm font-semibold text-[#8B949E] transition-colors hover:border-[#484F58] hover:text-[#C9D1D9]"
              type="submit"
            >
              Sign in with Apple
            </button>
          </form>
        )}
      </div>
    </>
  );
}
