"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { StatusPill } from "~/app/trips/_components/command-panel";

interface FuelLogEntry {
  id: string;
  stationName: string | null;
  gallons: string;
  pricePerGallon: string;
  totalCents: number;
  odometerMiles: string | null;
  isCostco: boolean;
  loggedAt: Date;
  actualMpg: number | null;
  // Set when the fill-up was also recorded as an equal-split group expense.
  expenseId?: string | null;
}

interface FuelStats {
  totalFuelCents: number;
  totalGallons: number;
  avgPricePerGallon: number;
  avgMpg: number | null;
  costPerMile: number | null;
  fillCount: number;
}

interface FuelLogPanelProps {
  logs: FuelLogEntry[];
  stats: FuelStats;
}

export function FuelLogPanel({ logs, stats }: FuelLogPanelProps) {
  const params = useParams<{ tripId?: string }>();
  const tripId = params?.tripId;

  return (
    <div className="flex flex-col gap-4">
      {/* Stats summary */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label="Total fuel"
          value={`$${(stats.totalFuelCents / 100).toFixed(2)}`}
        />
        <StatCard label="Avg MPG" value={stats.avgMpg?.toFixed(1) ?? "—"} />
        <StatCard
          label="Cost/mi"
          value={stats.costPerMile ? `$${stats.costPerMile.toFixed(2)}` : "—"}
        />
      </div>

      {/* Recent fills */}
      <div className="space-y-1">
        <h4 className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
          Recent fills ({stats.fillCount})
        </h4>
        {logs.slice(0, 5).map((log) => (
          <div
            key={log.id}
            className="flex items-center justify-between rounded-[2px] border border-[#21262D] bg-[#0D1117] px-3 py-2"
          >
            <div>
              <p className="flex flex-wrap items-center gap-1.5 text-sm text-[#C9D1D9]">
                {log.stationName ?? "Unknown station"}
                {log.isCostco && (
                  <span className="rounded-[2px] bg-[#58A6FF]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#58A6FF]">
                    COSTCO
                  </span>
                )}
                {log.expenseId &&
                  (tripId ? (
                    <Link
                      href={`/trips/${tripId}/expenses/${log.expenseId}`}
                      className="transition-opacity hover:opacity-80"
                      title="View linked group expense"
                    >
                      <StatusPill tone="success">SPLIT</StatusPill>
                    </Link>
                  ) : (
                    <StatusPill tone="success">SPLIT</StatusPill>
                  ))}
              </p>
              <p className="font-mono text-xs text-[#8B949E]">
                {Number(log.gallons).toFixed(1)} gal @ $
                {Number(log.pricePerGallon).toFixed(3)}
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono text-sm font-semibold text-[#C9D1D9]">
                ${(log.totalCents / 100).toFixed(2)}
              </p>
              {log.actualMpg && (
                <p className="font-mono text-xs text-[#3FB950]">
                  {log.actualMpg} MPG
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[4px] border border-[#21262D] bg-[#0D1117] px-3 py-2">
      <p className="text-[9px] uppercase tracking-wider text-[#8B949E]">
        {label}
      </p>
      <p className="font-mono text-lg font-bold text-[#C9D1D9]">{value}</p>
    </div>
  );
}
