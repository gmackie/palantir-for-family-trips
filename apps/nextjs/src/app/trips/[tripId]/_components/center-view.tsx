"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { useTRPC } from "~/trpc/react";

type Trip = {
  id: string;
  workspaceId: string;
  name: string;
  status: "planning" | "confirmed" | "active" | "completed";
  destinationName: string | null;
  destinationLat: string | null;
  destinationLng: string | null;
  startDate: string | null;
  endDate: string | null;
  tz: string;
};

function computeTripDays(startDate: string | null, endDate: string | null): number {
  if (!startDate || !endDate) return 0;
  const start = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function CenterView(props: {
  trip: Trip;
  workspaceId: string;
}) {
  const { trip, workspaceId } = props;
  const trpc = useTRPC();

  const { data: expenses } = useQuery(
    trpc.expenses.list.queryOptions({ workspaceId, tripId: trip.id }),
  );

  const { data: pins } = useQuery(
    trpc.pins.list.queryOptions({ workspaceId, tripId: trip.id }),
  );

  const totalExpenses = expenses?.reduce((s, e) => s + (e.totalCents ?? 0), 0) ?? 0;
  const tripDays = computeTripDays(trip.startDate, trip.endDate);
  const pinCount = pins?.length ?? 0;

  return (
    <div className="flex h-full flex-col p-4">
      {/* Map placeholder */}
      <div className="mb-4 flex flex-1 items-center justify-center rounded-[4px] border border-[#21262D] bg-[#161B22]">
        <div className="text-center">
          <h3 className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF] mb-2">
            Area Map
          </h3>
          <p className="text-sm text-[#8B949E]">
            {trip.destinationName ?? "Destination pending"}
          </p>
          <Link
            href={`/trips/${trip.id}/map`}
            className="mt-3 inline-block text-xs text-[#58A6FF] hover:underline"
          >
            Open interactive map
          </Link>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Total Spend" value={formatCents(totalExpenses)} />
        <StatCard label="Trip Days" value={String(tripDays)} />
        <StatCard label="Pins" value={String(pinCount)} />
        <StatCard label="Expenses" value={String(expenses?.length ?? 0)} />
      </div>
    </div>
  );
}

function StatCard(props: { label: string; value: string }) {
  return (
    <div className="rounded-[4px] border border-[#21262D] bg-[#161B22] p-3">
      <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#8B949E]">
        {props.label}
      </p>
      <p className="mt-1 font-mono text-xl font-bold text-white tabular-nums">
        {props.value}
      </p>
    </div>
  );
}
