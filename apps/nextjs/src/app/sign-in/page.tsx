import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth, getSession } from "~/auth/server";
import { MagicLinkForm } from "./_components/magic-link-form";

export default async function SignInPage() {
  const session = await getSession();

  if (session) {
    redirect("/");
  }

  async function signInWithDiscord() {
    "use server";

    const res = await auth.api.signInSocial({
      body: {
        provider: "discord",
        callbackURL: "/",
      },
      headers: await headers(),
    });

    if (!res.url) {
      throw new Error("No URL returned from signInSocial");
    }

    redirect(res.url);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#0A0C10] px-4">
      <div className="w-full max-w-sm space-y-6 rounded-[4px] border border-[#21262D] bg-[#161B22] p-6">
        <div className="space-y-2">
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
            Trip Command Center
          </p>
          <h1 className="text-2xl font-black tracking-tight text-[#C9D1D9]">
            Sign in
          </h1>
          <p className="text-sm text-[#8B949E]">
            Use a magic link for email sign-in or continue with Discord.
          </p>
        </div>

        <MagicLinkForm />

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-[#21262D]" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-[#161B22] px-2 text-[#484F58]">or</span>
          </div>
        </div>

        <form action={signInWithDiscord}>
          <button
            className="flex h-10 w-full items-center justify-center rounded-[2px] border border-[#21262D] bg-[#0D1117] text-sm font-semibold text-[#8B949E] transition-colors hover:border-[#484F58] hover:text-[#C9D1D9]"
            type="submit"
          >
            Sign in with Discord
          </button>
        </form>

        <p className="text-center text-sm text-[#484F58]">
          <Link
            className="text-[#8B949E] underline underline-offset-4 transition-colors hover:text-[#C9D1D9]"
            href="/"
          >
            Back to home
          </Link>
        </p>
      </div>
    </main>
  );
}
