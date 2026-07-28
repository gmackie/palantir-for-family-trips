import { appRouter, createTRPCContext } from "@sortey/api";
import { headers } from "next/headers";
import Link from "next/link";

import { auth } from "~/auth/server";

export const dynamic = "force-dynamic";

export default async function SharePage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  const caller = appRouter.createCaller(
    await createTRPCContext({
      headers: new Headers(await headers()),
      authApi: auth.api,
    }),
  );

  const data = await caller.share.publicRecap({ token }).catch(() => null);

  if (!data) {
    return (
      <main className="mx-auto max-w-md space-y-3 px-6 py-16 text-center">
        <h1 className="text-xl font-semibold text-[#C9D1D9]">
          Journal not found
        </h1>
        <p className="text-sm text-[#8B949E]">
          This share link may have been turned off or never existed.
        </p>
        <Link href="/" className="text-sm text-[#58A6FF] hover:underline">
          Sortey →
        </Link>
      </main>
    );
  }

  const r = data.recap;

  return (
    <main className="min-h-screen bg-[#0D1117]">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-12">
        <div>
          <div className="font-mono text-xs uppercase tracking-widest text-[#8B949E]">
            Trip journal
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-[#C9D1D9]">
            {data.tripName}
          </h1>
          <p className="mt-1 text-sm text-[#8B949E]">
            {r.from ?? "?"} → {r.to ?? "?"}
            {r.dateStart ? ` · ${r.dateStart} → ${r.dateEnd}` : ""}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Days" value={r.days} />
          <Stat
            label={r.actualMiles != null ? "Miles (GPS)" : "Miles"}
            value={r.actualMiles ?? r.totalMiles}
          />
          <Stat label="Stops" value={r.stopCount} />
          <Stat label="States" value={r.states.length} />
        </div>

        {r.states.length > 0 && (
          <div className="font-mono text-sm text-[#C9D1D9]">
            {r.states.join(" → ")}
          </div>
        )}

        {data.stops.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="font-mono text-xs uppercase tracking-widest text-[#8B949E]">
              Route
            </div>
            {data.stops.map((s, i) => (
              <div
                key={`${s.name}-${i}`}
                className="flex items-center justify-between gap-3 rounded-md border border-[#21262D] bg-[#161B22] p-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm text-[#C9D1D9]">
                    {s.name}
                  </div>
                  <div className="font-mono text-xs text-[#8B949E]">
                    {s.date ?? ""}
                  </div>
                </div>
                <div className="shrink-0 font-mono text-xs text-[#8B949E]">
                  {s.miles} mi
                </div>
              </div>
            ))}
          </div>
        )}

        {r.camps.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="font-mono text-xs uppercase tracking-widest text-[#8B949E]">
              Camps ({r.campCount})
            </div>
            {r.camps.map((c, i) => (
              <div key={`${c}-${i}`} className="text-sm text-[#C9D1D9]">
                🏕 {c}
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-[#21262D] pt-4 text-center">
          <Link
            href="/"
            className="text-xs text-[#8B949E] hover:text-[#58A6FF]"
          >
            Tracked with Sortey
          </Link>
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[#21262D] bg-[#161B22] p-3">
      <div className="font-mono text-lg text-[#C9D1D9]">{value}</div>
      <div className="font-mono text-[10px] uppercase tracking-widest text-[#8B949E]">
        {label}
      </div>
    </div>
  );
}
