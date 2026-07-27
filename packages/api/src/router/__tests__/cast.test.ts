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
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  updatedAt: new Date("2026-07-01T00:00:00.000Z"),
};

const WORKSPACE_ID = "workspace_1";
const TRIP_ID = "trip_1";

/** The `tripProcedure` auth chain's canned reads (rls-router-test-mocks recipe). */
function authSelects(): unknown[][] {
  return [
    [{ role: "user" }], // rlsSessionMiddleware → user platform role
    [{ workspaceId: WORKSPACE_ID, workspaceRole: "owner" }], // workspace access
    [{ workspaceId: WORKSPACE_ID, workspaceRole: "owner" }], // trip access: membership
    [{ tripId: TRIP_ID }], // trip access: trip
    [{ tripRole: "organizer" }], // trip access: trip member
  ];
}

function createDbMock(opts: {
  selectQueue: unknown[][];
  insertReturningQueue?: unknown[][];
  updateReturningQueue?: unknown[][];
}) {
  const inserts: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];

  const db = {
    select: vi.fn(() => {
      const rows = opts.selectQueue.shift() ?? [];
      // biome-ignore lint/suspicious/noExplicitAny: test chain stub
      const chain: any = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => Promise.resolve(rows),
        then: (
          resolve: (rows: unknown[]) => unknown,
          reject: (error: unknown) => unknown,
        ) => Promise.resolve(rows).then(resolve, reject),
      };
      return chain;
    }),
    insert: vi.fn(() => {
      // biome-ignore lint/suspicious/noExplicitAny: test chain stub
      const chain: any = {
        values: (values: Record<string, unknown>) => {
          inserts.push(values);
          return chain;
        },
        onConflictDoNothing: () => chain,
        returning: () =>
          Promise.resolve(opts.insertReturningQueue?.shift() ?? []),
      };
      return chain;
    }),
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        // biome-ignore lint/suspicious/noExplicitAny: test chain stub
        const chain: any = {
          where: () => chain,
          returning: () =>
            Promise.resolve(opts.updateReturningQueue?.shift() ?? []),
          then: (
            resolve: (rows: unknown[]) => unknown,
            reject: (error: unknown) => unknown,
          ) => Promise.resolve([]).then(resolve, reject),
        };
        return chain;
      },
    })),
    execute: vi.fn(async () => undefined),
    transaction: vi.fn(
      async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn(db),
    ),
  };

  return { db, inserts, updates };
}

function createCaller(db: unknown) {
  return appRouter.createCaller({
    db: db as never,
    session: { user: SESSION_USER, session: null },
    apiKeyAuth: null,
    authApi: {
      getSession: vi.fn(async () => ({ user: SESSION_USER, session: null })),
    },
    realtime: null,
  } as never);
}

const SCOPE = { workspaceId: WORKSPACE_ID, tripId: TRIP_ID };

const DAY_WITH_SEGMENT = [{ intent: "drive", segmentId: "seg_1" }];
const SEGMENT = [
  {
    id: "seg_1",
    name: "Denver → Moab",
    originName: "Denver",
    destinationName: "Moab",
    routePolyline: "abc",
    distanceMiles: "353",
    durationMinutes: 330,
  },
];

describe("cast.generate", () => {
  it("enqueues a job for a drive day", async () => {
    const { db, inserts } = createDbMock({
      selectQueue: [
        ...authSelects(),
        [{ tz: "America/Denver" }], // trip tz
        DAY_WITH_SEGMENT, // probe: trip_day
        SEGMENT, // probe: segment by id
        [], // cleanup: no failed jobs
      ],
      insertReturningQueue: [[{ id: "job_9" }]],
    });
    const caller = createCaller(db);

    const result = await caller.cast.generate({
      ...SCOPE,
      durationMinutes: 30,
    });
    expect(result).toMatchObject({ jobId: "job_9", deduplicated: false });
    expect(inserts[0]).toMatchObject({
      tripId: TRIP_ID,
      createdByUserId: SESSION_USER.id,
      durationMinutes: 30,
    });
  });

  it("double-tap dedups server-side: conflict returns the active job", async () => {
    const { db } = createDbMock({
      selectQueue: [
        ...authSelects(),
        [{ tz: "America/Denver" }],
        DAY_WITH_SEGMENT,
        SEGMENT,
        [], // cleanup
        [{ id: "job_1" }], // existing active job after conflict
      ],
      insertReturningQueue: [[]], // ON CONFLICT DO NOTHING swallowed the insert
    });
    const caller = createCaller(db);

    const result = await caller.cast.generate({
      ...SCOPE,
      durationMinutes: 15,
    });
    expect(result).toMatchObject({ jobId: "job_1", deduplicated: true });
  });

  it("rejects a no-drive-leg day server-side even though the button is hidden", async () => {
    const { db, inserts } = createDbMock({
      selectQueue: [
        ...authSelects(),
        [{ tz: "America/Denver" }],
        [{ intent: "play", segmentId: null }], // probe: play day, no link
      ],
    });
    const caller = createCaller(db);

    await expect(
      caller.cast.generate({ ...SCOPE, durationMinutes: 30 }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(inserts).toHaveLength(0);
  });

  it("rejects a non-member outright (auth chain, not the router body)", async () => {
    const { db } = createDbMock({
      selectQueue: [
        [{ role: "user" }],
        [], // no workspace membership
      ],
    });
    const caller = createCaller(db);

    await expect(
      caller.cast.generate({ ...SCOPE, durationMinutes: 30 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("cast.approveScript", () => {
  it("approves only a job awaiting approval", async () => {
    const { db } = createDbMock({
      selectQueue: [...authSelects()],
      updateReturningQueue: [[{ id: "job_1" }]],
    });
    const caller = createCaller(db);
    await expect(
      caller.cast.approveScript({ ...SCOPE, jobId: "job_1" }),
    ).resolves.toEqual({ jobId: "job_1" });
  });

  it("refuses when the job is not at the read gate", async () => {
    const { db } = createDbMock({
      selectQueue: [...authSelects()],
      updateReturningQueue: [[]], // guarded UPDATE matched no row
    });
    const caller = createCaller(db);
    await expect(
      caller.cast.approveScript({ ...SCOPE, jobId: "job_1" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("cast.retry", () => {
  it("a failed job with a script resumes synthesis (never restarts)", async () => {
    const { db, updates } = createDbMock({
      selectQueue: [
        ...authSelects(),
        [{ id: "job_1", status: "failed", scriptJson: { segments: [] } }],
      ],
    });
    const caller = createCaller(db);
    const result = await caller.cast.retry({ ...SCOPE, jobId: "job_1" });
    expect(result.status).toBe("synthesizing");
    expect(updates[0]).toMatchObject({
      status: "synthesizing",
      attemptCount: 0,
      error: null,
      claimedAt: null,
    });
  });

  it("a failed job without a script restarts from scripting", async () => {
    const { db } = createDbMock({
      selectQueue: [
        ...authSelects(),
        [{ id: "job_1", status: "failed", scriptJson: null }],
      ],
    });
    const caller = createCaller(db);
    const result = await caller.cast.retry({ ...SCOPE, jobId: "job_1" });
    expect(result.status).toBe("pending");
  });

  it("only failed jobs can be retried", async () => {
    const { db } = createDbMock({
      selectQueue: [
        ...authSelects(),
        [{ id: "job_1", status: "synthesizing", scriptJson: null }],
      ],
    });
    const caller = createCaller(db);
    await expect(
      caller.cast.retry({ ...SCOPE, jobId: "job_1" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("cast.tonight", () => {
  it("resolves tomorrow in the trip tz and probes the drive leg", async () => {
    const { db } = createDbMock({
      selectQueue: [
        ...authSelects(),
        [{ tz: "America/Denver" }],
        DAY_WITH_SEGMENT,
        SEGMENT,
      ],
    });
    const caller = createCaller(db);
    const result = await caller.cast.tonight(SCOPE);
    expect(result.tz).toBe("America/Denver");
    expect(result.hasDriveLeg).toBe(true);
    expect(result.targetDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
