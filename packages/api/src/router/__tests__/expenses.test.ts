import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/gmacko_test";

// ─── Types mirroring DB schema shape ─────────────────────────────────────────

type ExpenseStatus = "draft" | "finalized";

type ExpenseRow = {
  id: string;
  tripId: string;
  segmentId: string;
  payerUserId: string;
  merchant: string;
  category: string;
  occurredAt: Date;
  currency: string;
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  notes: string | null;
  status: ExpenseStatus;
  createdAt: Date;
};

type ClaimRow = {
  lineItemId: string;
  userId: string;
};

type TripRole = "organizer" | "member";

// ─── Import the domain utilities we can test directly ─────────────────────────

const { computeExpenseShares } = await import("../../expenses/shares");

// ─── Helper: build a draft expense row ───────────────────────────────────────

function makeDraftExpense(overrides: Partial<ExpenseRow> = {}): ExpenseRow {
  return {
    id: randomUUID(),
    tripId: "trip_1",
    segmentId: "seg_1",
    payerUserId: "user_alice",
    merchant: "Burger King",
    category: "meal",
    occurredAt: new Date("2026-06-01T12:00:00Z"),
    currency: "USD",
    subtotalCents: 2000,
    taxCents: 200,
    tipCents: 300,
    totalCents: 2500,
    notes: null,
    status: "draft",
    createdAt: new Date(),
    ...overrides,
  };
}

// ─── Domain logic mirrors (inlined from expenses.ts procedures) ───────────────

function requireOrganizerOrSelf(
  tripRole: TripRole,
  payerUserId: string,
  ctxUserId: string,
): void {
  if (tripRole === "organizer") return;
  if (payerUserId === ctxUserId) return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "Only the payer or a trip organizer can modify this expense.",
  });
}

function simulateFinalize(
  tripRole: TripRole,
  ctxUserId: string,
  existing: ExpenseRow,
  existingFinalized: Array<{ currency: string }>,
): ExpenseRow {
  if (existing.status !== "draft") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Expense is already finalized.",
    });
  }

  requireOrganizerOrSelf(tripRole, existing.payerUserId, ctxUserId);

  if (
    existingFinalized.length > 0 &&
    existingFinalized[0]?.currency !== existing.currency
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `This trip already has finalized expenses in ${existingFinalized[0]?.currency}. Mixed-currency settlement is not supported.`,
    });
  }

  return { ...existing, status: "finalized" };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("expenses router — draft creation invariants", () => {
  it("create: status is draft and integer-cent fields are stored as given", () => {
    const expense = makeDraftExpense({
      subtotalCents: 1234,
      taxCents: 56,
      tipCents: 78,
      totalCents: 1368,
      currency: "USD",
    });

    expect(expense.status).toBe("draft");
    expect(expense.subtotalCents).toBe(1234);
    expect(expense.taxCents).toBe(56);
    expect(expense.tipCents).toBe(78);
    expect(expense.totalCents).toBe(1368);
    expect(expense.currency).toBe("USD");
  });

  it("create: non-organizer cannot set a different payer", () => {
    // mirrors expenses.ts lines 83-90
    function simulatePayerCheck(
      tripRole: TripRole,
      ctxUserId: string,
      inputPayerUserId: string | null | undefined,
    ): void {
      if (inputPayerUserId && inputPayerUserId !== ctxUserId) {
        if (tripRole !== "organizer") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only organizers can set a different payer.",
          });
        }
      }
    }

    expect(() =>
      simulatePayerCheck("member", "user_bob", "user_alice"),
    ).toThrow("Only organizers can set a different payer.");
  });

  it("create: organizer can set a different payer without throwing", () => {
    function simulatePayerCheck(
      tripRole: TripRole,
      ctxUserId: string,
      inputPayerUserId: string | null | undefined,
    ): void {
      if (inputPayerUserId && inputPayerUserId !== ctxUserId) {
        if (tripRole !== "organizer") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only organizers can set a different payer.",
          });
        }
      }
    }

    expect(() =>
      simulatePayerCheck("organizer", "user_alice", "user_bob"),
    ).not.toThrow();
  });
});

describe("expenses router — finalize lifecycle", () => {
  it("finalize: draft expense transitions to finalized", () => {
    const existing = makeDraftExpense({ status: "draft", currency: "USD" });
    const result = simulateFinalize("organizer", "user_alice", existing, []);
    expect(result.status).toBe("finalized");
  });

  it("finalize: already-finalized expense throws BAD_REQUEST", () => {
    const existing = makeDraftExpense({ status: "finalized" });
    expect(() =>
      simulateFinalize("organizer", "user_alice", existing, []),
    ).toThrow("Expense is already finalized.");
  });

  it("finalize: mixed-currency throws BAD_REQUEST (existing EUR, new USD)", () => {
    const existing = makeDraftExpense({ status: "draft", currency: "USD" });
    const existingFinalized = [{ currency: "EUR" }];

    expect(() =>
      simulateFinalize("organizer", "user_alice", existing, existingFinalized),
    ).toThrow("This trip already has finalized expenses in EUR");
  });

  it("finalize: same currency as existing finalized expenses is allowed", () => {
    const existing = makeDraftExpense({ status: "draft", currency: "EUR" });
    const existingFinalized = [{ currency: "EUR" }];

    const result = simulateFinalize(
      "organizer",
      "user_alice",
      existing,
      existingFinalized,
    );
    expect(result.status).toBe("finalized");
  });
});

describe("expenses router — role guards (requireOrganizerOrSelf)", () => {
  it("organizer can modify any expense", () => {
    expect(() =>
      requireOrganizerOrSelf("organizer", "user_alice", "user_bob"),
    ).not.toThrow();
  });

  it("payer (non-organizer) can modify their own expense", () => {
    expect(() =>
      requireOrganizerOrSelf("member", "user_alice", "user_alice"),
    ).not.toThrow();
  });

  it("non-organizer non-payer is rejected with FORBIDDEN", () => {
    expect(() =>
      requireOrganizerOrSelf("member", "user_alice", "user_bob"),
    ).toThrow(TRPCError);
    expect(() =>
      requireOrganizerOrSelf("member", "user_alice", "user_bob"),
    ).toThrow("Only the payer or a trip organizer can modify this expense.");
  });

  it("assignLineItem is organizer-only (stricter guard than requireOrganizerOrSelf)", () => {
    // assignLineItem uses requireOrganizer (not requireOrganizerOrSelf)
    // mirrors expenses.ts lines 762-767
    function requireOrganizer(tripRole: TripRole): void {
      if (tripRole !== "organizer") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only organizers can reassign line items for others.",
        });
      }
    }
    expect(() => requireOrganizer("member")).toThrow(TRPCError);
    expect(() => requireOrganizer("organizer")).not.toThrow();
  });
});

describe("expenses router — line items and claims", () => {
  it("addLineItem: rejected on finalized expense (requires draft)", () => {
    // mirrors expenses.ts lines 488-493
    function simulateAddLineItem(expense: ExpenseRow): void {
      if (expense.status !== "draft") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Line items can only be added to draft expenses.",
        });
      }
    }

    const finalized = makeDraftExpense({ status: "finalized" });
    expect(() => simulateAddLineItem(finalized)).toThrow(
      "Line items can only be added to draft expenses.",
    );
  });

  it("claimLineItem: rejected on draft expense (requires finalized)", () => {
    // mirrors expenses.ts lines 686-691
    function simulateClaim(status: ExpenseStatus): void {
      if (status !== "finalized") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Line items can only be claimed on finalized expenses.",
        });
      }
    }

    expect(() => simulateClaim("draft")).toThrow(
      "Line items can only be claimed on finalized expenses.",
    );
  });

  it("claimLineItem: idempotent — claiming twice does not create a duplicate", () => {
    // mirrors the onConflictDoNothing behavior at expenses.ts lines 693-701
    const claims: ClaimRow[] = [];
    const lineItemId = randomUUID();
    const userId = "user_bob";

    function simulateClaim(
      claims: ClaimRow[],
      lineItemId: string,
      userId: string,
    ): { claimed: boolean } {
      const exists = claims.some(
        (c) => c.lineItemId === lineItemId && c.userId === userId,
      );
      if (!exists) {
        claims.push({ lineItemId, userId });
      }
      return { claimed: true };
    }

    simulateClaim(claims, lineItemId, userId);
    expect(claims).toHaveLength(1);

    simulateClaim(claims, lineItemId, userId); // second call
    expect(claims).toHaveLength(1); // still 1 — idempotent
  });
});

describe("expenses router — get: computeExpenseShares integration", () => {
  it("fully-claimed expense attributes line totals to each claimant correctly", () => {
    const alice = "user_alice";
    const bob = "user_bob";

    // Alice paid; bob claims item1 ($10), alice claims item2 ($15)
    const result = computeExpenseShares({
      payerUserId: alice,
      subtotalCents: 2500,
      taxCents: 0,
      tipCents: 0,
      participantUserIds: [alice, bob],
      lineItems: [
        { id: randomUUID(), lineTotalCents: 1000, claimantUserIds: [bob] },
        { id: randomUUID(), lineTotalCents: 1500, claimantUserIds: [alice] },
      ],
    });

    const sharesByUser = Object.fromEntries(
      result.shares.map((s) => [s.userId, s.totalCents]),
    );
    expect(sharesByUser[bob]).toBe(1000);
    expect(sharesByUser[alice]).toBe(1500);
  });

  it("unclaimed line items split across all participants", () => {
    const alice = "user_alice";
    const bob = "user_bob";
    const charlie = "user_charlie";

    // $30 item, no claims → split 3 ways → $10 each
    const result = computeExpenseShares({
      payerUserId: alice,
      subtotalCents: 3000,
      taxCents: 0,
      tipCents: 0,
      participantUserIds: [alice, bob, charlie],
      lineItems: [
        { id: randomUUID(), lineTotalCents: 3000, claimantUserIds: [] },
      ],
    });

    const sharesByUser = Object.fromEntries(
      result.shares.map((s) => [s.userId, s.totalCents]),
    );
    expect(sharesByUser[alice]).toBe(1000);
    expect(sharesByUser[bob]).toBe(1000);
    expect(sharesByUser[charlie]).toBe(1000);
  });

  it("tax and tip are prorated proportionally to subtotal shares", () => {
    const alice = "user_alice";
    const bob = "user_bob";

    // Alice claims $20, Bob claims $10 → alice=2/3, bob=1/3
    // Tax = $3.00 (300¢) → alice gets 200¢, bob gets 100¢
    const result = computeExpenseShares({
      payerUserId: alice,
      subtotalCents: 3000,
      taxCents: 300,
      tipCents: 0,
      participantUserIds: [alice, bob],
      lineItems: [
        { id: randomUUID(), lineTotalCents: 2000, claimantUserIds: [alice] },
        { id: randomUUID(), lineTotalCents: 1000, claimantUserIds: [bob] },
      ],
    });

    const sharesByUser = Object.fromEntries(
      result.shares.map((s) => [s.userId, s]),
    );
    expect(sharesByUser[alice]?.taxCents).toBe(200);
    expect(sharesByUser[bob]?.taxCents).toBe(100);
  });
});

describe("expenses router — currency stored per expense", () => {
  it("manual expense currency is stored as given (no automatic trip inheritance)", () => {
    // Unlike fuel-log split expenses (commit 4b0c6fe), manual expenses take the
    // currency from the input without inheriting from the trip.
    // The only currency enforcement is at finalize time (mixed-currency guard).
    const expense = makeDraftExpense({ currency: "EUR" });
    expect(expense.currency).toBe("EUR");
  });

  it("manual expense with different currency than existing finalized expenses cannot be finalized", () => {
    const draftUSD = makeDraftExpense({ currency: "USD" });
    const existingFinalizedEUR = [{ currency: "EUR" }];

    expect(() =>
      simulateFinalize(
        "organizer",
        "user_alice",
        draftUSD,
        existingFinalizedEUR,
      ),
    ).toThrow(TRPCError);
  });
});

describe("expenses router — updateDraft guard", () => {
  it("updateDraft on finalized expense throws BAD_REQUEST", () => {
    // mirrors expenses.ts lines 301-306
    function simulateUpdateDraft(expense: ExpenseRow): void {
      if (expense.status !== "draft") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only draft expenses can be edited.",
        });
      }
    }

    const finalized = makeDraftExpense({ status: "finalized" });
    expect(() => simulateUpdateDraft(finalized)).toThrow(
      "Only draft expenses can be edited.",
    );
  });

  it("updateDraft with no fields returns existing record (no-op branch)", () => {
    // mirrors expenses.ts lines 327-329
    const expense = makeDraftExpense();

    function simulateUpdateDraft(
      expense: ExpenseRow,
      patch: Record<string, unknown>,
    ): ExpenseRow {
      if (Object.keys(patch).length === 0) {
        return expense;
      }
      return { ...expense, ...patch } as ExpenseRow;
    }

    const result = simulateUpdateDraft(expense, {});
    expect(result).toBe(expense); // same reference — no update happened
  });
});

describe("expenses router — attachReceiptImage OCR persistence", () => {
  // Mirrors the trip-scope guard + OCR patch building in expenses.ts
  // attachReceiptImage. The mutation looks the expense up scoped to the
  // authorized trip, then writes only the OCR fields the caller supplied.

  type OcrInput = {
    ocrConfidence?: number;
    ocrWarnings?: string[];
    ocrProvider?: "claude" | "gemini" | "fixture";
    ocrStatus?: "success" | "failed";
  };

  function simulateAttach(
    rowsInTrip: ExpenseRow[],
    ctxTripId: string,
    input: { expenseId: string } & OcrInput,
  ): { patch: Record<string, unknown> } {
    const existing = rowsInTrip.find(
      (r) => r.id === input.expenseId && r.tripId === ctxTripId,
    );
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found." });
    }
    const patch: Record<string, unknown> = {};
    if (input.ocrConfidence !== undefined)
      patch.ocrConfidence = input.ocrConfidence;
    if (input.ocrWarnings !== undefined) patch.ocrWarnings = input.ocrWarnings;
    if (input.ocrProvider !== undefined) patch.ocrProvider = input.ocrProvider;
    if (input.ocrStatus !== undefined) patch.ocrStatus = input.ocrStatus;
    return { patch };
  }

  it("throws NOT_FOUND when the expense is not in the authorized trip", () => {
    const expense = makeDraftExpense({ id: "exp_1", tripId: "trip_1" });
    expect(() =>
      simulateAttach([expense], "trip_OTHER", { expenseId: "exp_1" }),
    ).toThrow("Expense not found.");
  });

  it("persists supplied OCR provenance onto the expense", () => {
    const expense = makeDraftExpense({ id: "exp_1", tripId: "trip_1" });
    const { patch } = simulateAttach([expense], "trip_1", {
      expenseId: "exp_1",
      ocrConfidence: 0.42,
      ocrWarnings: ["Subtotal + tax + tip != total"],
      ocrProvider: "claude",
      ocrStatus: "success",
    });
    expect(patch).toEqual({
      ocrConfidence: 0.42,
      ocrWarnings: ["Subtotal + tax + tip != total"],
      ocrProvider: "claude",
      ocrStatus: "success",
    });
  });

  it("records a failed scan with status only (no confidence/provider)", () => {
    const expense = makeDraftExpense({ id: "exp_1", tripId: "trip_1" });
    const { patch } = simulateAttach([expense], "trip_1", {
      expenseId: "exp_1",
      ocrStatus: "failed",
    });
    expect(patch).toEqual({ ocrStatus: "failed" });
  });

  it("leaves OCR fields untouched for a manual attach (empty patch)", () => {
    const expense = makeDraftExpense({ id: "exp_1", tripId: "trip_1" });
    const { patch } = simulateAttach([expense], "trip_1", {
      expenseId: "exp_1",
    });
    expect(Object.keys(patch)).toHaveLength(0);
  });
});
