/**
 * Shared co-pilot types — chat-primary planning artifacts.
 * Pure data; no DB / RN deps.
 */

export type PlanNightRole = "stage" | "play" | "transit" | "recovery";

export type PlanNightKind =
  | "camp"
  | "truck_stop"
  | "hotel"
  | "park"
  | "unknown";

export interface PlanNight {
  date: string;
  place: string;
  lat?: number;
  lng?: number;
  kind: PlanNightKind;
  role: PlanNightRole;
}

export interface PlanOptionCosts {
  totalDriveHours: number;
  maxDayDriveHours: number;
  /** 0–3 higher = better hike */
  hikeQuality: 0 | 1 | 2 | 3;
  /** 0–3 higher = more heat risk */
  heatRisk: 0 | 1 | 2 | 3;
  /** 0–3 higher = more risk to next immovable anchor */
  anchorRisk: 0 | 1 | 2 | 3;
}

export interface PlanOption {
  id: string;
  title: string;
  summary: string;
  nights: PlanNight[];
  costs: PlanOptionCosts;
  cutIfBehind: string;
  recommended?: boolean;
}

export interface CopilotPoi {
  id: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  isCostco?: boolean;
  isOvernight?: boolean;
  hasLaundry?: boolean;
  hasFuel?: boolean;
  isTruckStop?: boolean;
}

export interface CopilotLeg {
  fromKey: string;
  toKey: string;
  hours: number;
  miles?: number;
  notes?: string;
}

export interface CopilotAnchor {
  id: string;
  title: string;
  date: string;
  lat?: number;
  lng?: number;
  kind?: string;
}

export interface CopilotBrief {
  tripId?: string;
  prioritize?: Array<"hike" | "scenery" | "rest" | "mileage" | "services">;
  maxDriveHoursPerDay?: number;
  preferCostcoFuel?: boolean;
  softGoals?: string[];
  anchors?: CopilotAnchor[];
}

export interface CopilotWorld {
  pois: CopilotPoi[];
  legs: CopilotLeg[];
  brief: CopilotBrief;
}

export type CopilotMoveType =
  | "frame"
  | "ask_options"
  | "service_need"
  | "preference"
  | "question"
  | "general";

export interface CopilotSteerInput {
  message: string;
  lat?: number;
  lng?: number;
  /** YYYY-MM-DD; defaults to today UTC */
  today?: string;
  world?: CopilotWorld;
}

export interface CopilotSteerResult {
  reply: string;
  moveType: CopilotMoveType;
  options: PlanOption[];
  recommendedOptionId?: string;
  /** Plan chrome hints for the UI */
  chrome?: {
    tonightPlace?: string;
    tonightKind?: PlanNightKind;
    nextAnchorTitle?: string;
    nextAnchorDate?: string;
    facts?: string[];
  };
  sources: Array<"rules" | "tools">;
}
