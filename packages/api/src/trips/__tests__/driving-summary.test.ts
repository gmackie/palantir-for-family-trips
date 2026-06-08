import { describe, expect, it } from "vitest";

import {
  type BuildDrivingSummaryInput,
  buildDrivingSummary,
  haversineMiles,
} from "../driving-summary";

const NOW = new Date("2026-06-08T17:00:00.000Z");

// LA-ish origin and a stop ~30mi east, plus a far destination, for fixtures.
const LA = { lat: 34.0522, lng: -118.2437 };
const POMONA = { lat: 34.0551, lng: -117.7499 }; // ~28mi east of LA
const VEGAS = { lat: 36.1699, lng: -115.1398 }; // far east

function baseInput(
  overrides: Partial<BuildDrivingSummaryInput> = {},
): BuildDrivingSummaryInput {
  return {
    stops: [
      { name: "Pomona", lat: POMONA.lat, lng: POMONA.lng, order: 0 },
      { name: "Las Vegas", lat: VEGAS.lat, lng: VEGAS.lng, order: 1 },
    ],
    currentPosition: LA,
    nextLegRoute: null,
    distanceToGoMiles: null,
    latestFuelLog: null,
    vanProfile: null,
    currentOdometerMiles: null,
    memberLocations: [],
    selfUserId: "self",
    now: NOW,
    ...overrides,
  };
}

describe("buildDrivingSummary — nextStop", () => {
  it("returns null when there are no stops", () => {
    const result = buildDrivingSummary(baseInput({ stops: [] }));
    expect(result.nextStop).toBeNull();
    expect(result.legProgress).toBeNull();
  });

  it("uses route-planner distance/duration when provided", () => {
    const result = buildDrivingSummary(
      baseInput({
        nextLegRoute: { distanceMiles: 31.4, durationMinutes: 42 },
      }),
    );
    expect(result.nextStop).toEqual({
      name: "Pomona",
      lat: POMONA.lat,
      lng: POMONA.lng,
      distanceMiles: 31.4,
      etaMinutes: 42,
    });
  });

  it("prefers the next stop's own stored leg route (real road distance/ETA)", () => {
    const result = buildDrivingSummary(
      baseInput({
        // No top-level route; the picked segment carries its own road route.
        nextLegRoute: null,
        stops: [
          {
            name: "Boise",
            lat: POMONA.lat,
            lng: POMONA.lng,
            order: 0,
            distanceMiles: 432,
            durationMinutes: 395,
          },
        ],
      }),
    );
    // 432mi / 395min, not the ~30mi haversine from the LA currentPosition.
    expect(result.nextStop).toEqual({
      name: "Boise",
      lat: POMONA.lat,
      lng: POMONA.lng,
      distanceMiles: 432,
      etaMinutes: 395,
    });
  });

  it("falls back to haversine + AVG_SPEED_MPH when no route is provided", () => {
    const result = buildDrivingSummary(baseInput());
    expect(result.nextStop).not.toBeNull();
    const expectedMiles =
      Math.round(haversineMiles(LA, POMONA) * 10) / 10;
    expect(result.nextStop!.distanceMiles).toBe(expectedMiles);
    // ETA ~ miles / 65 * 60. Just assert it's a positive integer that tracks distance.
    expect(result.nextStop!.etaMinutes).toBe(
      Math.round((haversineMiles(LA, POMONA) / 65) * 60),
    );
  });

  it("returns null nextStop when neither route nor current position is known", () => {
    const result = buildDrivingSummary(
      baseInput({ currentPosition: null, nextLegRoute: null }),
    );
    expect(result.nextStop).toBeNull();
  });

  it("picks the earliest future-scheduled stop over stop order", () => {
    const result = buildDrivingSummary(
      baseInput({
        nextLegRoute: { distanceMiles: 10, durationMinutes: 15 },
        stops: [
          {
            name: "Past Stop",
            lat: POMONA.lat,
            lng: POMONA.lng,
            order: 0,
            scheduledAt: new Date("2026-06-08T08:00:00.000Z"),
          },
          {
            name: "Next Scheduled",
            lat: VEGAS.lat,
            lng: VEGAS.lng,
            order: 1,
            scheduledAt: new Date("2026-06-08T19:00:00.000Z"),
          },
        ],
      }),
    );
    expect(result.nextStop!.name).toBe("Next Scheduled");
  });
});

describe("buildDrivingSummary — legProgress", () => {
  it("is null without a route (no leg length to measure against)", () => {
    const result = buildDrivingSummary(baseInput());
    expect(result.legProgress).toBeNull();
  });

  it("computes fractionDone and milesRemaining from route + distanceToGo", () => {
    const result = buildDrivingSummary(
      baseInput({
        nextLegRoute: { distanceMiles: 100, durationMinutes: 90 },
        distanceToGoMiles: 40,
      }),
    );
    expect(result.legProgress).toEqual({
      fractionDone: 0.6,
      milesRemaining: 40,
    });
  });

  it("clamps remaining distance to the leg length", () => {
    const result = buildDrivingSummary(
      baseInput({
        nextLegRoute: { distanceMiles: 50, durationMinutes: 45 },
        distanceToGoMiles: 500,
      }),
    );
    expect(result.legProgress).toEqual({
      fractionDone: 0,
      milesRemaining: 50,
    });
  });
});

describe("buildDrivingSummary — fuelRange", () => {
  it("is null when there is no fuel log", () => {
    const result = buildDrivingSummary(
      baseInput({
        latestFuelLog: null,
        vanProfile: { mpgEstimate: 18, tankGallons: 25 },
      }),
    );
    expect(result.fuelRange).toBeNull();
  });

  it("is null when the van profile is missing mpg or tank", () => {
    const result = buildDrivingSummary(
      baseInput({
        latestFuelLog: {
          odometerMiles: 1000,
          loggedAt: new Date("2026-06-08T15:00:00.000Z"),
        },
        vanProfile: { mpgEstimate: null, tankGallons: 25 },
      }),
    );
    expect(result.fuelRange).toBeNull();
  });

  it("computes estimatedRangeMiles = mpg * tank - milesSinceFillUp", () => {
    const result = buildDrivingSummary(
      baseInput({
        nextLegRoute: { distanceMiles: 100, durationMinutes: 90 },
        distanceToGoMiles: 200,
        latestFuelLog: {
          odometerMiles: 1000,
          loggedAt: new Date("2026-06-08T15:00:00.000Z"),
        },
        vanProfile: { mpgEstimate: 20, tankGallons: 25 }, // 500mi full tank
        currentOdometerMiles: 1120, // 120 miles burned
      }),
    );
    // 20 * 25 - 120 = 380
    expect(result.fuelRange!.estimatedRangeMiles).toBe(380);
    expect(result.fuelRange!.distanceToGoMiles).toBe(200);
    expect(result.fuelRange!.low).toBe(false);
  });

  it("assumes a full tank when no current odometer is known", () => {
    const result = buildDrivingSummary(
      baseInput({
        distanceToGoMiles: 100,
        latestFuelLog: {
          odometerMiles: 1000,
          loggedAt: new Date("2026-06-08T15:00:00.000Z"),
        },
        vanProfile: { mpgEstimate: 20, tankGallons: 25 },
        currentOdometerMiles: null,
      }),
    );
    expect(result.fuelRange!.estimatedRangeMiles).toBe(500);
  });

  it("flags low when range < distanceToGo", () => {
    const result = buildDrivingSummary(
      baseInput({
        distanceToGoMiles: 600,
        latestFuelLog: {
          odometerMiles: 1000,
          loggedAt: new Date("2026-06-08T15:00:00.000Z"),
        },
        vanProfile: { mpgEstimate: 20, tankGallons: 25 }, // 500mi range
        currentOdometerMiles: 1000,
      }),
    );
    expect(result.fuelRange!.estimatedRangeMiles).toBe(500);
    expect(result.fuelRange!.distanceToGoMiles).toBe(600);
    expect(result.fuelRange!.low).toBe(true);
  });

  it("clamps a depleted range to >= 0", () => {
    const result = buildDrivingSummary(
      baseInput({
        distanceToGoMiles: 50,
        latestFuelLog: {
          odometerMiles: 1000,
          loggedAt: new Date("2026-06-08T15:00:00.000Z"),
        },
        vanProfile: { mpgEstimate: 20, tankGallons: 25 }, // 500mi
        currentOdometerMiles: 2000, // burned 1000 > range
      }),
    );
    expect(result.fuelRange!.estimatedRangeMiles).toBe(0);
    expect(result.fuelRange!.low).toBe(true);
  });
});

describe("buildDrivingSummary — convoy", () => {
  it("is empty when there are no member locations", () => {
    const result = buildDrivingSummary(baseInput({ memberLocations: [] }));
    expect(result.convoy).toEqual([]);
  });

  it("excludes the requester and computes lastSeenSecondsAgo", () => {
    const result = buildDrivingSummary(
      baseInput({
        nextLegRoute: { distanceMiles: 30, durationMinutes: 30 },
        memberLocations: [
          {
            userId: "self",
            name: "Me",
            lat: LA.lat,
            lng: LA.lng,
            updatedAt: NOW,
          },
          {
            userId: "bob",
            name: "Bob",
            lat: POMONA.lat,
            lng: POMONA.lng,
            updatedAt: new Date(NOW.getTime() - 90_000), // 90s ago
          },
        ],
      }),
    );
    expect(result.convoy).toHaveLength(1);
    expect(result.convoy[0]!.userId).toBe("bob");
    expect(result.convoy[0]!.lastSeenSecondsAgo).toBe(90);
  });

  it("marks a member closer to the next stop as ahead, farther as behind", () => {
    const result = buildDrivingSummary(
      baseInput({
        currentPosition: LA,
        memberLocations: [
          {
            // Bob is essentially at the next stop → ahead of the requester.
            userId: "bob",
            name: "Bob",
            lat: POMONA.lat,
            lng: POMONA.lng,
            updatedAt: NOW,
          },
          {
            // Carol is behind LA (farther from Pomona) → behind.
            userId: "carol",
            name: "Carol",
            lat: 34.0522,
            lng: -118.6, // farther west than LA
            updatedAt: NOW,
          },
        ],
      }),
    );
    const bob = result.convoy.find((m) => m.userId === "bob")!;
    const carol = result.convoy.find((m) => m.userId === "carol")!;
    expect(bob.aheadOrBehind).toBe("ahead");
    expect(carol.aheadOrBehind).toBe("behind");
  });

  it("returns 'unknown' ahead/behind when there is no next stop", () => {
    const result = buildDrivingSummary(
      baseInput({
        stops: [],
        memberLocations: [
          {
            userId: "bob",
            name: "Bob",
            lat: POMONA.lat,
            lng: POMONA.lng,
            updatedAt: NOW,
          },
        ],
      }),
    );
    expect(result.convoy[0]!.aheadOrBehind).toBe("unknown");
  });

  it("never reports negative lastSeenSecondsAgo for a future timestamp", () => {
    const result = buildDrivingSummary(
      baseInput({
        memberLocations: [
          {
            userId: "bob",
            name: "Bob",
            lat: POMONA.lat,
            lng: POMONA.lng,
            updatedAt: new Date(NOW.getTime() + 5_000),
          },
        ],
      }),
    );
    expect(result.convoy[0]!.lastSeenSecondsAgo).toBe(0);
  });
});
