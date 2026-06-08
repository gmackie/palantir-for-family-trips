import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { FuelExpenseValues } from "../../fuel/split-expense";
import type { FuelLogStore } from "../fuel-logs";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/gmacko_test";

const { createFuelLogWithSplit } = await import("../fuel-logs");

type FuelLogRecord = {
  id: string;
  tripId: string;
  segmentId: string | null;
  userId: string;
  vanProfileId: string | null;
  odometerMiles: string | null;
  gallons: string;
  pricePerGallon: string;
  totalCents: number;
  fuelType: string;
  stationName: string | null;
  stationLat: string | null;
  stationLng: string | null;
  isCostco: boolean;
  loggedAt: Date;
  expenseId: string | null;
  notes: string | null;
  createdAt: Date;
};

type ExpenseRecord = FuelExpenseValues & { id: string };

type SegmentRecord = { id: string; tripId: string; sortOrder: number };

// In-memory FuelLogStore mock — mirrors the chat.ts harness: object-literal
// methods reading/writing `state` arrays, no real DB.
function createMemoryFuelLogStore(seed?: {
  segments?: SegmentRecord[];
  members?: string[];
  existingExpenses?: ExpenseRecord[];
}) {
  const state = {
    fuelLogs: [] as FuelLogRecord[],
    expenses: [...(seed?.existingExpenses ?? [])] as ExpenseRecord[],
    segments: [...(seed?.segments ?? [])],
    members: [...(seed?.members ?? [])],
  };

  const store: FuelLogStore = {
    insertFuelLog: async (values) => {
      const row: FuelLogRecord = {
        id: randomUUID(),
        createdAt: new Date(),
        ...values,
      };
      state.fuelLogs.push(row);
      return row as never;
    },
    findDefaultSegmentId: async (tripId) => {
      const segs = state.segments
        .filter((s) => s.tripId === tripId)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      return segs[0]?.id ?? null;
    },
    findSegmentId: async ({ tripId, segmentId }) => {
      const seg = state.segments.find(
        (s) => s.id === segmentId && s.tripId === tripId,
      );
      return seg?.id ?? null;
    },
    listTripMemberIds: async () => [...state.members],
    findTripExpenseCurrency: async (tripId) => {
      const existing = state.expenses.find((e) => e.tripId === tripId);
      return existing?.currency ?? null;
    },
    insertExpense: async (values) => {
      const row: ExpenseRecord = { id: randomUUID(), ...values };
      state.expenses.push(row);
      return { id: row.id };
    },
    linkExpenseToFuelLog: async ({ fuelLogId, expenseId }) => {
      const idx = state.fuelLogs.findIndex((l) => l.id === fuelLogId);
      const updated = { ...state.fuelLogs[idx]!, expenseId };
      state.fuelLogs[idx] = updated;
      return updated as never;
    },
  };

  return { state, store };
}

const baseInput = {
  tripId: "trip_1",
  userId: "user_1",
  segmentId: null as string | null,
  vanProfileId: null,
  odometerMiles: null,
  gallons: "12.5",
  pricePerGallon: "3.49",
  totalCents: 4363,
  fuelType: "gas",
  stationName: "Costco",
  stationLat: null,
  stationLng: null,
  isCostco: true,
  loggedAt: new Date("2026-06-08T15:30:00.000Z"),
  expenseId: null,
  notes: null,
  splitWithGroup: false,
  currency: "USD",
};

describe("createFuelLogWithSplit", () => {
  it("creates a fuel log and a linked split expense when splitWithGroup is true", async () => {
    const segmentId = randomUUID();
    const { state, store } = createMemoryFuelLogStore({
      segments: [{ id: segmentId, tripId: "trip_1", sortOrder: 0 }],
      members: ["user_1", "user_2", "user_3"],
    });

    const result = await createFuelLogWithSplit(store, {
      ...baseInput,
      splitWithGroup: true,
    });

    expect(state.fuelLogs).toHaveLength(1);
    expect(state.expenses).toHaveLength(1);

    const expense = state.expenses[0]!;
    expect(expense.category).toBe("fuel");
    expect(expense.totalCents).toBe(4363);
    expect(expense.merchant).toBe("Costco");
    expect(expense.segmentId).toBe(segmentId);
    expect(expense.payerUserId).toBe("user_1");

    // The returned log is linked to the new expense.
    expect(result.log.expenseId).toBe(expense.id);
    expect(result.splitSkipped).toBeUndefined();
  });

  it("uses the trip's default segment (first by sort order) when none is given", async () => {
    const first = randomUUID();
    const second = randomUUID();
    const { state, store } = createMemoryFuelLogStore({
      segments: [
        { id: second, tripId: "trip_1", sortOrder: 5 },
        { id: first, tripId: "trip_1", sortOrder: 1 },
      ],
      members: ["user_1"],
    });

    await createFuelLogWithSplit(store, {
      ...baseInput,
      splitWithGroup: true,
    });

    expect(state.expenses[0]!.segmentId).toBe(first);
  });

  it("does not create an expense when splitWithGroup is false", async () => {
    const { state, store } = createMemoryFuelLogStore({
      segments: [{ id: randomUUID(), tripId: "trip_1", sortOrder: 0 }],
      members: ["user_1", "user_2"],
    });

    const result = await createFuelLogWithSplit(store, {
      ...baseInput,
      splitWithGroup: false,
    });

    expect(state.fuelLogs).toHaveLength(1);
    expect(state.expenses).toHaveLength(0);
    expect(result.log.expenseId).toBeNull();
    expect(result.splitSkipped).toBeUndefined();
  });

  it("logs successfully and skips the split when the trip has no segment", async () => {
    const { state, store } = createMemoryFuelLogStore({
      segments: [],
      members: ["user_1", "user_2"],
    });

    const result = await createFuelLogWithSplit(store, {
      ...baseInput,
      splitWithGroup: true,
    });

    // Log still created; no expense; no throw.
    expect(state.fuelLogs).toHaveLength(1);
    expect(state.expenses).toHaveLength(0);
    expect(result.log.expenseId).toBeNull();
    expect(result.splitSkipped).toBe("no_segment");
  });

  it("falls back to merchant \"Fuel\" when the station name is absent", async () => {
    const { state, store } = createMemoryFuelLogStore({
      segments: [{ id: randomUUID(), tripId: "trip_1", sortOrder: 0 }],
      members: ["user_1"],
    });

    await createFuelLogWithSplit(store, {
      ...baseInput,
      stationName: null,
      splitWithGroup: true,
    });

    expect(state.expenses[0]!.merchant).toBe("Fuel");
  });

  it("inherits the trip's existing expense currency instead of the request default", async () => {
    const segmentId = randomUUID();
    const { state, store } = createMemoryFuelLogStore({
      segments: [{ id: segmentId, tripId: "trip_1", sortOrder: 0 }],
      members: ["user_1", "user_2"],
      existingExpenses: [
        {
          id: randomUUID(),
          tripId: "trip_1",
          segmentId,
          payerUserId: "user_2",
          merchant: "Hotel",
          category: "fuel",
          totalCents: 10000,
          currency: "EUR",
          occurredAt: new Date("2026-06-07T12:00:00.000Z"),
        },
      ],
    });

    // baseInput.currency is "USD"; the trip already settles in EUR.
    await createFuelLogWithSplit(store, {
      ...baseInput,
      splitWithGroup: true,
    });

    const created = state.expenses.find((e) => e.merchant === "Costco");
    expect(created?.currency).toBe("EUR");
  });
});
