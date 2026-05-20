"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { PlacesAutocompleteInput } from "~/components/places-autocomplete-input";

export function RoutePlannerForm(props: {
  tripId: string;
  workspaceId: string;
  defaultOrigin?: string;
  defaultDestination?: string;
  defaultStartDate?: string;
  googleMapsApiKey: string;
  planRouteAction: (
    formData: FormData,
  ) => Promise<{ error?: string; segmentCount?: number }>;
  deleteTripAction: () => Promise<{ error?: string }>;
}) {
  const { planRouteAction, deleteTripAction } = props;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();
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

  function handleDelete() {
    if (!confirm("Delete this trip? This cannot be undone.")) return;
    startDeleteTransition(async () => {
      const result = await deleteTripAction();
      if (result.error) {
        setError(result.error);
      } else {
        router.push("/trips");
      }
    });
  }

  return (
    <div className="flex h-full flex-col items-center justify-center bg-[#0D1117] p-8">
      <div className="w-full max-w-md space-y-6 rounded-[4px] border border-[#21262D] bg-[#161B22] p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
              Route Planner
            </p>
            <h2 className="text-lg font-bold text-[#C9D1D9]">
              Plan your route
            </h2>
            <p className="text-xs text-[#8B949E]">
              Enter origin and destination. Segments auto-split by driving hours
              and sunset times.
            </p>
          </div>
          <Link
            href="/trips"
            className="text-[#484F58] transition-colors hover:text-[#8B949E]"
            title="Back to trips"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </Link>
        </div>

        <form action={handleSubmit} className="space-y-4">
          <PlacesAutocompleteInput
            name="originName"
            label="Origin"
            defaultValue={props.defaultOrigin}
            placeholder="Seattle, WA"
            required
            apiKey={props.googleMapsApiKey}
          />

          <PlacesAutocompleteInput
            name="destName"
            label="Destination"
            defaultValue={props.defaultDestination}
            placeholder="Des Moines, IA"
            required
            apiKey={props.googleMapsApiKey}
          />

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
              defaultValue={props.defaultStartDate ?? "2026-06-05"}
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

        <button
          type="button"
          onClick={handleDelete}
          disabled={isDeleting}
          className="h-9 w-full rounded-[2px] border border-[#F85149]/30 text-sm font-semibold text-[#F85149] transition-colors hover:bg-[#F85149]/10 disabled:opacity-50"
        >
          {isDeleting ? "Deleting..." : "Delete Trip"}
        </button>
      </div>
    </div>
  );
}
