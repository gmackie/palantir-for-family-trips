import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/gmacko_test";

const { buildFuelExpenseValues } = await import("../split-expense");

const loggedAt = new Date("2026-06-08T15:30:00.000Z");

function makeFuelLog(
  overrides: Partial<{
    tripId: string;
    totalCents: number;
    stationName: string | null;
    loggedAt: Date;
  }> = {},
) {
  return {
    tripId: "trip_1",
    totalCents: 5421,
    stationName: "Costco Gas",
    loggedAt,
    ...overrides,
  };
}

describe("buildFuelExpenseValues", () => {
  it("returns the equal-split fuel expense insert values", () => {
    const values = buildFuelExpenseValues({
      fuelLog: makeFuelLog(),
      segmentId: "seg_1",
      payerUserId: "user_1",
      currency: "USD",
    });

    expect(values).toEqual({
      tripId: "trip_1",
      segmentId: "seg_1",
      payerUserId: "user_1",
      merchant: "Costco Gas",
      category: "fuel",
      totalCents: 5421,
      currency: "USD",
      occurredAt: loggedAt,
    });
  });

  it('falls back to merchant "Fuel" when stationName is absent', () => {
    const withNull = buildFuelExpenseValues({
      fuelLog: makeFuelLog({ stationName: null }),
      segmentId: "seg_1",
      payerUserId: "user_1",
      currency: "USD",
    });
    expect(withNull.merchant).toBe("Fuel");
  });

  it("passes totalCents through unchanged (split happens at read time)", () => {
    const values = buildFuelExpenseValues({
      fuelLog: makeFuelLog({ totalCents: 9999 }),
      segmentId: "seg_1",
      payerUserId: "user_1",
      currency: "USD",
    });
    // No per-member pre-division: the whole total is the shared pool.
    expect(values.totalCents).toBe(9999);
  });

  it("uses the provided currency and segmentId", () => {
    const values = buildFuelExpenseValues({
      fuelLog: makeFuelLog(),
      segmentId: "seg_xyz",
      payerUserId: "payer_2",
      currency: "CAD",
    });
    expect(values.currency).toBe("CAD");
    expect(values.segmentId).toBe("seg_xyz");
    expect(values.payerUserId).toBe("payer_2");
    expect(values.category).toBe("fuel");
  });
});
