import { Button } from "@gmacko/ui/button";
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
    <main className="container mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-16">
      <div className="bg-card space-y-6 rounded-3xl border p-6 shadow-sm">
        <div className="space-y-2">
          <p className="text-primary text-sm font-semibold uppercase tracking-[0.24em]">
            Trip Command Center
          </p>
          <h1 className="text-3xl font-black tracking-tight">Sign in</h1>
          <p className="text-sm text-muted-foreground">
            Use a magic link for email sign-in or continue with Discord.
          </p>
        </div>

        <MagicLinkForm />

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card text-muted-foreground px-2">or</span>
          </div>
        </div>

        <form action={signInWithDiscord}>
          <Button className="w-full" type="submit" variant="outline">
            Sign in with Discord
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          <Link className="underline underline-offset-4" href="/">
            Back to home
          </Link>
        </p>
      </div>
    </main>
  );
}
