import { describe, expect, it, vi } from "vitest";

import type { RealtimeBroadcast } from "../../realtime-runtime";

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
const UPDATED_AT = new Date("2026-06-08T12:34:56.000Z");

// A recording realtime runtime. Production passes a runtime bound to the
// TripRoom Durable Object; tests record the calls so we can assert the payload.
function createRecordingRealtime() {
  const calls: Array<{ tripId: string; payload: RealtimeBroadcast }> = [];
  return {
    calls,
    runtime: {
      broadcast: (tripId: string, payload: RealtimeBroadcast) => {
        calls.push({ tripId, payload });
      },
    },
  };
}

// Minimal Drizzle-shaped db mock. The `tripProcedure` auth chain issues three
// `select().from().where().limit()` reads (workspace membership, trip, trip
// member); `updateLocation` then issues the `insert().values()
// .onConflictDoUpdate().returning()` upsert. We return canned rows for each so
// the procedure reaches its broadcast without a real Postgres.
function createDbMock() {
  // Source-of-truth rows the auth store expects, keyed by the `.from()` table.
  const selectQueue: unknown[][] = [
    // findWorkspaceAccess → workspaceMembership
    [{ workspaceId: WORKSPACE_ID, workspaceRole: "owner" }],
    // findTripAccess → workspaceMembership
    [{ workspaceId: WORKSPACE_ID, workspaceRole: "owner" }],
    // findTripAccess → trips
    [{ tripId: TRIP_ID }],
    // findTripAccess → tripMembers
    [{ tripRole: "organizer" }],
  ];

  const db = {
    select: vi.fn(() => {
      const rows = selectQueue.shift() ?? [];
      const chain = {
        from: () => chain,
        where: () => chain,
        limit: () => Promise.resolve(rows),
      };
      return chain;
    }),
    insert: vi.fn(() => {
      const chain = {
        values: () => chain,
        onConflictDoUpdate: () => chain,
        returning: () =>
          Promise.resolve([{ id: "loc_1", updatedAt: UPDATED_AT }]),
      };
      return chain;
    }),
  };

  return db;
}

function createCaller(realtime?: { broadcast: (...args: never[]) => void }) {
  return appRouter.createCaller({
    db: createDbMock() as never,
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
    realtime: realtime ?? null,
  } as never);
}

const baseInput = {
  workspaceId: WORKSPACE_ID,
  tripId: TRIP_ID,
  lat: 41.2565,
  lng: -95.9345,
  heading: 270,
  speed: 31.5,
};

describe("location.updateLocation broadcast", () => {
  it("broadcasts the location payload exactly once after the upsert", async () => {
    const { calls, runtime } = createRecordingRealtime();
    const caller = createCaller(runtime);

    const row = await caller.location.updateLocation(baseInput);

    expect(row).toEqual({ id: "loc_1", updatedAt: UPDATED_AT });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      tripId: TRIP_ID,
      payload: {
        type: "location",
        userId: SESSION_USER.id,
        lat: baseInput.lat,
        lng: baseInput.lng,
        heading: baseInput.heading,
        speed: baseInput.speed,
        updatedAt: UPDATED_AT.toISOString(),
      },
    });
  });

  it("normalizes omitted heading/speed to null in the broadcast", async () => {
    const { calls, runtime } = createRecordingRealtime();
    const caller = createCaller(runtime);

    await caller.location.updateLocation({
      workspaceId: WORKSPACE_ID,
      tripId: TRIP_ID,
      lat: 41.2565,
      lng: -95.9345,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.payload).toMatchObject({
      type: "location",
      heading: null,
      speed: null,
    });
  });

  it("does not throw when no realtime runtime is present", async () => {
    const caller = createCaller(undefined);

    await expect(caller.location.updateLocation(baseInput)).resolves.toEqual({
      id: "loc_1",
      updatedAt: UPDATED_AT,
    });
  });
});
