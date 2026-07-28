import { describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/gmacko_test";

const { probeCastDriveLeg, resolveCastTargetDate } = await import("../context");

/**
 * Minimal Drizzle-shaped select mock: each `db.select()` call consumes the
 * next canned row list, regardless of the chain called on it.
 */
function fakeSelectDb(queue: unknown[][]) {
  const select = vi.fn(() => {
    const rows = queue.shift() ?? [];
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
  });
  return { db: { select }, select };
}

describe("resolveCastTargetDate", () => {
  // 2026-07-28T02:00Z = 8pm on July 27 in Denver — the night-before tap.
  const eveningTap = new Date("2026-07-28T02:00:00.000Z");

  it("resolves tomorrow in the trip's tz", () => {
    expect(resolveCastTargetDate("America/Denver", eveningTap)).toBe(
      "2026-07-28",
    );
  });

  it("a UTC-defaulted trip row visibly skews the date (the Issue 9.8 tripwire)", () => {
    // Same instant, UTC calendar already rolled to Jul 28 → target Jul 29.
    expect(resolveCastTargetDate("UTC", eveningTap)).toBe("2026-07-29");
  });

  it("rolls over month boundaries", () => {
    expect(
      resolveCastTargetDate(
        "America/Denver",
        new Date("2026-08-01T03:00:00.000Z"), // Jul 31, 9pm in Denver
      ),
    ).toBe("2026-08-01");
  });
});

describe("probeCastDriveLeg", () => {
  const input = { tripId: "trip-1", targetDate: "2026-07-28" };
  const segmentRow = {
    id: "seg-1",
    name: "Denver → Moab",
    originName: "Denver",
    destinationName: "Moab",
    routePolyline: "abc123",
    distanceMiles: "353",
    durationMinutes: 330,
  };

  it("a trip_day linking a segment IS the drive leg", async () => {
    const { db } = fakeSelectDb([
      [{ intent: "drive", segmentId: "seg-1" }],
      [segmentRow],
    ]);
    const probe = await probeCastDriveLeg(db, input);
    expect(probe).toEqual({ hasDriveLeg: true, degraded: false });
  });

  it("a non-driving day with no segment link claims NO drive leg, even when a multi-day segment spans the date", async () => {
    const { db, select } = fakeSelectDb([
      [{ intent: "play", segmentId: null }],
    ]);
    const probe = await probeCastDriveLeg(db, input);
    expect(probe).toEqual({ hasDriveLeg: false, degraded: false });
    // No segment lookup was even attempted.
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("a drive-intent day without a link falls back to date-matched segment", async () => {
    const { db } = fakeSelectDb([
      [{ intent: "drive", segmentId: null }],
      [{ ...segmentRow, routePolyline: null }],
    ]);
    const probe = await probeCastDriveLeg(db, input);
    expect(probe).toEqual({ hasDriveLeg: true, degraded: true });
  });

  it("no trip_day row: date-matched segment decides", async () => {
    const { db } = fakeSelectDb([[], [segmentRow]]);
    const probe = await probeCastDriveLeg(db, input);
    expect(probe).toEqual({ hasDriveLeg: true, degraded: false });
  });

  it("no day, no segment → no leg", async () => {
    const { db } = fakeSelectDb([[], []]);
    const probe = await probeCastDriveLeg(db, input);
    expect(probe).toEqual({ hasDriveLeg: false, degraded: false });
  });
});
