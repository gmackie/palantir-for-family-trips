interface TripStatsBarProps {
  totalMiles: number;
  completedMiles: number;
  totalFuelCents: number;
  avgMpg: number | null;
  costPerMile: number | null;
  daysRemaining: number;
  currentDay: number;
  totalDays: number;
}

export function TripStatsBar({
  totalMiles,
  completedMiles,
  totalFuelCents,
  avgMpg,
  costPerMile,
  daysRemaining,
  currentDay,
  totalDays,
}: TripStatsBarProps) {
  const progressPct =
    totalMiles > 0 ? Math.round((completedMiles / totalMiles) * 100) : 0;

  return (
    <div className="flex items-center gap-6 border-t border-[#21262D] bg-[#0D1117] px-6 py-3">
      <div className="flex items-center gap-2">
        <span className="text-[9px] uppercase tracking-wider text-[#8B949E]">
          Progress
        </span>
        <span className="font-mono text-sm font-bold text-[#C9D1D9]">
          {completedMiles.toLocaleString()} / {totalMiles.toLocaleString()} mi (
          {progressPct}%)
        </span>
        <div className="h-1.5 w-24 rounded-full bg-[#21262D]">
          <div
            className="h-full rounded-full bg-[#58A6FF] transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>
      <Stat label="Fuel" value={`$${(totalFuelCents / 100).toFixed(2)}`} />
      {costPerMile != null && (
        <Stat label="$/mi" value={`$${costPerMile.toFixed(2)}`} />
      )}
      {avgMpg != null && <Stat label="MPG" value={avgMpg.toFixed(1)} />}
      <Stat label="Day" value={`${currentDay} / ${totalDays}`} />
      <Stat label="Remaining" value={`${daysRemaining}d`} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[9px] uppercase tracking-wider text-[#8B949E]">
        {label}
      </span>
      <span className="ml-1.5 font-mono text-sm font-semibold text-[#C9D1D9]">
        {value}
      </span>
    </div>
  );
}
