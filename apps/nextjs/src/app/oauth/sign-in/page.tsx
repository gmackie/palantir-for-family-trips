import { redirect } from "next/navigation";

import { getSession } from "~/auth/server";
import { authorizeUrl, toQueryString } from "~/lib/oauth";
import { SignInOptions } from "../../sign-in/_components/sign-in-options";

/**
 * The OAuth provider's login page: an app (an MCP client) asked to connect
 * and nobody is signed in. Every sign-in method comes back here
 * (`callbackURL` is this page with its query), and once there is a session
 * the client's original authorization request starts again, which leads to
 * the consent page.
 */
export default async function OAuthSignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = toQueryString(await searchParams);
  const session = await getSession();
  if (session) redirect(authorizeUrl(query));
  const callbackURL = `/oauth/sign-in?${query}`;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 rounded-[4px] border border-[#21262D] bg-[#161B22] p-6">
        <div className="space-y-2">
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
            Connect an app
          </p>
          <h1 className="text-2xl font-black tracking-tight text-[#C9D1D9]">
            Sign in to connect
          </h1>
          <p className="text-sm text-[#8B949E]">
            An app wants to connect to your Sortey account. Sign in first; you
            will choose what it may do next.
          </p>
        </div>

        <SignInOptions
          socialCallbackURL={callbackURL}
          magicLinkCallbackURL={callbackURL}
        />
      </div>
    </main>
  );
}
