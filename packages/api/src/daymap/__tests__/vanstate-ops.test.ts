import { describe, expect, it } from "vitest";

import { resolveVanState } from "../vanstate-ops";

interface Row {
  resource: string;
  levelPct: string;
  recordedAt: Date;
  source: string;
  note: string | null;
}

/** Minimal fake of the drizzle select chain used by resolveVanState. */
function fakeDb(rows: Row[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(rows),
  };
  return { select: () => chain };
}

function at(daysAgo: number, now: Date): Date {
  return new Date(now.getTime() - daysAgo * 86_400_000);
}

describe("resolveVanState", () => {
  const now = new Date("2026-07-06T12:00:00Z");

  it("returns null when there are no readings", async () => {
    expect(await resolveVanState(fakeDb([]), "trip-1", now)).toBeNull();
  });

  it("uses the newest reading per resource as the current level", async () => {
    // rows newest-first (as the query orders them)
    const rows: Row[] = [
      { resource: "grey", levelPct: "70", recordedAt: at(0, now), source: "manual", note: null },
      { resource: "grey", levelPct: "40", recordedAt: at(1, now), source: "manual", note: null },
      { resource: "fresh", levelPct: "55", recordedAt: at(0, now), source: "manual", note: null },
    ];
    const state = await resolveVanState(fakeDb(rows), "trip-1", now);
    expect(state?.levels).toEqual({ grey: 70, fresh: 55 });
    expect(state?.updatedAt.grey).toBe(at(0, now).toISOString());
  });

  it("learns a drain rate from history, overriding the default", async () => {
    // fresh dropped 90 → 60 over 2 days = 15%/day (default is 30)
    const rows: Row[] = [
      { resource: "fresh", levelPct: "60", recordedAt: at(0, now), source: "manual", note: null },
      { resource: "fresh", levelPct: "75", recordedAt: at(1, now), source: "manual", note: null },
      { resource: "fresh", levelPct: "90", recordedAt: at(2, now), source: "manual", note: null },
    ];
    const state = await resolveVanState(fakeDb(rows), "trip-1", now);
    expect(state?.rates.fresh).toBeCloseTo(15, 1);
  });

  it("drops stale readings outside the freshness window", async () => {
    const rows: Row[] = [
      { resource: "grey", levelPct: "80", recordedAt: at(30, now), source: "manual", note: null },
    ];
    // Only a 30-day-old reading → nothing fresh → null
    expect(await resolveVanState(fakeDb(rows), "trip-1", now)).toBeNull();
  });
});
