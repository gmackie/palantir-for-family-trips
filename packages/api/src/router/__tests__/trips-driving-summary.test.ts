import { describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/gmacko_test";

const { appRouter } = await import("../../root");

const SESSION_USER = {
  id: "user_1",
  name: "Taylor",
  email: "taylor@example.com",
  emailVerified: true,
  image: null,
  role: "user" as const,
  createdAt: new Date("2026-06-08T00:00:00.000Z"),
  updatedAt: new Date("2026-06-08T00:00:00.000Z"),
};

const WORKSPACE_ID = "workspace_1";
const TRIP_ID = "trip_1";

// ── db mock ─────────────────────────────────────────────────────────────────
// Minimal Drizzle-shaped db mock (same idea as location.test.ts). The
// `tripProcedure` auth chain consumes five queued selects (platform role for
// rlsSessionMiddleware, workspace membership, trip-access workspace membership,
// trip, trip member); `drivingSummary` then issues four reads of its own:
//   1. tripSegments  → select().from().where().orderBy()          (stops)
//   2. memberLocations ⨝ tripMembers → select().from().innerJoin().where()
//   3. fuelLogs      → select().from().where().orderBy().limit(1)
//   4. vanProfiles   → select().from().where().limit(2)
// The queries terminate at different builder methods, so the chain is a
// thenable that resolves to the queued rows wherever it gets awaited.

type Chain = {
  from: () => Chain;
  where: () => Chain;
  innerJoin: () => Chain;
  orderBy: () => Chain;
  limit: () => Chain;
} & PromiseLike<unknown[]>;

interface DrivingSummaryScenario {
  /** tripSegments rows (stops), already in sortOrder. */
  stopRows: unknown[];
  /** memberLocations ⨝ tripMembers rows (live, sharing-enabled positions). */
  locationRows: unknown[];
  /** Latest fuelLogs row (0 or 1 rows). */
  fuelRows: unknown[];
  /** vanProfiles rows returned by the single limit(2) lookup. */
  vanRows: unknown[];
}

function createDbMock(scenario: DrivingSummaryScenario) {
  const selectQueue: unknown[][] = [
    // rlsSessionMiddleware → user (platform role)
    [{ role: "user" }],
    // findWorkspaceAccess → workspaceMembership
    [{ workspaceId: WORKSPACE_ID, workspaceRole: "owner" }],
    // findTripAccess → workspaceMembership
    [{ workspaceId: WORKSPACE_ID, workspaceRole: "owner" }],
    // findTripAccess → trips
    [{ tripId: TRIP_ID }],
    // findTripAccess → tripMembers
    [{ tripRole: "organizer" }],
    // drivingSummary reads, in procedure order.
    scenario.stopRows,
    scenario.locationRows,
    scenario.fuelRows,
    scenario.vanRows,
  ];

  const db = {
    select: vi.fn((): Chain => {
      const rows = selectQueue.shift() ?? [];
      const chain = {
        from: () => chain,
        where: () => chain,
        innerJoin: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        then: (
          onFulfilled?: ((value: unknown[]) => unknown) | null,
          onRejected?: ((reason: unknown) => unknown) | null,
        ) => Promise.resolve(rows).then(onFulfilled, onRejected),
      } as Chain;
      return chain;
    }),
    // rlsSessionMiddleware wraps every authed call in a transaction and sets
    // session GUCs via execute; pass the same mock through as the tx.
    execute: vi.fn(async () => undefined),
    transaction: vi.fn(
      async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn(db),
    ),
  };

  return db;
}

function createCaller(scenario: DrivingSummaryScenario) {
  return appRouter.createCaller({
    db: createDbMock(scenario) as never,
    session: {
      user: SESSION_USER,
      session: null,
    },
    apiKeyAuth: null,
    authApi: {
      getSession: vi.fn(async () => ({
        user: SESSION_USER,
        session: null,
      })),
    },
    realtime: null,
  } as never);
}

// ── fixtures ─────────────────────────────────────────────────────────────────

// One future-dated stop with a persisted leg route so nextStop/legProgress use
// the stored real-road distance (120.5 mi / 110 min) instead of haversine, plus
// one coordinate-less row the procedure must filter out.
const STOP_ROWS = [
  {
    name: "Ogallala",
    lat: "41",
    lng: "-100",
    sortOrder: 0,
    startDate: "2099-01-01",
    distanceMiles: "120.5",
    durationMinutes: 110,
  },
  {
    name: "No Coordinates Yet",
    lat: null,
    lng: null,
    sortOrder: 1,
    startDate: null,
    distanceMiles: null,
    durationMinutes: null,
  },
];

// Requester at (40, -100); Riley is closer to the (41, -100) stop → "ahead",
// Jordan is farther → "behind".
function locationRows(now: Date) {
  return [
    {
      userId: SESSION_USER.id,
      lat: "40",
      lng: "-100",
      updatedAt: now,
      displayName: "Taylor",
    },
    {
      userId: "user_2",
      lat: "40.5",
      lng: "-100",
      updatedAt: now,
      displayName: "Riley",
    },
    {
      userId: "user_3",
      lat: "39",
      lng: "-100",
      updatedAt: now,
      displayName: null,
    },
  ];
}

function fuelRow(vanProfileId: string | null) {
  return {
    odometerMiles: "50321.5",
    loggedAt: new Date("2026-07-01T09:00:00.000Z"),
    vanProfileId,
  };
}

const INPUT = { workspaceId: WORKSPACE_ID, tripId: TRIP_ID };

// ── tests ────────────────────────────────────────────────────────────────────

describe("trips.drivingSummary van-profile resolution", () => {
  it("uses the fuel log's linked van profile for fuel-range math", async () => {
    const caller = createCaller({
      stopRows: STOP_ROWS,
      locationRows: locationRows(new Date()),
      fuelRows: [fuelRow("van_1")],
      vanRows: [{ id: "van_1", mpgEstimate: "15", tankGallons: "24.5" }],
    });

    const summary = await caller.trips.drivingSummary(INPUT);

    // No live odometer → last fill treated as a full tank: 15 × 24.5 = 367.5.
    // Distance to cover defaults to the next-stop leg distance.
    expect(summary.fuelRange).toEqual({
      estimatedRangeMiles: 367.5,
      distanceToGoMiles: 120.5,
      low: false,
    });
  });

  it("falls back to the sole workspace van when the fuel log has no linked van", async () => {
    const caller = createCaller({
      stopRows: STOP_ROWS,
      locationRows: locationRows(new Date()),
      fuelRows: [fuelRow(null)],
      vanRows: [{ id: "van_9", mpgEstimate: "10", tankGallons: "30" }],
    });

    const summary = await caller.trips.drivingSummary(INPUT);

    expect(summary.fuelRange).toEqual({
      estimatedRangeMiles: 300,
      distanceToGoMiles: 120.5,
      low: false,
    });
  });

  it("stays ambiguous with 2+ workspace vans and no linked van (fuelRange null)", async () => {
    const caller = createCaller({
      stopRows: STOP_ROWS,
      locationRows: locationRows(new Date()),
      fuelRows: [fuelRow(null)],
      vanRows: [
        { id: "van_1", mpgEstimate: "15", tankGallons: "24.5" },
        { id: "van_2", mpgEstimate: "10", tankGallons: "30" },
      ],
    });

    const summary = await caller.trips.drivingSummary(INPUT);

    // vanProfile stays null → buildDrivingSummary yields no fuelRange block,
    // but the rest of the summary is unaffected.
    expect(summary.fuelRange).toBeNull();
    expect(summary.nextStop).not.toBeNull();
  });

  it("flags low fuel when the estimated range cannot cover the next leg", async () => {
    const caller = createCaller({
      stopRows: STOP_ROWS,
      locationRows: locationRows(new Date()),
      fuelRows: [fuelRow("van_1")],
      vanRows: [{ id: "van_1", mpgEstimate: "5", tankGallons: "10" }],
    });

    const summary = await caller.trips.drivingSummary(INPUT);

    expect(summary.fuelRange).toEqual({
      estimatedRangeMiles: 50,
      distanceToGoMiles: 120.5,
      low: true,
    });
  });
});

describe("trips.drivingSummary shape", () => {
  it("returns all four blocks assembled from the loaded rows", async () => {
    const now = new Date();
    const caller = createCaller({
      stopRows: STOP_ROWS,
      locationRows: locationRows(now),
      fuelRows: [fuelRow("van_1")],
      vanRows: [{ id: "van_1", mpgEstimate: "15", tankGallons: "24.5" }],
    });

    const summary = await caller.trips.drivingSummary(INPUT);

    // Next stop uses the segment's persisted leg route, not haversine.
    expect(summary.nextStop).toEqual({
      name: "Ogallala",
      lat: 41,
      lng: -100,
      distanceMiles: 120.5,
      etaMinutes: 110,
    });

    // Leg progress: remaining defaults to the full next-stop distance.
    expect(summary.legProgress).toEqual({
      fractionDone: 0,
      milesRemaining: 120.5,
    });

    // Convoy excludes the requester; ahead/behind compares distance to the
    // next stop against the requester's own distance. Null display names
    // fall back to "Member".
    expect(summary.convoy).toHaveLength(2);
    expect(summary.convoy[0]).toMatchObject({
      userId: "user_2",
      name: "Riley",
      lat: 40.5,
      lng: -100,
      aheadOrBehind: "ahead",
    });
    expect(summary.convoy[1]).toMatchObject({
      userId: "user_3",
      name: "Member",
      lat: 39,
      lng: -100,
      aheadOrBehind: "behind",
    });
    for (const member of summary.convoy) {
      expect(member.lastSeenSecondsAgo).toBeGreaterThanOrEqual(0);
      expect(member.lastSeenSecondsAgo).toBeLessThan(60);
    }
  });

  it("returns null blocks when the trip has no stops, no fuel log, and no vans", async () => {
    const caller = createCaller({
      stopRows: [],
      locationRows: [],
      fuelRows: [],
      vanRows: [],
    });

    const summary = await caller.trips.drivingSummary(INPUT);

    expect(summary).toEqual({
      nextStop: null,
      legProgress: null,
      fuelRange: null,
      convoy: [],
    });
  });
});
