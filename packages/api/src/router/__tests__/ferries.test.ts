import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { TripAccessStore } from "../../auth/guards";
import type { FerryStore } from "../ferries";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/gmacko_test";

const { resolveTripAccess } = await import("../../auth/guards");
const {
  createFerryCrossing,
  deleteFerryCrossing,
  extractFerryFromImage,
  ferryExtractInputSchema,
  listFerryCrossings,
  MAX_FERRY_IMAGE_BASE64_CHARS,
  updateFerryCrossing,
} = await import("../ferries");

type WorkspaceRole = "owner" | "admin" | "member";
type TripRole = "organizer" | "member";

type WorkspaceMembershipRecord = {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
};

type TripRecord = { id: string; workspaceId: string };
type TripMemberRecord = { tripId: string; userId: string; role: TripRole };

type FerryRow = {
  id: string;
  tripId: string;
  createdByUserId: string;
  operator: string | null;
  departureTerminal: string | null;
  arrivalTerminal: string | null;
  scheduledDepartureAt: Date | null;
  durationMinutes: number | null;
  arrivalCutoffMinutes: number;
  vehicleReservation: boolean;
  confirmationNumber: string | null;
  fareCents: number | null;
  currency: string;
  fareNote: string | null;
  afterSegmentId: string | null;
  source: "manual" | "ocr";
  sourceRaw: string | null;
  ocrProvider: string | null;
  ocrConfidence: string | null;
  expenseId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type ExpenseRow = {
  id: string;
  tripId: string;
  segmentId: string;
  payerUserId: string;
  merchant: string;
  category: string;
  currency: string;
  subtotalCents: number;
  totalCents: number;
  status: "draft" | "finalized";
};

// ── Guard access store fake (mirrors trips.test.ts) ──────────────────────────

function createAccessStore(input?: {
  workspaceMemberships?: WorkspaceMembershipRecord[];
  trips?: TripRecord[];
  tripMembers?: TripMemberRecord[];
}) {
  const state = {
    workspaceMemberships: [...(input?.workspaceMemberships ?? [])],
    trips: [...(input?.trips ?? [])],
    tripMembers: [...(input?.tripMembers ?? [])],
  };

  const store: TripAccessStore = {
    findWorkspaceAccess: async ({ userId, workspaceId }) => {
      const membership =
        state.workspaceMemberships.find(
          (entry) =>
            entry.userId === userId && entry.workspaceId === workspaceId,
        ) ?? null;
      return membership
        ? {
            workspaceId: membership.workspaceId,
            workspaceRole: membership.role,
          }
        : null;
    },
    findTripAccess: async ({ userId, workspaceId, tripId }) => {
      const trip =
        state.trips.find(
          (entry) => entry.id === tripId && entry.workspaceId === workspaceId,
        ) ?? null;
      const member =
        state.tripMembers.find(
          (entry) => entry.tripId === tripId && entry.userId === userId,
        ) ?? null;
      const workspaceMembership =
        state.workspaceMemberships.find(
          (entry) =>
            entry.userId === userId && entry.workspaceId === workspaceId,
        ) ?? null;

      if (!trip || !member || !workspaceMembership) {
        return null;
      }

      return {
        tripId: trip.id,
        tripRole: member.role,
        workspaceId,
        workspaceRole: workspaceMembership.role,
      };
    },
  };

  return { state, store };
}

// ── Ferry store fake ─────────────────────────────────────────────────────────

function createFerryStore(input?: {
  ferries?: FerryRow[];
  expenses?: ExpenseRow[];
  tripMemberUserIds?: string[];
  defaultSegmentId?: string | null;
  // Map of segmentId → tripId, used by `segmentBelongsToTrip`. When omitted, the
  // `defaultSegmentId` (if any) is treated as belonging to every trip the fake
  // is asked about so existing fare tests keep working.
  segments?: Array<{ id: string; tripId: string }>;
}) {
  const defaultSegmentId =
    input?.defaultSegmentId === undefined
      ? "seg_default"
      : input.defaultSegmentId;
  const state = {
    ferries: [...(input?.ferries ?? [])],
    expenses: [...(input?.expenses ?? [])],
    tripMemberUserIds: [...(input?.tripMemberUserIds ?? [])],
    defaultSegmentId,
    segments: [...(input?.segments ?? [])],
  };

  const store: FerryStore = {
    insertFerry: async (values) => {
      const row: FerryRow = {
        id: randomUUID(),
        tripId: values.tripId,
        createdByUserId: values.createdByUserId,
        operator: values.operator ?? null,
        departureTerminal: values.departureTerminal ?? null,
        arrivalTerminal: values.arrivalTerminal ?? null,
        scheduledDepartureAt: values.scheduledDepartureAt ?? null,
        durationMinutes: values.durationMinutes ?? null,
        arrivalCutoffMinutes: values.arrivalCutoffMinutes ?? 30,
        vehicleReservation: values.vehicleReservation ?? false,
        confirmationNumber: values.confirmationNumber ?? null,
        fareCents: values.fareCents ?? null,
        currency: values.currency ?? "USD",
        fareNote: values.fareNote ?? null,
        afterSegmentId: values.afterSegmentId ?? null,
        source: values.source ?? "manual",
        sourceRaw: null,
        ocrProvider: null,
        ocrConfidence: null,
        expenseId: null,
        createdAt: new Date("2026-06-21T12:00:00.000Z"),
        updatedAt: new Date("2026-06-21T12:00:00.000Z"),
      };
      state.ferries.push(row);
      return row;
    },
    getFerry: async ({ id, tripId }) =>
      state.ferries.find((f) => f.id === id && f.tripId === tripId) ?? null,
    updateFerry: async ({ id, tripId, patch }) => {
      const index = state.ferries.findIndex(
        (f) => f.id === id && f.tripId === tripId,
      );
      if (index === -1) return null;
      state.ferries[index] = { ...state.ferries[index]!, ...patch };
      return state.ferries[index]!;
    },
    deleteFerry: async ({ id, tripId }) => {
      const before = state.ferries.length;
      state.ferries = state.ferries.filter(
        (f) => !(f.id === id && f.tripId === tripId),
      );
      return state.ferries.length < before;
    },
    listFerries: async ({ tripId }) =>
      state.ferries.filter((f) => f.tripId === tripId),
    resolveSegmentId: async ({ afterSegmentId }) =>
      afterSegmentId ?? state.defaultSegmentId,
    segmentBelongsToTrip: async ({ tripId, segmentId }) => {
      if (state.segments.length > 0) {
        return state.segments.some(
          (s) => s.id === segmentId && s.tripId === tripId,
        );
      }
      // No explicit segment table configured: the default segment belongs to
      // whatever trip is asked, everything else is foreign.
      return segmentId === state.defaultSegmentId;
    },
    insertTransportDraft: async (values) => {
      const row: ExpenseRow = {
        id: randomUUID(),
        tripId: values.tripId,
        segmentId: values.segmentId,
        payerUserId: values.payerUserId,
        merchant: values.merchant,
        category: values.category,
        currency: values.currency,
        subtotalCents: values.amountCents,
        totalCents: values.amountCents,
        status: "draft",
      };
      state.expenses.push(row);
      return { id: row.id };
    },
    updateExpenseAmount: async ({ expenseId, amountCents, currency }) => {
      const index = state.expenses.findIndex((e) => e.id === expenseId);
      if (index === -1) return;
      state.expenses[index] = {
        ...state.expenses[index]!,
        subtotalCents: amountCents,
        totalCents: amountCents,
        currency,
      };
    },
    deleteExpense: async ({ expenseId }) => {
      state.expenses = state.expenses.filter((e) => e.id !== expenseId);
    },
  };

  return { state, store };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("ferries router — guard", () => {
  it("rejects a non-member calling listForTrip", async () => {
    const { store } = createAccessStore({
      workspaceMemberships: [
        { workspaceId: "ws_1", userId: "user_1", role: "owner" },
      ],
      trips: [{ id: "trip_1", workspaceId: "ws_1" }],
      // user_1 is a workspace member but NOT a trip member
    });

    await expect(
      resolveTripAccess(store, {
        userId: "user_1",
        workspaceId: "ws_1",
        tripId: "trip_1",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("ferries router — CRUD", () => {
  it("create returns a trip-scoped row with manual source and the caller as creator", async () => {
    const { state, store } = createFerryStore();

    const created = await createFerryCrossing(store, {
      tripId: "trip_1",
      createdByUserId: "user_1",
      operator: "Washington State Ferries",
      departureTerminal: "Edmonds",
      arrivalTerminal: "Kingston",
      currency: "USD",
    });

    expect(created.tripId).toBe("trip_1");
    expect(created.createdByUserId).toBe("user_1");
    expect(created.source).toBe("manual");
    expect(created.arrivalTerminal).toBe("Kingston");
    expect(created.expenseId).toBeNull();
    expect(state.ferries).toHaveLength(1);
  });

  it("listForTrip returns only ferries for the requested trip", async () => {
    const { store } = createFerryStore({
      ferries: [
        makeFerryRow({ id: "f1", tripId: "trip_1" }),
        makeFerryRow({ id: "f2", tripId: "trip_2" }),
      ],
    });

    const rows = await listFerryCrossings(store, { tripId: "trip_1" });
    expect(rows.map((r) => r.id)).toEqual(["f1"]);
  });

  it("update mutates an existing trip-scoped row", async () => {
    const { store } = createFerryStore({
      ferries: [makeFerryRow({ id: "f1", tripId: "trip_1" })],
    });

    const updated = await updateFerryCrossing(store, {
      id: "f1",
      tripId: "trip_1",
      operator: "BC Ferries",
    });

    expect(updated.operator).toBe("BC Ferries");
  });

  // C1: a partial update must touch ONLY the supplied field. Defaulted columns
  // (currency / arrivalCutoffMinutes / vehicleReservation) must survive an edit
  // of an unrelated field, and the linked fare expense must NOT be reconciled.
  it("partial update of one field leaves defaulted columns and the linked expense untouched", async () => {
    const { state, store } = createFerryStore({
      defaultSegmentId: "seg_1",
      ferries: [
        makeFerryRow({
          id: "f1",
          tripId: "trip_1",
          currency: "CAD",
          arrivalCutoffMinutes: 45,
          vehicleReservation: true,
          fareCents: 1675,
          expenseId: "exp_1",
        }),
      ],
      expenses: [
        {
          id: "exp_1",
          tripId: "trip_1",
          segmentId: "seg_1",
          payerUserId: "user_1",
          merchant: "WSF ferry",
          category: "transit",
          currency: "CAD",
          subtotalCents: 1675,
          totalCents: 1675,
          status: "draft",
        },
      ],
    });

    const updated = await updateFerryCrossing(store, {
      id: "f1",
      tripId: "trip_1",
      operator: "BC Ferries",
    });

    // Only the operator changed.
    expect(updated.operator).toBe("BC Ferries");
    // Defaulted columns are preserved, NOT reset to USD / 30 / false.
    expect(updated.currency).toBe("CAD");
    expect(updated.arrivalCutoffMinutes).toBe(45);
    expect(updated.vehicleReservation).toBe(true);
    // The linked fare expense is untouched (no force-reconcile).
    expect(state.expenses).toHaveLength(1);
    expect(state.expenses[0]!.subtotalCents).toBe(1675);
    expect(state.expenses[0]!.currency).toBe("CAD");
  });

  it("delete removes a trip-scoped row", async () => {
    const { state, store } = createFerryStore({
      ferries: [makeFerryRow({ id: "f1", tripId: "trip_1" })],
    });

    const result = await deleteFerryCrossing(store, {
      id: "f1",
      tripId: "trip_1",
    });

    expect(result.deleted).toBe(true);
    expect(state.ferries).toHaveLength(0);
  });
});

describe("ferries router — fare → draft transport expense", () => {
  it("create with fareCents > 0 spawns a draft transit expense and links it", async () => {
    const { state, store } = createFerryStore({
      tripMemberUserIds: ["user_1", "user_2"],
      defaultSegmentId: "seg_1",
    });

    const created = await createFerryCrossing(store, {
      tripId: "trip_1",
      createdByUserId: "user_1",
      operator: "WSF",
      departureTerminal: "Edmonds",
      arrivalTerminal: "Kingston",
      fareCents: 1675,
      currency: "USD",
    });

    expect(created.expenseId).not.toBeNull();
    expect(state.expenses).toHaveLength(1);
    const expense = state.expenses[0]!;
    expect(expense.id).toBe(created.expenseId);
    expect(expense.category).toBe("transit");
    expect(expense.subtotalCents).toBe(1675);
    expect(expense.totalCents).toBe(1675);
    expect(expense.currency).toBe("USD");
    expect(expense.segmentId).toBe("seg_1");
    expect(expense.status).toBe("draft");
  });

  it("create with no fare leaves expenseId null and creates no expense", async () => {
    const { state, store } = createFerryStore({
      tripMemberUserIds: ["user_1", "user_2"],
    });

    const created = await createFerryCrossing(store, {
      tripId: "trip_1",
      createdByUserId: "user_1",
      departureTerminal: "Edmonds",
      arrivalTerminal: "Kingston",
      currency: "USD",
    });

    expect(created.expenseId).toBeNull();
    expect(state.expenses).toHaveLength(0);
  });

  it("update changing the fare updates the linked expense amount + currency", async () => {
    const { state, store } = createFerryStore({
      tripMemberUserIds: ["user_1", "user_2"],
      defaultSegmentId: "seg_1",
    });

    const created = await createFerryCrossing(store, {
      tripId: "trip_1",
      createdByUserId: "user_1",
      departureTerminal: "Edmonds",
      arrivalTerminal: "Kingston",
      fareCents: 1675,
      currency: "USD",
    });

    await updateFerryCrossing(store, {
      id: created.id,
      tripId: "trip_1",
      fareCents: 2000,
      currency: "CAD",
    });

    expect(state.expenses).toHaveLength(1);
    expect(state.expenses[0]!.subtotalCents).toBe(2000);
    expect(state.expenses[0]!.totalCents).toBe(2000);
    expect(state.expenses[0]!.currency).toBe("CAD");
  });

  it("update adding a fare to a fare-less ferry spawns and links a new expense", async () => {
    const { state, store } = createFerryStore({
      tripMemberUserIds: ["user_1"],
      defaultSegmentId: "seg_1",
    });

    const created = await createFerryCrossing(store, {
      tripId: "trip_1",
      createdByUserId: "user_1",
      departureTerminal: "Edmonds",
      arrivalTerminal: "Kingston",
      currency: "USD",
    });
    expect(created.expenseId).toBeNull();

    const updated = await updateFerryCrossing(store, {
      id: created.id,
      tripId: "trip_1",
      fareCents: 900,
    });

    expect(updated.expenseId).not.toBeNull();
    expect(state.expenses).toHaveLength(1);
    expect(state.expenses[0]!.subtotalCents).toBe(900);
  });

  it("delete removes the linked draft expense", async () => {
    const { state, store } = createFerryStore({
      tripMemberUserIds: ["user_1"],
      defaultSegmentId: "seg_1",
    });

    const created = await createFerryCrossing(store, {
      tripId: "trip_1",
      createdByUserId: "user_1",
      departureTerminal: "Edmonds",
      arrivalTerminal: "Kingston",
      fareCents: 1200,
      currency: "USD",
    });
    expect(state.expenses).toHaveLength(1);

    await deleteFerryCrossing(store, { id: created.id, tripId: "trip_1" });

    expect(state.ferries).toHaveLength(0);
    expect(state.expenses).toHaveLength(0);
  });

  // I1: an afterSegmentId that belongs to this trip is accepted.
  it("create accepts an afterSegmentId that belongs to the trip", async () => {
    const { state, store } = createFerryStore({
      segments: [{ id: "seg_in", tripId: "trip_1" }],
    });

    const created = await createFerryCrossing(store, {
      tripId: "trip_1",
      createdByUserId: "user_1",
      departureTerminal: "Edmonds",
      arrivalTerminal: "Kingston",
      fareCents: 1675,
      currency: "USD",
      afterSegmentId: "seg_in",
    });

    expect(created.afterSegmentId).toBe("seg_in");
    expect(created.expenseId).not.toBeNull();
    expect(state.expenses[0]!.segmentId).toBe("seg_in");
  });

  // I1: an afterSegmentId from another trip is rejected (BAD_REQUEST), not
  // silently accepted — mirrors expenses.create.
  it("create rejects an afterSegmentId from a foreign trip", async () => {
    const { state, store } = createFerryStore({
      segments: [{ id: "seg_other", tripId: "trip_2" }],
    });

    await expect(
      createFerryCrossing(store, {
        tripId: "trip_1",
        createdByUserId: "user_1",
        departureTerminal: "Edmonds",
        arrivalTerminal: "Kingston",
        fareCents: 1675,
        currency: "USD",
        afterSegmentId: "seg_other",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // Nothing was written.
    expect(state.ferries).toHaveLength(0);
    expect(state.expenses).toHaveLength(0);
  });

  it("update rejects an afterSegmentId from a foreign trip", async () => {
    const { store } = createFerryStore({
      segments: [{ id: "seg_other", tripId: "trip_2" }],
      ferries: [makeFerryRow({ id: "f1", tripId: "trip_1" })],
    });

    await expect(
      updateFerryCrossing(store, {
        id: "f1",
        tripId: "trip_1",
        afterSegmentId: "seg_other",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  // I2: a positive fare with no resolvable segment must throw, not silently
  // drop the expense and leave expenseId null.
  it("create with a fare but no resolvable segment throws PRECONDITION_FAILED", async () => {
    const { state, store } = createFerryStore({
      defaultSegmentId: null,
    });

    await expect(
      createFerryCrossing(store, {
        tripId: "trip_1",
        createdByUserId: "user_1",
        departureTerminal: "Edmonds",
        arrivalTerminal: "Kingston",
        fareCents: 1675,
        currency: "USD",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    expect(state.expenses).toHaveLength(0);
  });
});

describe("ferries router — extractFromImage", () => {
  it("returns the fixture booking fields and persists nothing", async () => {
    const prev = process.env.OCR_PROVIDER;
    process.env.OCR_PROVIDER = "fixture";
    try {
      const { state } = createFerryStore();
      const imageBase64 = Buffer.from("any-ferry-ticket").toString("base64");

      const result = await extractFerryFromImage({
        imageBase64,
        mimeType: "image/png",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.booking.arrivalTerminal).toBe("Kingston");
        expect(result.booking.departureTerminal).toBe("Edmonds");
        expect(result.booking.fareCents).toBe(1675);
        expect(result.booking.currency).toBe("USD");
      }
      // No persistence happened.
      expect(state.ferries).toHaveLength(0);
      expect(state.expenses).toHaveLength(0);
    } finally {
      if (prev === undefined) {
        process.env.OCR_PROVIDER = undefined;
      } else {
        process.env.OCR_PROVIDER = prev;
      }
    }
  });

  // I3: the input schema bounds the base64 payload size.
  it("rejects an over-limit imageBase64 at the input boundary", () => {
    const tooBig = "a".repeat(MAX_FERRY_IMAGE_BASE64_CHARS + 1);
    const result = ferryExtractInputSchema.safeParse({
      workspaceId: "ws_1",
      tripId: "trip_1",
      imageBase64: tooBig,
      mimeType: "image/png",
    });
    expect(result.success).toBe(false);
  });

  it("accepts an imageBase64 at the size limit", () => {
    const atLimit = "a".repeat(MAX_FERRY_IMAGE_BASE64_CHARS);
    const result = ferryExtractInputSchema.safeParse({
      workspaceId: "ws_1",
      tripId: "trip_1",
      imageBase64: atLimit,
      mimeType: "image/png",
    });
    expect(result.success).toBe(true);
  });

  it("returns { ok: false } on a malformed base64 / extraction failure without throwing", async () => {
    const prev = process.env.OCR_PROVIDER;
    // Force a non-fixture provider with no API key so extraction fails.
    process.env.OCR_PROVIDER = "claude";
    try {
      const result = await extractFerryFromImage({
        imageBase64: Buffer.from("x").toString("base64"),
        mimeType: "image/png",
      });
      expect(result.ok).toBe(false);
    } finally {
      if (prev === undefined) {
        process.env.OCR_PROVIDER = undefined;
      } else {
        process.env.OCR_PROVIDER = prev;
      }
    }
  });
});

function makeFerryRow(overrides: Partial<FerryRow> & { id: string }): FerryRow {
  return {
    tripId: "trip_1",
    createdByUserId: "user_1",
    operator: "WSF",
    departureTerminal: "Edmonds",
    arrivalTerminal: "Kingston",
    scheduledDepartureAt: null,
    durationMinutes: null,
    arrivalCutoffMinutes: 30,
    vehicleReservation: false,
    confirmationNumber: null,
    fareCents: null,
    currency: "USD",
    fareNote: null,
    afterSegmentId: null,
    source: "manual",
    sourceRaw: null,
    ocrProvider: null,
    ocrConfidence: null,
    expenseId: null,
    createdAt: new Date("2026-06-21T12:00:00.000Z"),
    updatedAt: new Date("2026-06-21T12:00:00.000Z"),
    ...overrides,
  };
}
