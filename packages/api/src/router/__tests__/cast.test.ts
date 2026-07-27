import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/gmacko_test";

const { appRouter } = await import("../../root");
const { resetRateLimitBuckets } = await import("../../rate-limit");

beforeEach(() => {
  // cast.generate carries a per-user rate limit; tests share a user id.
  resetRateLimitBuckets();
});

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

  it("conflict racing a completing job: retries the insert once and wins", async () => {
    const { db } = createDbMock({
      selectQueue: [
        ...authSelects(),
        [{ tz: "America/Denver" }],
        DAY_WITH_SEGMENT,
        SEGMENT,
        [], // cleanup
        [], // active job vanished (completed between conflict and select)
      ],
      insertReturningQueue: [[], [{ id: "job_2" }]],
    });
    const caller = createCaller(db);
    const result = await caller.cast.generate({
      ...SCOPE,
      durationMinutes: 30,
    });
    expect(result).toMatchObject({ jobId: "job_2", deduplicated: false });
  });

  it("double conflict with no visible active job surfaces CONFLICT", async () => {
    const { db } = createDbMock({
      selectQueue: [
        ...authSelects(),
        [{ tz: "America/Denver" }],
        DAY_WITH_SEGMENT,
        SEGMENT,
        [], // cleanup
        [], // no active job visible
      ],
      insertReturningQueue: [[], []],
    });
    const caller = createCaller(db);
    await expect(
      caller.cast.generate({ ...SCOPE, durationMinutes: 30 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("a replaced failed job's checkpoints are cleared at enqueue", async () => {
    const { db, updates } = createDbMock({
      updateReturningQueue: [[{ id: "job_failed" }]], // guarded mark wins
      selectQueue: [
        ...authSelects(),
        [{ tz: "America/Denver" }],
        DAY_WITH_SEGMENT,
        SEGMENT,
        [
          {
            id: "job_failed",
            checkpointsJson: [
              {
                segmentKey: "intro",
                contentHash: "abc",
                r2Key: "cast/tmp/trip_1/abc.mp3",
                sizeBytes: 100,
                durationSeconds: 1,
              },
            ],
          },
        ],
      ],
      insertReturningQueue: [[{ id: "job_9" }]],
    });
    const caller = createCaller(db);
    await caller.cast.generate({ ...SCOPE, durationMinutes: 30 });
    // The failed job's checkpoint list is emptied (R2 delete is best-effort
    // and skipped in tests where no bucket is bound).
    // Checkpoints wiped AND the job marked superseded, so a later Retry
    // refuses instead of silently re-billing every segment.
    expect(updates[0]).toEqual({
      checkpointsJson: [],
      error: "Superseded by a newer generation for this day.",
    });
  });

  it("rejects a target date that already passed in the trip's tz", async () => {
    const { db, inserts } = createDbMock({
      selectQueue: [...authSelects(), [{ tz: "America/Denver" }]],
    });
    const caller = createCaller(db);
    await expect(
      caller.cast.generate({
        ...SCOPE,
        durationMinutes: 30,
        targetDate: "2020-01-01",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(inserts).toHaveLength(0);
  });

  it("rejects a calendar-invalid target date at the input layer", async () => {
    const { db } = createDbMock({ selectQueue: [...authSelects()] });
    const caller = createCaller(db);
    await expect(
      caller.cast.generate({
        ...SCOPE,
        durationMinutes: 30,
        targetDate: "2026-02-31",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
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
  const failedJob = (overrides: Record<string, unknown> = {}) => ({
    id: "job_1",
    status: "failed",
    scriptJson: { segments: [] },
    targetDate: "2026-07-28",
    error: "ElevenLabs 429",
    ...overrides,
  });

  it("a failed job with a script resumes synthesis (never restarts)", async () => {
    const { db, updates } = createDbMock({
      selectQueue: [
        ...authSelects(),
        [failedJob()],
        [], // no active sibling job for the same date
      ],
      updateReturningQueue: [[{ id: "job_1" }]], // guarded revive wins
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
      selectQueue: [...authSelects(), [failedJob({ scriptJson: null })], []],
      updateReturningQueue: [[{ id: "job_1" }]],
    });
    const caller = createCaller(db);
    const result = await caller.cast.retry({ ...SCOPE, jobId: "job_1" });
    expect(result.status).toBe("pending");
  });

  it("a revive that loses the race to a supersede refuses with CONFLICT", async () => {
    const { db } = createDbMock({
      selectQueue: [...authSelects(), [failedJob()], []],
      updateReturningQueue: [[]], // guarded update matched no row
    });
    const caller = createCaller(db);
    await expect(
      caller.cast.retry({ ...SCOPE, jobId: "job_1" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("only failed jobs can be retried", async () => {
    const { db } = createDbMock({
      selectQueue: [
        ...authSelects(),
        [failedJob({ status: "synthesizing", scriptJson: null })],
      ],
    });
    const caller = createCaller(db);
    await expect(
      caller.cast.retry({ ...SCOPE, jobId: "job_1" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("an expired-unread script refuses retry — TTS spend must not bypass the read gate", async () => {
    const { db, updates } = createDbMock({
      selectQueue: [
        ...authSelects(),
        [
          failedJob({
            error: "Script expired unread — its drive day has passed.",
          }),
        ],
      ],
    });
    const caller = createCaller(db);
    await expect(
      caller.cast.retry({ ...SCOPE, jobId: "job_1" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(updates).toHaveLength(0);
  });

  it("a superseded job refuses retry — its paid audio is gone", async () => {
    const { db } = createDbMock({
      selectQueue: [
        ...authSelects(),
        [
          failedJob({
            error: "Superseded by a newer generation for this day.",
          }),
        ],
      ],
    });
    const caller = createCaller(db);
    await expect(
      caller.cast.retry({ ...SCOPE, jobId: "job_1" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("refuses while another job holds the active slot (no raw unique-violation 500)", async () => {
    const { db, updates } = createDbMock({
      selectQueue: [
        ...authSelects(),
        [failedJob()],
        [{ id: "job_2" }], // active sibling for the same date
      ],
    });
    const caller = createCaller(db);
    await expect(
      caller.cast.retry({ ...SCOPE, jobId: "job_1" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(updates).toHaveLength(0);
  });
});

describe("cast.status", () => {
  it("returns jobs and episodes newest first for polling", async () => {
    const job = {
      id: "job_1",
      targetDate: "2026-07-28",
      durationMinutes: 30,
      status: "synthesizing",
      error: null,
      attemptCount: 1,
      llmInputTokens: 100,
      llmOutputTokens: 500,
      ttsCharacters: 2000,
      createdAt: new Date(),
      updatedAt: null,
    };
    const episode = {
      id: "ep_1",
      jobId: "job_0",
      targetDate: "2026-07-27",
      durationMinutes: 15,
      title: "Yesterday's Drive",
      sizeBytes: 1000,
      durationSeconds: "900",
      segmentsJson: [],
      createdAt: new Date(),
    };
    const { db } = createDbMock({
      selectQueue: [...authSelects(), [job], [episode]],
    });
    const caller = createCaller(db);
    const result = await caller.cast.status(SCOPE);
    expect(result.jobs).toEqual([job]);
    expect(result.episodes).toEqual([episode]);
  });
});

describe("cast.script", () => {
  it("returns the parked script for the read gate", async () => {
    const job = {
      id: "job_1",
      status: "awaiting_approval",
      scriptJson: { episodeTitle: "T", segments: [] },
      targetDate: "2026-07-28",
      durationMinutes: 30,
    };
    const { db } = createDbMock({ selectQueue: [...authSelects(), [job]] });
    const caller = createCaller(db);
    await expect(
      caller.cast.script({ ...SCOPE, jobId: "job_1" }),
    ).resolves.toEqual(job);
  });

  it("NOT_FOUND for a job outside this trip", async () => {
    const { db } = createDbMock({ selectQueue: [...authSelects(), []] });
    const caller = createCaller(db);
    await expect(
      caller.cast.script({ ...SCOPE, jobId: "job_x" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
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
