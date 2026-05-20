"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function RoutePlannerForm(props: {
  tripId: string;
  workspaceId: string;
  planRouteAction: (
    formData: FormData,
  ) => Promise<{ error?: string; segmentCount?: number }>;
}) {
  const { planRouteAction } = props;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await planRouteAction(formData);
      if (result.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="flex h-full flex-col items-center justify-center bg-[#0D1117] p-8">
      <div className="w-full max-w-md space-y-6 rounded-[4px] border border-[#21262D] bg-[#161B22] p-6">
        <div className="space-y-1">
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
            Route Planner
          </p>
          <h2 className="text-lg font-bold text-[#C9D1D9]">Plan your route</h2>
          <p className="text-xs text-[#8B949E]">
            Enter origin and destination. Segments auto-split by driving hours
            and sunset times.
          </p>
        </div>

        <form action={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label
              htmlFor="originName"
              className="text-[10px] font-black uppercase tracking-[0.15em] text-[#8B949E]"
            >
              Origin
            </label>
            <input
              id="originName"
              name="originName"
              type="text"
              required
              placeholder="Seattle, WA"
              className="h-9 w-full rounded-[2px] border border-[#21262D] bg-[#0D1117] px-3 text-sm text-[#C9D1D9] placeholder-[#484F58] outline-none focus:border-[#58A6FF]"
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="destName"
              className="text-[10px] font-black uppercase tracking-[0.15em] text-[#8B949E]"
            >
              Destination
            </label>
            <input
              id="destName"
              name="destName"
              type="text"
              required
              placeholder="Des Moines, IA"
              className="h-9 w-full rounded-[2px] border border-[#21262D] bg-[#0D1117] px-3 text-sm text-[#C9D1D9] placeholder-[#484F58] outline-none focus:border-[#58A6FF]"
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="startDate"
              className="text-[10px] font-black uppercase tracking-[0.15em] text-[#8B949E]"
            >
              Start Date
            </label>
            <input
              id="startDate"
              name="startDate"
              type="date"
              required
              defaultValue="2026-06-05"
              className="h-9 w-full rounded-[2px] border border-[#21262D] bg-[#0D1117] px-3 text-sm text-[#C9D1D9] outline-none focus:border-[#58A6FF] [color-scheme:dark]"
            />
          </div>

          {error && <p className="text-xs text-[#F85149]">{error}</p>}

          <button
            type="submit"
            disabled={isPending}
            className="h-9 w-full rounded-[2px] bg-[#58A6FF] text-sm font-semibold text-[#0A0C10] transition-colors hover:bg-[#79B8FF] disabled:opacity-50"
          >
            {isPending ? "Planning route..." : "Plan Route"}
          </button>
        </form>
      </div>
    </div>
  );
}
