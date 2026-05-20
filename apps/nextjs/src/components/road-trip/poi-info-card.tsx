"use client";

interface PoiInfoCardProps {
  poi: {
    id: string;
    name: string;
    category: string;
    source: string;
    lat: number;
    lng: number;
    data?: Record<string, unknown>;
  };
  distanceFromRoute?: number;
  onSave?: () => void;
  onNavigate?: () => void;
  onClose?: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  fuel: "Fuel Station",
  water: "Water",
  campsite: "Campsite",
  dump_station: "Dump Station",
  rest_area: "Rest Area",
  scenic: "Scenic",
  shower: "Shower/Gym",
  grocery: "Grocery",
  propane: "Propane",
  laundry: "Laundry",
};

export function PoiInfoCard({
  poi,
  distanceFromRoute,
  onSave,
  onNavigate,
  onClose,
}: PoiInfoCardProps) {
  const navigateUrl = `https://maps.apple.com/?daddr=${poi.lat},${poi.lng}`;

  return (
    <div className="w-80 rounded-[4px] border border-[#21262D] bg-[#161B22] p-4 shadow-xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <span className="inline-block rounded-[2px] bg-[#58A6FF]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#58A6FF]">
            {CATEGORY_LABELS[poi.category] ?? poi.category}
          </span>
          <h3 className="mt-1 truncate text-sm font-bold text-[#C9D1D9]">
            {poi.name}
          </h3>
          <p className="text-xs text-[#8B949E]">
            via {poi.source}
            {distanceFromRoute != null && (
              <> &middot; {distanceFromRoute.toFixed(1)} mi from route</>
            )}
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="ml-2 text-[#8B949E] hover:text-[#C9D1D9]"
          >
            ✕
          </button>
        )}
      </div>

      {/* Actions */}
      <div className="mt-4 flex gap-2">
        {onSave && (
          <button
            onClick={onSave}
            className="flex-1 rounded-[2px] border border-[#58A6FF] bg-[#58A6FF]/10 px-3 py-2 text-xs font-semibold text-[#58A6FF] transition-colors hover:bg-[#58A6FF]/20"
          >
            Save to trip
          </button>
        )}
        <a
          href={navigateUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            e.preventDefault();
            if (onNavigate) {
              onNavigate();
            } else {
              window.open(navigateUrl, "_blank");
            }
          }}
          className="flex-1 rounded-[2px] border border-[#21262D] bg-[#0D1117] px-3 py-2 text-center text-xs font-semibold text-[#8B949E] transition-colors hover:border-[#484F58] hover:text-[#C9D1D9]"
        >
          Navigate
        </a>
      </div>
    </div>
  );
}
