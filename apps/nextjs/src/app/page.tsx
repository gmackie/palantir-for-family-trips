import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession } from "~/auth/server";

export default async function HomePage() {
  const session = await getSession();

  if (session?.user) {
    redirect("/trips");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#0A0C10] px-6">
      {/* Hero */}
      <div className="max-w-2xl space-y-6 text-center">
        <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
          Trip Command Center
        </p>
        <h1 className="text-5xl font-black tracking-tight text-[#C9D1D9] md:text-6xl">
          Plan together.
          <br />
          <span className="text-[#58A6FF]">Split everything.</span>
        </h1>
        <p className="mx-auto max-w-lg text-base text-[#8B949E]">
          Collaborative trip planning with shared itineraries, receipt OCR,
          expense splitting, and real-time settlement. Built for groups.
        </p>
        <div className="flex items-center justify-center gap-4 pt-4">
          <Link
            href="/sign-in"
            className="inline-flex h-10 items-center rounded-[2px] border border-[#58A6FF] bg-[#58A6FF]/10 px-6 text-sm font-semibold text-[#58A6FF] transition-colors hover:bg-[#58A6FF]/20"
          >
            Sign in
          </Link>
          <Link
            href="/demo"
            className="inline-flex h-10 items-center rounded-[2px] border border-[#21262D] px-6 text-sm font-semibold text-[#8B949E] transition-colors hover:border-[#484F58] hover:text-[#C9D1D9]"
          >
            View demo
          </Link>
        </div>
      </div>

      {/* Feature cards */}
      <section className="mx-auto mt-20 grid max-w-4xl gap-4 px-4 md:grid-cols-3">
        <div className="rounded-[4px] border border-[#21262D] bg-[#161B22] p-6">
          <p className="text-2xl">🗳️</p>
          <h3 className="mt-3 text-sm font-bold text-[#C9D1D9]">
            Collaborative Planning
          </h3>
          <p className="mt-1 text-xs text-[#8B949E]">
            Polls, proposals, and voting to decide on destinations and
            activities together.
          </p>
        </div>
        <div className="rounded-[4px] border border-[#21262D] bg-[#161B22] p-6">
          <p className="text-2xl">🧾</p>
          <h3 className="mt-3 text-sm font-bold text-[#C9D1D9]">
            Smart Expense Splitting
          </h3>
          <p className="mt-1 text-xs text-[#8B949E]">
            Receipt OCR with line-item claiming for fair, transparent expense
            splits.
          </p>
        </div>
        <div className="rounded-[4px] border border-[#21262D] bg-[#161B22] p-6">
          <p className="text-2xl">📡</p>
          <h3 className="mt-3 text-sm font-bold text-[#C9D1D9]">
            Command Center
          </h3>
          <p className="mt-1 text-xs text-[#8B949E]">
            Real-time map, transit routing, and arrivals board for on-the-ground
            coordination.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-20 pb-8 text-center">
        <p className="text-[11px] text-[#484F58]">
          Powered by Claude Vision for receipt OCR
        </p>
      </footer>
    </main>
  );
}
