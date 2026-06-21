import { and, asc, eq } from "@sortey/db";
import {
  type ExpenseCategory,
  type FerrySource,
  ferryCrossings,
  tripMembers,
} from "@sortey/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { tripProcedure } from "../auth/guards";
import {
  insertExpenseDraft,
  updateTransportDraftAmount,
} from "../expenses/transport-draft";

// Ferry fares are a single splittable transport leg cost. The expense category
// enum has no dedicated "transport" value — `transit` is the closest existing
// category, so ferry fare drafts are filed under it.
const FERRY_EXPENSE_CATEGORY: ExpenseCategory = "transit";

export type FerryCrossingRow = typeof ferryCrossings.$inferSelect;

export type FerryWriteFields = {
  operator?: string | null;
  departureTerminal?: string | null;
  arrivalTerminal?: string | null;
  scheduledDepartureAt?: Date | null;
  durationMinutes?: number | null;
  arrivalCutoffMinutes?: number;
  vehicleReservation?: boolean;
  confirmationNumber?: string | null;
  fareCents?: number | null;
  currency?: string;
  fareNote?: string | null;
  afterSegmentId?: string | null;
  source?: FerrySource;
};

export interface FerryStore {
  insertFerry(
    values: FerryWriteFields & {
      tripId: string;
      createdByUserId: string;
    },
  ): Promise<FerryCrossingRow>;
  getFerry(input: {
    id: string;
    tripId: string;
  }): Promise<FerryCrossingRow | null>;
  updateFerry(input: {
    id: string;
    tripId: string;
    patch: Partial<FerryCrossingRow>;
  }): Promise<FerryCrossingRow | null>;
  deleteFerry(input: { id: string; tripId: string }): Promise<boolean>;
  listFerries(input: { tripId: string }): Promise<FerryCrossingRow[]>;
  listTripMemberUserIds(input: { tripId: string }): Promise<string[]>;
  insertTransportDraft(input: {
    tripId: string;
    segmentId: string;
    payerUserId: string;
    merchant: string;
    category: ExpenseCategory;
    currency: string;
    amountCents: number;
    occurredAt: Date;
    notes: string | null;
  }): Promise<{ id: string }>;
  updateExpenseAmount(input: {
    expenseId: string;
    amountCents: number;
    currency: string;
  }): Promise<void>;
  deleteExpense(input: { expenseId: string }): Promise<void>;
}

// ── Orchestration (store-backed, DB-agnostic) ────────────────────────────────

export async function createFerryCrossing(
  store: FerryStore,
  input: FerryWriteFields & {
    tripId: string;
    createdByUserId: string;
  },
): Promise<FerryCrossingRow> {
  const created = await store.insertFerry({ ...input, source: "manual" });
  return created;
}

export async function listFerryCrossings(
  store: FerryStore,
  input: { tripId: string },
): Promise<FerryCrossingRow[]> {
  return store.listFerries(input);
}

export async function updateFerryCrossing(
  store: FerryStore,
  input: FerryWriteFields & { id: string; tripId: string },
): Promise<FerryCrossingRow> {
  const { id, tripId, ...fields } = input;
  const patch: Partial<FerryCrossingRow> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      (patch as Record<string, unknown>)[key] = value;
    }
  }

  const updated = await store.updateFerry({ id, tripId, patch });
  if (!updated) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Ferry not found." });
  }
  return updated;
}

export async function deleteFerryCrossing(
  store: FerryStore,
  input: { id: string; tripId: string },
): Promise<{ deleted: boolean }> {
  const deleted = await store.deleteFerry(input);
  if (!deleted) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Ferry not found." });
  }
  return { deleted: true };
}

// ── Real DB-backed store ─────────────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: Drizzle db type is complex
function createFerryStore(db: any): FerryStore {
  return {
    insertFerry: async (values) => {
      const [created] = (await db
        .insert(ferryCrossings)
        .values(values)
        .returning()) as FerryCrossingRow[];
      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create ferry crossing.",
        });
      }
      return created;
    },
    getFerry: async ({ id, tripId }) => {
      const [row] = (await db
        .select()
        .from(ferryCrossings)
        .where(
          and(eq(ferryCrossings.id, id), eq(ferryCrossings.tripId, tripId)),
        )
        .limit(1)) as FerryCrossingRow[];
      return row ?? null;
    },
    updateFerry: async ({ id, tripId, patch }) => {
      const [row] = (await db
        .update(ferryCrossings)
        .set(patch)
        .where(
          and(eq(ferryCrossings.id, id), eq(ferryCrossings.tripId, tripId)),
        )
        .returning()) as FerryCrossingRow[];
      return row ?? null;
    },
    deleteFerry: async ({ id, tripId }) => {
      const deleted = (await db
        .delete(ferryCrossings)
        .where(
          and(eq(ferryCrossings.id, id), eq(ferryCrossings.tripId, tripId)),
        )
        .returning({ id: ferryCrossings.id })) as Array<{ id: string }>;
      return deleted.length > 0;
    },
    listFerries: async ({ tripId }) =>
      (await db
        .select()
        .from(ferryCrossings)
        .where(eq(ferryCrossings.tripId, tripId))
        .orderBy(
          asc(ferryCrossings.scheduledDepartureAt),
          asc(ferryCrossings.createdAt),
        )) as FerryCrossingRow[],
    listTripMemberUserIds: async ({ tripId }) => {
      const rows = (await db
        .select({ userId: tripMembers.userId })
        .from(tripMembers)
        .where(eq(tripMembers.tripId, tripId))) as Array<{ userId: string }>;
      return rows.map((r) => r.userId);
    },
    insertTransportDraft: async (values) => {
      const created = await insertExpenseDraft({
        db,
        tripId: values.tripId,
        segmentId: values.segmentId,
        payerUserId: values.payerUserId,
        merchant: values.merchant,
        category: values.category,
        occurredAt: values.occurredAt,
        currency: values.currency,
        subtotalCents: values.amountCents,
        taxCents: 0,
        tipCents: 0,
        totalCents: values.amountCents,
        notes: values.notes,
      });
      return { id: created.id };
    },
    updateExpenseAmount: async ({ expenseId, amountCents, currency }) => {
      await updateTransportDraftAmount({
        db,
        expenseId,
        amountCents,
        currency,
      });
    },
    deleteExpense: async ({ expenseId }) => {
      await deleteTransportDraft({ db, expenseId });
    },
  };
}

// Local re-export shim so the store can delete a linked draft via the shared
// expense path. Kept here (rather than a third import) because deletion mirrors
// the row-scoped `expenses.delete` rule: hard-delete the linked draft.
async function deleteTransportDraft(input: {
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle db type is complex
  db: any;
  expenseId: string;
}): Promise<void> {
  const { expenses } = await import("@sortey/db/schema");
  await input.db.delete(expenses).where(eq(expenses.id, input.expenseId));
}

// ── Input schema (Zod) ───────────────────────────────────────────────────────

const isoDateTimeSchema = z.string().datetime({ offset: true });

const ferryWriteSchema = z.object({
  operator: z.string().max(200).nullish(),
  departureTerminal: z.string().max(200).nullish(),
  arrivalTerminal: z.string().max(200).nullish(),
  scheduledDepartureAt: isoDateTimeSchema.nullish(),
  durationMinutes: z.number().int().nonnegative().nullish(),
  arrivalCutoffMinutes: z.number().int().nonnegative().default(30),
  vehicleReservation: z.boolean().default(false),
  confirmationNumber: z.string().max(100).nullish(),
  fareCents: z.number().int().nonnegative().nullish(),
  currency: z.string().length(3).toUpperCase().default("USD"),
  fareNote: z.string().max(200).nullish(),
  afterSegmentId: z.string().uuid().nullish(),
});

// Maps a (possibly partial) parsed input into store write fields. `undefined`
// values are left as `undefined` so the update path skips them; explicit
// `null`s pass through to clear a column. The `scheduledDepartureAt` string is
// coerced to a Date here (the single place that owns the conversion).
function normalizeWriteFields(
  input: Partial<z.infer<typeof ferryWriteSchema>>,
): FerryWriteFields {
  const fields: FerryWriteFields = {};
  if (input.operator !== undefined) fields.operator = input.operator;
  if (input.departureTerminal !== undefined)
    fields.departureTerminal = input.departureTerminal;
  if (input.arrivalTerminal !== undefined)
    fields.arrivalTerminal = input.arrivalTerminal;
  if (input.scheduledDepartureAt !== undefined)
    fields.scheduledDepartureAt = input.scheduledDepartureAt
      ? new Date(input.scheduledDepartureAt)
      : null;
  if (input.durationMinutes !== undefined)
    fields.durationMinutes = input.durationMinutes;
  if (input.arrivalCutoffMinutes !== undefined)
    fields.arrivalCutoffMinutes = input.arrivalCutoffMinutes;
  if (input.vehicleReservation !== undefined)
    fields.vehicleReservation = input.vehicleReservation;
  if (input.confirmationNumber !== undefined)
    fields.confirmationNumber = input.confirmationNumber;
  if (input.fareCents !== undefined) fields.fareCents = input.fareCents;
  if (input.currency !== undefined) fields.currency = input.currency;
  if (input.fareNote !== undefined) fields.fareNote = input.fareNote;
  if (input.afterSegmentId !== undefined)
    fields.afterSegmentId = input.afterSegmentId;
  return fields;
}

export const ferriesRouter = {
  create: tripProcedure()
    .input(
      ferryWriteSchema.extend({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      createFerryCrossing(createFerryStore(ctx.db), {
        tripId: ctx.tripId,
        createdByUserId: ctx.session.user.id,
        ...normalizeWriteFields(input),
      }),
    ),

  update: tripProcedure()
    .input(
      ferryWriteSchema.partial().extend({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        ferryId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { workspaceId: _ws, tripId: _t, ferryId, ...fields } = input;
      return updateFerryCrossing(createFerryStore(ctx.db), {
        id: ferryId,
        tripId: ctx.tripId,
        ...normalizeWriteFields(fields),
      });
    }),

  delete: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        ferryId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) =>
      deleteFerryCrossing(createFerryStore(ctx.db), {
        id: input.ferryId,
        tripId: ctx.tripId,
      }),
    ),

  listForTrip: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
      }),
    )
    .query(({ ctx }) =>
      listFerryCrossings(createFerryStore(ctx.db), { tripId: ctx.tripId }),
    ),
} satisfies TRPCRouterRecord;
