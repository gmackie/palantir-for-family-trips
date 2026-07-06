/**
 * Predictive van-service logic — the "service stop chosen before it becomes
 * urgent" core (Projects/Sortey.md). Pure + testable: given current resource
 * levels (from DriftPort telemetry or manual entry) and consumption rates,
 * predict when each resource needs service, then match to corridor POIs.
 *
 * No db/trpc — the `daymap` router loads levels + POIs and calls these.
 */

import { haversineMiles } from "../trips/driving-summary";

/** A resource either fills up (grey/black waste, trash) or drains (fresh/propane/fuel). */
export type Direction = "fill" | "drain";

export interface ResourceModel {
  /** e.g. "grey", "black", "fresh", "propane". */
  resource: string;
  direction: Direction;
  /** Service is needed when level crosses this % (fill: rising to; drain: falling to). */
  thresholdPct: number;
  /** Corridor POI category that services this resource. */
  serviceCategory: string;
  /** Human label for the alert. */
  label: string;
}

/** Default van model — tunable per rig later; grey fills fast on a small tank. */
export const DEFAULT_RESOURCE_MODELS: ResourceModel[] = [
  {
    resource: "grey",
    direction: "fill",
    thresholdPct: 85,
    serviceCategory: "dump_station",
    label: "Grey tank",
  },
  {
    resource: "black",
    direction: "fill",
    thresholdPct: 80,
    serviceCategory: "dump_station",
    label: "Black/waste tank",
  },
  {
    resource: "fresh",
    direction: "drain",
    thresholdPct: 15,
    serviceCategory: "water",
    label: "Fresh water",
  },
  {
    resource: "propane",
    direction: "drain",
    thresholdPct: 20,
    serviceCategory: "propane",
    label: "Propane",
  },
];

/** Default consumption rates (%/day). Small van tanks turn over fast. */
export const DEFAULT_RATES_PCT_PER_DAY: Record<string, number> = {
  grey: 30,
  black: 15,
  fresh: 30,
  propane: 10,
};

export interface ResourceLevel {
  resource: string;
  /** Current level, 0–100. */
  levelPct: number;
}

export interface ServiceNeed {
  resource: string;
  label: string;
  levelPct: number;
  /** Days until service is needed; 0 = already due. */
  daysUntil: number;
  serviceCategory: string;
  urgency: "now" | "soon" | "ok";
}

/**
 * Days until a resource crosses its service threshold. 0 if already past
 * (due now); null if the rate is non-positive (can't predict).
 */
export function daysUntilNeed(
  levelPct: number,
  ratePctPerDay: number,
  model: ResourceModel,
): number | null {
  if (!(ratePctPerDay > 0)) return null;
  const remaining =
    model.direction === "fill"
      ? model.thresholdPct - levelPct // rising to threshold
      : levelPct - model.thresholdPct; // falling to threshold
  if (remaining <= 0) return 0; // already due
  return Math.round((remaining / ratePctPerDay) * 10) / 10;
}

/** Forecast service needs from current levels + rates, most-urgent first. */
export function predictServiceNeeds(
  levels: ResourceLevel[],
  models: ResourceModel[] = DEFAULT_RESOURCE_MODELS,
  rates: Record<string, number> = DEFAULT_RATES_PCT_PER_DAY,
): ServiceNeed[] {
  const byResource = new Map(levels.map((l) => [l.resource, l.levelPct]));
  const needs: ServiceNeed[] = [];
  for (const model of models) {
    const level = byResource.get(model.resource);
    if (level == null) continue;
    const rate = rates[model.resource];
    if (rate == null) continue;
    const daysUntil = daysUntilNeed(level, rate, model);
    if (daysUntil == null) continue;
    needs.push({
      resource: model.resource,
      label: model.label,
      levelPct: level,
      daysUntil,
      serviceCategory: model.serviceCategory,
      urgency: daysUntil <= 0.5 ? "now" : daysUntil <= 2 ? "soon" : "ok",
    });
  }
  return needs.sort((a, b) => a.daysUntil - b.daysUntil);
}

export interface ServicePoi {
  id: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
}

export interface ServiceAlert extends ServiceNeed {
  /** Nearest matching service POI, or null if none in the corridor. */
  stop: {
    id: string;
    name: string;
    lat: number;
    lng: number;
    milesAway: number;
  } | null;
}

/**
 * Match each service need to the nearest corridor POI of the right category
 * from a reference point (current position). POIs are already corridor-scoped,
 * so "nearest" ≈ "on the route ahead".
 */
export function matchServiceStops(
  needs: ServiceNeed[],
  pois: ServicePoi[],
  from: { lat: number; lng: number },
): ServiceAlert[] {
  return needs.map((need) => {
    let best: ServiceAlert["stop"] = null;
    for (const poi of pois) {
      if (poi.category !== need.serviceCategory) continue;
      const milesAway = Math.round(haversineMiles(from, poi) * 10) / 10;
      if (!best || milesAway < best.milesAway) {
        best = {
          id: poi.id,
          name: poi.name,
          lat: poi.lat,
          lng: poi.lng,
          milesAway,
        };
      }
    }
    return { ...need, stop: best };
  });
}
