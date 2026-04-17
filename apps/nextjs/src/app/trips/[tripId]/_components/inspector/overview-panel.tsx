"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { useTRPC } from "~/trpc/react";

type Trip = {
  id: string;
  workspaceId: string;
  name: string;
  status: "planning" | "confirmed" | "active" | "completed";
  groupMode: boolean;
  claimMode: "organizer" | "tap";
  destinationName: string | null;
  startDate: string | null;
  endDate: string | null;
  tz: string;
};

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function computeTripDays(startDate: string | null, endDate: string | null): number {
  if (!startDate || !endDate) return 0;
  const start = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
}

export function OverviewPanel(props: {
  trip: Trip;
  workspaceId: string;
}) {
  const { trip, workspaceId } = props;
  const trpc = useTRPC();

  const { data: expenses } = useQuery(
    trpc.expenses.list.queryOptions({ workspaceId, tripId: trip.id }),
  );

  const { data: settlement } = useQuery(
    trpc.settlements.summary.queryOptions({ workspaceId, tripId: trip.id }),
  );

  const totalExpenses = expenses?.reduce((s, e) => s + (e.totalCents ?? 0), 0) ?? 0;
  const memberCount = settlement?.members?.length ?? 0;
  const tripDays = computeTripDays(trip.startDate, trip.endDate);
  const allSettled = settlement?.allSettled ?? false;

  return (
    <div className="space-y-4 p-4">
      <h3 className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
        Mission Overview
      </h3>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-[4px] border border-[#21262D] bg-[#161B22] p-3">
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#8B949E]">
            Total Spend
          </p>
          <p className="mt-1 font-mono text-lg font-bold text-white tabular-nums">
            {formatCents(totalExpenses)}
          </p>
        </div>
        <div className="rounded-[4px] border border-[#21262D] bg-[#161B22] p-3">
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#8B949E]">
            Members
          </p>
          <p className="mt-1 font-mono text-lg font-bold text-white tabular-nums">
            {memberCount}
          </p>
        </div>
        <div className="rounded-[4px] border border-[#21262D] bg-[#161B22] p-3">
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#8B949E]">
            Trip Days
          </p>
          <p className="mt-1 font-mono text-lg font-bold text-white tabular-nums">
            {tripDays}
          </p>
        </div>
        <div className="rounded-[4px] border border-[#21262D] bg-[#161B22] p-3">
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#8B949E]">
            Expenses
          </p>
          <p className="mt-1 font-mono text-lg font-bold text-white tabular-nums">
            {expenses?.length ?? 0}
          </p>
        </div>
      </div>

      {/* Settlement status */}
      <div className="rounded-[4px] border border-[#21262D] bg-[#161B22] p-3">
        <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#8B949E]">
          Settlement Status
        </p>
        {allSettled ? (
          <p className="mt-1 text-sm font-semibold text-[#3FB950]">
            Everyone&apos;s square
          </p>
        ) : (
          <p className="mt-1 text-sm text-[#D29922]">
            {settlement?.suggestedTransactions?.length ?? 0} payments pending
          </p>
        )}
      </div>

      {/* Trip details */}
      <div>
        <h4 className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF] mb-2">
          Trip Config
        </h4>
        <div className="space-y-1.5">
          <InfoRow label="Status" value={trip.status} />
          <InfoRow label="Group Mode" value={trip.groupMode ? "Enabled" : "Disabled"} />
          <InfoRow label="Claim Mode" value={trip.claimMode} />
          <InfoRow label="Timezone" value={trip.tz} />
          <InfoRow label="Destination" value={trip.destinationName ?? "Pending"} />
        </div>
      </div>

      {/* Quick links */}
      <div>
        <h4 className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF] mb-2">
          Quick Links
        </h4>
        <div className="space-y-1">
          {[
            { href: `/trips/${trip.id}/plan`, label: "Planning" },
            { href: `/trips/${trip.id}/itinerary`, label: "Itinerary" },
            { href: `/trips/${trip.id}/lodging`, label: "Lodging" },
            { href: `/trips/${trip.id}/settings`, label: "Settings" },
            { href: "/trips", label: "All Trips" },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="block text-xs text-[#8B949E] hover:text-[#58A6FF] transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function InfoRow(props: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-[#484F58]">{props.label}</span>
      <span className="capitalize text-[#C9D1D9]">{props.value}</span>
    </div>
  );
}
