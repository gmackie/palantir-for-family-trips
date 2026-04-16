import { Button } from "@gmacko/ui/button";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession } from "~/auth/server";

export default async function HomePage() {
  const session = await getSession();

  if (session?.user) {
    redirect("/trips");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#0A0C10] px-6 text-center">
      <div className="max-w-xl space-y-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#8B949E]">
          Trip Command Center
        </p>
        <h1 className="text-5xl font-black tracking-tight text-white">
          Plan trips together.
          <br />
          <span className="text-[#58A6FF]">Split everything.</span>
        </h1>
        <p className="text-lg text-[#8B949E]">
          Collaborative trip planning with shared itineraries, receipt OCR,
          expense splitting, and real-time settlement. Built for groups.
        </p>
        <div className="flex items-center justify-center gap-4 pt-4">
          <Button asChild size="lg">
            <Link href="/sign-in">Sign in with magic link</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/demo">View demo dashboard</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
