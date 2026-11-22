import { redirect } from "next/navigation";

import { getSession } from "~/auth/server";
import { authorizeUrl, toQueryString } from "~/lib/oauth";
import { ConsentForm } from "./consent-form";

/**
 * The OAuth provider's consent page: which app, where it sends the user
 * back, and the requested scopes, each one untickable. Allowing sends the
 * ticked subset to the provider, which redirects back to the app with a
 * code. Without a session the authorization request starts again (and the
 * provider sends the user to sign in).
 */
export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = toQueryString(await searchParams);
  const session = await getSession();
  if (!session) redirect(authorizeUrl(query));

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 rounded-[4px] border border-[#21262D] bg-[#161B22] p-6">
        <div className="space-y-2">
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
            Connect an app
          </p>
          <h1 className="text-2xl font-black tracking-tight text-[#C9D1D9]">
            Allow access?
          </h1>
          <p className="text-sm text-[#8B949E]">
            Signed in as {session.user.email}.
          </p>
        </div>
        <ConsentForm />
      </div>
    </main>
  );
}
