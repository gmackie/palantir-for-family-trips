/**
 * Dogfood seed world: Bay → Tracy → Yosemite → Zion → Bryce → GJ → Denver → Omaha → Lake Forest
 */
import type { CopilotLeg, CopilotPoi, CopilotWorld } from "./types";

export const SEED_NODES: Record<string, { label: string; lat: number; lng: number }> =
  {
    "node:bay_area": { label: "Bay Area", lat: 37.55, lng: -122.3 },
    "node:tracy": { label: "Tracy", lat: 37.74, lng: -121.43 },
    "node:groveland": { label: "Groveland", lat: 37.84, lng: -120.23 },
    "node:yosemite_valley": {
      label: "Yosemite Valley",
      lat: 37.746,
      lng: -119.594,
    },
    "node:zion": { label: "Zion", lat: 37.298, lng: -113.026 },
    "node:bryce": { label: "Bryce Canyon", lat: 37.628, lng: -112.168 },
    "node:grand_junction": {
      label: "Grand Junction",
      lat: 39.064,
      lng: -108.551,
    },
    "node:denver": { label: "Denver", lat: 39.739, lng: -104.99 },
    "node:omaha": { label: "Omaha", lat: 41.257, lng: -95.995 },
    "node:lake_forest": { label: "Lake Forest", lat: 42.259, lng: -87.841 },
  };

export const SEED_LEGS: CopilotLeg[] = [
  { fromKey: "node:bay_area", toKey: "node:tracy", hours: 1.2, miles: 60 },
  { fromKey: "node:tracy", toKey: "node:groveland", hours: 1.8, miles: 90 },
  {
    fromKey: "node:groveland",
    toKey: "node:yosemite_valley",
    hours: 1.3,
    miles: 50,
  },
  {
    fromKey: "node:bay_area",
    toKey: "node:yosemite_valley",
    hours: 4.0,
    miles: 180,
  },
  {
    fromKey: "node:yosemite_valley",
    toKey: "node:zion",
    hours: 9.5,
    miles: 580,
  },
  { fromKey: "node:zion", toKey: "node:bryce", hours: 1.8, miles: 85 },
  {
    fromKey: "node:bryce",
    toKey: "node:grand_junction",
    hours: 4.5,
    miles: 280,
  },
  {
    fromKey: "node:grand_junction",
    toKey: "node:denver",
    hours: 4.2,
    miles: 245,
  },
  {
    fromKey: "node:bryce",
    toKey: "node:denver",
    hours: 9.3,
    miles: 560,
    notes: "Full day; no long hike after",
  },
  { fromKey: "node:denver", toKey: "node:omaha", hours: 8.5, miles: 540 },
  {
    fromKey: "node:omaha",
    toKey: "node:lake_forest",
    hours: 7.5,
    miles: 460,
  },
];

export const SEED_POIS: CopilotPoi[] = [
  {
    id: "costco:livermore",
    name: "Costco Livermore",
    category: "fuel",
    lat: 37.7,
    lng: -121.82,
    isCostco: true,
    hasFuel: true,
  },
  {
    id: "costco:tracy",
    name: "Costco Tracy",
    category: "fuel",
    lat: 37.76,
    lng: -121.46,
    isCostco: true,
    hasFuel: true,
  },
  {
    id: "costco:manteca",
    name: "Costco Manteca",
    category: "fuel",
    lat: 37.8,
    lng: -121.25,
    isCostco: true,
    hasFuel: true,
  },
  {
    id: "seed:tracy_ta",
    name: "TA / truck stop Tracy area",
    category: "truck_stop",
    lat: 37.74,
    lng: -121.42,
    isTruckStop: true,
    isOvernight: true,
    hasLaundry: true,
    hasFuel: true,
  },
  {
    id: "seed:groveland_stage",
    name: "Groveland / Buck Meadows stage",
    category: "campsite",
    lat: 37.84,
    lng: -120.23,
    isOvernight: true,
  },
];

export function defaultSeedWorld(tripId?: string): CopilotWorld {
  return {
    pois: SEED_POIS,
    legs: SEED_LEGS,
    brief: {
      tripId,
      prioritize: ["hike", "services"],
      maxDriveHoursPerDay: 10,
      preferCostcoFuel: true,
      softGoals: ["Zion for hiking", "see Bryce rim", "Denver by the 26th"],
      anchors: [
        {
          id: "anchor:denver",
          title: "Denver",
          date: "2026-07-26",
          lat: 39.739,
          lng: -104.99,
          kind: "must_see",
        },
        {
          id: "anchor:lake_forest",
          title: "Lake Forest",
          date: "2026-07-28",
          lat: 42.259,
          lng: -87.841,
          kind: "must_see",
        },
        {
          id: "anchor:home",
          title: "Home",
          date: "2026-08-01",
          kind: "home",
        },
      ],
    },
  };
}

export function legHours(
  world: CopilotWorld,
  fromKey: string,
  toKey: string,
): number | null {
  const hit = world.legs.find(
    (l) => l.fromKey === fromKey && l.toKey === toKey,
  );
  return hit?.hours ?? null;
}
