"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CenterView } from "./center-view";
import { ExpensesPanel } from "./inspector/expenses-panel";
import { MembersPanel } from "./inspector/members-panel";
import { OverviewPanel } from "./inspector/overview-panel";
import { PollsPanel } from "./inspector/polls-panel";
import { ProposalsPanel } from "./inspector/proposals-panel";
import { SettlementPanel } from "./inspector/settlement-panel";
import { type NavItem, NavRail } from "./nav-rail";
import { TimelineBar } from "./timeline-bar";

type Trip = {
  id: string;
  workspaceId: string;
  name: string;
  status:
    | "planning"
    | "confirmed"
    | "active"
    | "en_route"
    | "paused"
    | "completed";
  tripMode: "destination" | "roadtrip";
  groupMode: boolean;
  claimMode: "organizer" | "tap";
  destinationName: string | null;
  destinationLat: string | null;
  destinationLng: string | null;
  defaultZoom: number;
  startDate: string | null;
  endDate: string | null;
  tz: string;
  createdAt: Date;
  updatedAt: Date | null;
};

type Segment = {
  id: string;
  tripId: string;
  name: string;
  sortOrder: number;
};

const STATUS_COLORS: Record<string, string> = {
  planning: "bg-[#D29922]/20 text-[#D29922]",
  confirmed: "bg-[#58A6FF]/20 text-[#58A6FF]",
  active: "bg-[#3FB950]/20 text-[#3FB950]",
  en_route: "bg-[#D29922]/20 text-[#D29922]",
  paused: "bg-[#8B949E]/20 text-[#8B949E]",
  completed: "bg-[#8B949E]/20 text-[#8B949E]",
};

export function TripDashboard(props: {
  trip: Trip;
  segments: Segment[];
  workspaceId: string;
  currentUserId: string;
  googleMapsApiKey?: string;
}) {
  const { trip, segments, workspaceId, currentUserId, googleMapsApiKey } =
    props;
  const [activeNav, setActiveNav] = useState<NavItem>("overview");
  const [timelineOpen, setTimelineOpen] = useState(true);
  const router = useRouter();

  function handleNavClick(item: NavItem) {
    // Chat lives at its own route rather than in the inspector rail.
    if (item === "chat") {
      router.push(`/trips/${trip.id}/chat`);
      return;
    }
    setActiveNav(item);
  }

  function renderInspector() {
    switch (activeNav) {
      case "overview":
        return <OverviewPanel trip={trip} workspaceId={workspaceId} />;
      case "expenses":
        return (
          <ExpensesPanel
            tripId={trip.id}
            workspaceId={workspaceId}
            currentUserId={currentUserId}
          />
        );
      case "settlement":
        return (
          <SettlementPanel
            tripId={trip.id}
            workspaceId={workspaceId}
            currentUserId={currentUserId}
          />
        );
      case "members":
        return (
          <MembersPanel
            tripId={trip.id}
            workspaceId={workspaceId}
            tripName={trip.name}
          />
        );
      case "stay":
        return (
          <div className="p-4">
            <h3 className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
              Lodging
            </h3>
            <p className="mt-3 text-xs text-[#484F58]">
              Lodging panel coming soon.
            </p>
          </div>
        );
      case "meals":
        return (
          <div className="p-4">
            <h3 className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
              Meals
            </h3>
            <p className="mt-3 text-xs text-[#484F58]">
              Meals panel coming soon.
            </p>
          </div>
        );
      case "activities":
        return (
          <div className="p-4">
            <h3 className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
              Activities
            </h3>
            <p className="mt-3 text-xs text-[#484F58]">
              Activities panel coming soon.
            </p>
          </div>
        );
      case "polls":
        return <PollsPanel tripId={trip.id} workspaceId={workspaceId} />;
      case "proposals":
        return <ProposalsPanel tripId={trip.id} workspaceId={workspaceId} />;
      default:
        return null;
    }
  }

  return (
    <div className="flex min-h-screen flex-col text-[#C9D1D9]">
      {/* ── Top bar ── */}
      <header className="flex items-center gap-4 border-b border-[#21262D] px-4 py-2">
        <Link
          href="/trips"
          className="text-[#484F58] hover:text-[#8B949E] transition-colors"
          title="All trips"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <span className="text-[9px] font-black uppercase tracking-[0.3em] text-[#8B949E]">
          Command Center
        </span>
        <span className="text-sm font-semibold text-white">{trip.name}</span>

        <span
          className={`rounded-[2px] px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${STATUS_COLORS[trip.status] ?? "bg-[#8B949E]/20 text-[#8B949E]"}`}
        >
          {trip.status}
        </span>

        {/* Segment pills */}
        {segments.length > 0 && (
          <div className="ml-4 flex items-center gap-1">
            {segments.map((seg) => (
              <span
                key={seg.id}
                className="rounded-[2px] bg-[#161B22] px-2 py-0.5 text-[9px] text-[#8B949E] border border-[#21262D]"
              >
                {seg.name}
              </span>
            ))}
          </div>
        )}

        <div className="ml-auto flex items-center gap-3">
          {trip.destinationName && (
            <span className="text-xs text-[#8B949E]">
              {trip.destinationName}
            </span>
          )}
          {trip.startDate && trip.endDate && (
            <span className="font-mono text-xs text-[#484F58]">
              {trip.startDate} — {trip.endDate}
            </span>
          )}
        </div>
      </header>

      {/* ── Main body: nav rail + center + inspector ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left nav rail */}
        <NavRail
          activeItem={activeNav}
          onItemClick={handleNavClick}
          tripStatus={trip.status}
        />

        {/* Center view */}
        <div className="flex-1 overflow-auto border-r border-[#21262D]">
          <CenterView
            trip={trip}
            workspaceId={workspaceId}
            googleMapsApiKey={googleMapsApiKey}
          />
        </div>

        {/* Right inspector rail */}
        <aside className="w-[360px] shrink-0 overflow-auto border-l border-[#21262D] bg-[#0D1117]">
          {renderInspector()}
        </aside>
      </div>

      {/* ── Bottom timeline bar ── */}
      <TimelineBar
        tripId={trip.id}
        workspaceId={workspaceId}
        startDate={trip.startDate}
        endDate={trip.endDate}
        isOpen={timelineOpen}
        onToggle={() => setTimelineOpen(!timelineOpen)}
      />
    </div>
  );
}
