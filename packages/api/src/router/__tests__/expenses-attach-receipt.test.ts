import { describe, expect, it } from "vitest";
import type { ReceiptImageStore } from "../expenses";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/gmacko_test";

const { attachReceiptImageToTrip } = await import("../expenses");

type ReceiptImageRow = {
  id: string;
  expenseId: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByUserId: string;
  createdAt: Date;
};

type ExpenseRow = {
  id: string;
  tripId: string;
};

function createMemoryReceiptImageStore(input?: {
  expenses?: ExpenseRow[];
  receiptImages?: ReceiptImageRow[];
}) {
  const state = {
    expenses: [...(input?.expenses ?? [])],
    receiptImages: [...(input?.receiptImages ?? [])],
  };
  let seq = state.receiptImages.length;

  const store: ReceiptImageStore = {
    findTripExpense: async ({ expenseId, tripId }) => {
      const found = state.expenses.find(
        (e) => e.id === expenseId && e.tripId === tripId,
      );
      return found ? { id: found.id } : null;
    },
    insertReceiptImage: async (values) => {
      seq += 1;
      const row: ReceiptImageRow = {
        id: `img_${seq}`,
        ...values,
        createdAt: new Date(2026, 5, 12, 0, 0, seq),
      };
      state.receiptImages.push(row);
      // Cast to satisfy the generic return type expected by the interface
      return row as unknown as Awaited<
        ReturnType<ReceiptImageStore["insertReceiptImage"]>
      >;
    },
  };

  return { state, store };
}

describe("attachReceiptImageToTrip", () => {
  it("happy path: expense exists in the given trip — inserts row and returns it", async () => {
    const { state, store } = createMemoryReceiptImageStore({
      expenses: [{ id: "exp_1", tripId: "trip_1" }],
    });

    const result = await attachReceiptImageToTrip(store, {
      expenseId: "exp_1",
      tripId: "trip_1",
      storageKey: "receipts/exp_1/image.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 204800,
      userId: "user_1",
    });

    expect(result.id).toBeTruthy();
    expect(result.expenseId).toBe("exp_1");
    expect(result.storageKey).toBe("receipts/exp_1/image.jpg");
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.sizeBytes).toBe(204800);
    expect(result.uploadedByUserId).toBe("user_1");
    expect(state.receiptImages).toHaveLength(1);
  });

  it("regression (the bug): expense exists but belongs to a different trip — rejects with NOT_FOUND and makes no insert", async () => {
    // Expense belongs to trip_b; caller passes trip_a (the trip they are a member of).
    const { state, store } = createMemoryReceiptImageStore({
      expenses: [{ id: "exp_2", tripId: "trip_b" }],
    });

    await expect(
      attachReceiptImageToTrip(store, {
        expenseId: "exp_2",
        tripId: "trip_a",
        storageKey: "receipts/exp_2/image.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 51200,
        userId: "member_of_a",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // No receipt image row was inserted.
    expect(state.receiptImages).toHaveLength(0);
  });

  it("missing expense: no such expense at all — rejects with NOT_FOUND and makes no insert", async () => {
    const { state, store } = createMemoryReceiptImageStore({
      expenses: [],
    });

    await expect(
      attachReceiptImageToTrip(store, {
        expenseId: "exp_nonexistent",
        tripId: "trip_1",
        storageKey: "receipts/exp_nonexistent/image.jpg",
        mimeType: "image/png",
        sizeBytes: 10240,
        userId: "user_1",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(state.receiptImages).toHaveLength(0);
  });
});
