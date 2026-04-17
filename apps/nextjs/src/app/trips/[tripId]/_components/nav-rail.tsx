"use client";

export type NavItem =
  | "overview"
  | "stay"
  | "meals"
  | "activities"
  | "expenses"
  | "settlement"
  | "members"
  | "polls"
  | "proposals";

type TripStatus = "planning" | "confirmed" | "active" | "completed";

const NAV_ITEMS: { id: NavItem; label: string; icon: string; planningOnly?: boolean }[] = [
  { id: "overview", label: "Overview", icon: "grid" },
  { id: "polls", label: "Polls", icon: "ballot", planningOnly: true },
  { id: "proposals", label: "Proposals", icon: "lightbulb", planningOnly: true },
  { id: "stay", label: "Stay", icon: "home" },
  { id: "meals", label: "Meals", icon: "utensils" },
  { id: "activities", label: "Activities", icon: "target" },
  { id: "expenses", label: "Expenses", icon: "dollar" },
  { id: "settlement", label: "Settlement", icon: "scale" },
  { id: "members", label: "Members", icon: "users" },
];

// Simple SVG icons to avoid external dependencies
function NavIcon({ icon, active }: { icon: string; active: boolean }) {
  const color = active ? "#58A6FF" : "#8B949E";
  const size = 18;

  switch (icon) {
    case "grid":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </svg>
      );
    case "home":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      );
    case "utensils":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2" />
          <path d="M7 2v20" />
          <path d="M21 15V2v0a5 5 0 00-5 5v6c0 1.1.9 2 2 2h3zm0 0v7" />
        </svg>
      );
    case "target":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="2" />
        </svg>
      );
    case "dollar":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="1" x2="12" y2="23" />
          <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
        </svg>
      );
    case "scale":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="3" x2="12" y2="21" />
          <polyline points="1 14 12 3 23 14" />
          <path d="M1 14a5 5 0 005 5" />
          <path d="M23 14a5 5 0 01-5 5" />
        </svg>
      );
    case "users":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 00-3-3.87" />
          <path d="M16 3.13a4 4 0 010 7.75" />
        </svg>
      );
    case "ballot":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 7h6" />
          <path d="M9 12h6" />
          <path d="M9 17h6" />
          <path d="M6 7h0" />
          <path d="M6 12h0" />
          <path d="M6 17h0" />
        </svg>
      );
    case "lightbulb":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18h6" />
          <path d="M10 22h4" />
          <path d="M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z" />
        </svg>
      );
    default:
      return null;
  }
}

export function NavRail(props: {
  activeItem: NavItem;
  onItemClick: (item: NavItem) => void;
  tripStatus?: TripStatus;
}) {
  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.planningOnly || props.tripStatus === "planning",
  );

  return (
    <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-[#21262D] bg-[#0D1117] py-3">
      {visibleItems.map((item) => {
        const isActive = props.activeItem === item.id;
        return (
          <button
            key={item.id}
            onClick={() => props.onItemClick(item.id)}
            title={item.label}
            className={`flex h-9 w-9 items-center justify-center rounded-[2px] transition-colors ${
              isActive
                ? "bg-[#58A6FF]/15"
                : "hover:bg-[#161B22]"
            }`}
          >
            <NavIcon icon={item.icon} active={isActive} />
          </button>
        );
      })}
    </nav>
  );
}
