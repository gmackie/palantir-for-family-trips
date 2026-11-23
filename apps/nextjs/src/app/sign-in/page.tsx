import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession } from "~/auth/server";
import { SignInOptions } from "./_components/sign-in-options";

export default async function SignInPage() {
  const session = await getSession();

  if (session) {
    redirect("/");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 rounded-[4px] border border-[#21262D] bg-[#161B22] p-6">
        <div className="space-y-2">
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
            Sortey
          </p>
          <h1 className="text-2xl font-black tracking-tight text-[#C9D1D9]">
            Sign in
          </h1>
          <p className="text-sm text-[#8B949E]">
            Use a magic link for email sign-in or continue with a provider.
          </p>
        </div>

        <SignInOptions />

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
