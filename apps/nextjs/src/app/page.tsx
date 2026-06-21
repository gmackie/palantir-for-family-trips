import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession } from "~/auth/server";

export default async function HomePage() {
  const session = await getSession();

  if (session?.user) {
    redirect("/trips");
  }

  return (
    <main className="flex min-h-screen flex-col items-center px-6 pb-16 pt-24">
      {/* Hero */}
      <div className="max-w-2xl space-y-6 text-center">
        <p className="text-[10px] font-black uppercase tracking-[0.25em] text-[#58A6FF]">
          Sortey
        </p>
        <h1 className="text-5xl font-black tracking-tight text-[#C9D1D9] md:text-6xl">
          Plan together.
          <br />
          <span className="text-[#58A6FF]">Split everything.</span>
        </h1>
        <p className="mx-auto max-w-lg text-base leading-relaxed text-[#8B949E]">
          The group trip app that handles expenses, itineraries, polls, photos,
          and settlement — so you can focus on the trip, not the logistics.
        </p>
        <div className="flex items-center justify-center gap-4 pt-4">
          <Link
            href="/sign-in"
            className="inline-flex h-11 items-center rounded-[4px] bg-[#58A6FF] px-8 text-sm font-bold text-[#0D1B2A] transition-colors hover:bg-[#79C0FF]"
          >
            Get Started
          </Link>
        </div>
      </div>

      {/* Feature grid */}
      <section className="mx-auto mt-24 grid max-w-5xl gap-4 px-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-[4px] border border-[#21262D] bg-[#161B22] p-6">
          <p className="text-2xl">🧾</p>
          <h3 className="mt-3 text-sm font-bold text-[#C9D1D9]">Receipt OCR</h3>
          <p className="mt-1 text-xs leading-relaxed text-[#8B949E]">
            Snap a receipt, auto-extract line items, claim what you ordered.
            Fair splits without spreadsheets.
          </p>
        </div>
        <div className="rounded-[4px] border border-[#21262D] bg-[#161B22] p-6">
          <p className="text-2xl">💸</p>
          <h3 className="mt-3 text-sm font-bold text-[#C9D1D9]">
            Venmo Settlement
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-[#8B949E]">
            Minimized transactions with one-tap Venmo payment links. No
            &quot;who owes who&quot; confusion.
          </p>
        </div>
        <div className="rounded-[4px] border border-[#21262D] bg-[#161B22] p-6">
          <p className="text-2xl">📅</p>
          <h3 className="mt-3 text-sm font-bold text-[#C9D1D9]">
            Shared Itinerary
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-[#8B949E]">
            Day-by-day timeline everyone can see. Meals, activities, meetups —
            always know the plan.
          </p>
        </div>
        <div className="rounded-[4px] border border-[#21262D] bg-[#161B22] p-6">
          <p className="text-2xl">🗳️</p>
          <h3 className="mt-3 text-sm font-bold text-[#C9D1D9]">
            Polls &amp; Proposals
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-[#8B949E]">
            Vote on restaurants, activities, and timing. Propose ideas and let
            the group react.
          </p>
        </div>
        <div className="rounded-[4px] border border-[#21262D] bg-[#161B22] p-6">
          <p className="text-2xl">📸</p>
          <h3 className="mt-3 text-sm font-bold text-[#C9D1D9]">Trip Photos</h3>
          <p className="mt-1 text-xs leading-relaxed text-[#8B949E]">
            Shared photo feed with reactions. Upload from camera roll, organized
            by when they were taken.
          </p>
        </div>
        <div className="rounded-[4px] border border-[#21262D] bg-[#161B22] p-6">
          <p className="text-2xl">📡</p>
          <h3 className="mt-3 text-sm font-bold text-[#C9D1D9]">Live Map</h3>
          <p className="mt-1 text-xs leading-relaxed text-[#8B949E]">
            Pins, routes, POIs, and optional location sharing for real-time
            coordination.
          </p>
        </div>
      </section>

      {/* Use cases */}
      <section className="mx-auto mt-20 max-w-2xl text-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#484F58]">
          Built for
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          {[
            "Family Reunions",
            "Beach Trips",
            "Weddings",
            "Road Trips",
            "Ski Weekends",
            "Bachelor Parties",
          ].map((use) => (
            <span
              key={use}
              className="rounded-full border border-[#21262D] px-4 py-1.5 text-xs font-medium text-[#8B949E]"
            >
              {use}
            </span>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto mt-20 max-w-lg text-center">
        <h2 className="text-2xl font-bold text-[#C9D1D9]">
          Stop using the group chat for logistics.
        </h2>
        <p className="mt-3 text-sm text-[#8B949E]">
          Create a trip, invite your crew, and let Sortey handle the rest.
        </p>
        <Link
          href="/sign-in"
          className="mt-6 inline-flex h-11 items-center rounded-[4px] bg-[#58A6FF] px-8 text-sm font-bold text-[#0D1B2A] transition-colors hover:bg-[#79C0FF]"
        >
          Create Your First Trip
        </Link>
      </section>

      {/* Footer */}
      <footer className="mt-20 text-center">
        <p className="text-[11px] text-[#484F58]">
          © 2026 Sortey · Plan together. Split everything.
        </p>
      </footer>
    </main>
  );
}
