import { and, asc, eq } from "@sortey/db";
import {
  type ExpenseCategory,
  type FerrySource,
  ferryCrossings,
  tripSegments,
} from "@sortey/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { tripProcedure } from "../auth/guards";
import {
  insertExpenseDraft,
  updateTransportDraftAmount,
} from "../expenses/transport-draft";
import { extractFerryBooking, type FerryBooking } from "../ocr";

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
  /**
   * Resolve the segment the fare expense should hang off of. Prefers the
   * ferry's `afterSegmentId` when set, otherwise the trip's first segment.
   * Expenses require a non-null segmentId (segments all the way down).
   */
  resolveSegmentId(input: {
    tripId: string;
    afterSegmentId: string | null;
  }): Promise<string | null>;
  /**
   * True when the segment exists AND belongs to `tripId`. Used to reject a
   * caller-supplied `afterSegmentId` that points at another trip's segment —
   * mirrors the "segment belongs to this trip" check in `expenses.create`.
   */
  segmentBelongsToTrip(input: {
    tripId: string;
    segmentId: string;
  }): Promise<boolean>;
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

/**
 * Reject a caller-supplied `afterSegmentId` that doesn't belong to this trip.
 * Mirrors `expenses.create`'s "segment belongs to this trip" guard (same
 * `BAD_REQUEST` code). A `null`/absent value is fine — it just means "fall back
 * to the trip's first segment" downstream.
 */
async function assertAfterSegmentInTrip(
  store: FerryStore,
  tripId: string,
  afterSegmentId: string | null | undefined,
): Promise<void> {
  if (!afterSegmentId) return;
  const belongs = await store.segmentBelongsToTrip({
    tripId,
    segmentId: afterSegmentId,
  });
  if (!belongs) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Segment does not belong to this trip.",
    });
  }
}

function ferryFareMerchant(row: {
  operator: string | null;
  departureTerminal: string | null;
  arrivalTerminal: string | null;
}): string {
  const route =
    row.departureTerminal && row.arrivalTerminal
      ? `${row.departureTerminal} → ${row.arrivalTerminal}`
      : (row.departureTerminal ?? row.arrivalTerminal ?? "crossing");
  return row.operator ? `${row.operator} ferry (${route})` : `Ferry (${route})`;
}

/**
 * Spawn a draft transit expense for the fare and return its id. The fare is a
 * single splittable amount (subtotal == total) under the `transit` category,
 * split across trip members via the existing expense shares path at read time.
 * Throws `PRECONDITION_FAILED` when no segment can be resolved: a crossing
 * without any segment can't carry an expense (segmentId is NOT NULL), and
 * silently dropping the fare would leave the user with no signal.
 */
async function spawnFareExpense(
  store: FerryStore,
  ferry: FerryCrossingRow,
  fareCents: number,
): Promise<string> {
  const segmentId = await store.resolveSegmentId({
    tripId: ferry.tripId,
    afterSegmentId: ferry.afterSegmentId,
  });
  if (!segmentId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Cannot add a ferry fare before the trip has a segment.",
    });
  }

  const occurredAt = ferry.scheduledDepartureAt ?? new Date();
  const { id } = await store.insertTransportDraft({
    tripId: ferry.tripId,
    segmentId,
    payerUserId: ferry.createdByUserId,
    merchant: ferryFareMerchant(ferry),
    category: FERRY_EXPENSE_CATEGORY,
    currency: ferry.currency,
    amountCents: fareCents,
    occurredAt,
    notes: ferry.fareNote ?? null,
  });
  return id;
}

export async function createFerryCrossing(
  store: FerryStore,
  input: FerryWriteFields & {
    tripId: string;
    createdByUserId: string;
  },
): Promise<FerryCrossingRow> {
  // Reject a supplied afterSegmentId that points at another trip's segment
  // before we write anything.
  await assertAfterSegmentInTrip(store, input.tripId, input.afterSegmentId);

  const created = await store.insertFerry({ ...input, source: "manual" });

  // A positive fare spawns a splittable draft transit expense and links it.
  if (created.fareCents && created.fareCents > 0) {
    const expenseId = await spawnFareExpense(store, created, created.fareCents);
    const linked = await store.updateFerry({
      id: created.id,
      tripId: created.tripId,
      patch: { expenseId },
    });
    return linked ?? { ...created, expenseId };
  }

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

  // Reject a supplied afterSegmentId that points at another trip's segment
  // before we write the patch.
  await assertAfterSegmentInTrip(store, tripId, fields.afterSegmentId);

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

  // Reconcile the linked fare expense when fare/currency changed on this update.
  const fareTouched =
    fields.fareCents !== undefined || fields.currency !== undefined;
  if (!fareTouched) {
    return updated;
  }

  const fareCents = updated.fareCents ?? 0;

  if (fareCents > 0 && updated.expenseId) {
    // Existing link — push the new amount/currency onto the draft.
    await store.updateExpenseAmount({
      expenseId: updated.expenseId,
      amountCents: fareCents,
      currency: updated.currency,
    });
    return updated;
  }

  if (fareCents > 0 && !updated.expenseId) {
    // Fare added to a previously fare-less crossing — spawn + link.
    const expenseId = await spawnFareExpense(store, updated, fareCents);
    const linked = await store.updateFerry({
      id,
      tripId,
      patch: { expenseId },
    });
    return linked ?? { ...updated, expenseId };
  }

  if (fareCents <= 0 && updated.expenseId) {
    // Fare cleared — drop the linked draft and unlink.
    await store.deleteExpense({ expenseId: updated.expenseId });
    const unlinked = await store.updateFerry({
      id,
      tripId,
      patch: { expenseId: null },
    });
    return unlinked ?? { ...updated, expenseId: null };
  }

  return updated;
}

export async function deleteFerryCrossing(
  store: FerryStore,
  input: { id: string; tripId: string },
): Promise<{ deleted: boolean }> {
  // Hard-delete the linked draft first so it doesn't dangle once the crossing
  // is gone. Unlike `expenses.delete`, this intentionally skips the
  // organizer/payer (`requireOrganizerOrSelf`) check: a ferry-fare draft is
  // always an unfinalized, trip-scoped, system-spawned row owned by the
  // crossing's lifecycle — anyone authorized to delete the crossing (already
  // gated by `tripProcedure`) deletes its fare with it. It never carries a
  // finalized, settlement-bearing balance someone else owns.
  const existing = await store.getFerry(input);
  if (existing?.expenseId) {
    await store.deleteExpense({ expenseId: existing.expenseId });
  }

  const deleted = await store.deleteFerry(input);
  if (!deleted) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Ferry not found." });
  }
  return { deleted: true };
}

// ── OCR pre-fill (no persistence) ────────────────────────────────────────────

// Image MIME types accepted by `extractFromImage`. PDF is intentionally absent.
// TODO(ferry): PDF rasterization — accept application/pdf by rasterizing the
// first page to an image before extraction. Out of scope for v1.
const FERRY_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

// Upper bound on the base64-encoded ticket image. ~10 MB of raw image is plenty
// for a phone photo of a ferry ticket; base64 inflates ~4/3, so 10 MB ≈
// 14_000_000 chars. No other image-ingest input in the codebase defines a cap,
// so this is the local source of truth. Bounds the payload before we even
// allocate a Buffer for it.
export const MAX_FERRY_IMAGE_BASE64_CHARS = 14_000_000;

// Input schema for `extractFromImage`, exported so the base64 size bound can be
// exercised directly in tests (the router wires this up below).
export const ferryExtractInputSchema = z.object({
  workspaceId: z.string().min(1),
  tripId: z.string().min(1),
  imageBase64: z.string().min(1).max(MAX_FERRY_IMAGE_BASE64_CHARS),
  mimeType: z.enum(FERRY_IMAGE_MIME_TYPES),
});

export type FerryExtractResult =
  | { ok: true; booking: FerryBooking }
  | { ok: false };

/**
 * Decode a base64 ferry ticket image and run it through the ferry booking
 * extractor, returning the parsed fields for the form to pre-fill. Persists
 * nothing. Never throws to the client — any decode/extraction failure is
 * folded into `{ ok: false }`.
 */
export async function extractFerryFromImage(input: {
  imageBase64: string;
  mimeType: (typeof FERRY_IMAGE_MIME_TYPES)[number];
}): Promise<FerryExtractResult> {
  try {
    const imageBytes = Buffer.from(input.imageBase64, "base64");
    const booking = await extractFerryBooking({
      imageBytes,
      mimeType: input.mimeType,
    });
    return { ok: true, booking };
  } catch {
    return { ok: false };
  }
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
    resolveSegmentId: async ({ tripId, afterSegmentId }) => {
      if (afterSegmentId) return afterSegmentId;
      const [seg] = (await db
        .select({ id: tripSegments.id })
        .from(tripSegments)
        .where(eq(tripSegments.tripId, tripId))
        .orderBy(asc(tripSegments.sortOrder))
        .limit(1)) as Array<{ id: string }>;
      return seg?.id ?? null;
    },
    segmentBelongsToTrip: async ({ tripId, segmentId }) => {
      const [seg] = (await db
        .select({ id: tripSegments.id })
        .from(tripSegments)
        .where(
          and(eq(tripSegments.id, segmentId), eq(tripSegments.tripId, tripId)),
        )
        .limit(1)) as Array<{ id: string }>;
      return seg != null;
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
// expense path. Kept here (rather than a third import) because the ferry path
// hard-deletes its own system-spawned, always-unfinalized fare draft as part of
// the crossing lifecycle — it does not reuse `expenses.delete`'s organizer/self
// authorization (see `deleteFerryCrossing`).
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

// Base write shape carries NO `.default()`s. The CREATE path layers defaults on
// top (so a fresh row gets cutoff/vehicleReservation/currency); the UPDATE path
// is `.partial()` of the BASE so an omitted field stays omitted — Zod v4's
// `.partial()` does not strip inner `.default()`s, so a defaulted base would
// silently reset currency/cutoff/vehicleReservation on every single-field edit.
const ferryWriteBaseSchema = z.object({
  operator: z.string().max(200).nullish(),
  departureTerminal: z.string().max(200).nullish(),
  arrivalTerminal: z.string().max(200).nullish(),
  scheduledDepartureAt: isoDateTimeSchema.nullish(),
  durationMinutes: z.number().int().nonnegative().nullish(),
  arrivalCutoffMinutes: z.number().int().nonnegative(),
  vehicleReservation: z.boolean(),
  confirmationNumber: z.string().max(100).nullish(),
  fareCents: z.number().int().nonnegative().nullish(),
  currency: z.string().length(3).toUpperCase(),
  fareNote: z.string().max(200).nullish(),
  afterSegmentId: z.string().uuid().nullish(),
});

// CREATE input: the base shape with defaults applied for the fields a fresh row
// needs. UPDATE input: the base shape made partial, with no defaults — only the
// fields the caller supplies are written.
const ferryCreateSchema = ferryWriteBaseSchema.extend({
  arrivalCutoffMinutes: z.number().int().nonnegative().default(30),
  vehicleReservation: z.boolean().default(false),
  currency: z.string().length(3).toUpperCase().default("USD"),
});

const ferryUpdateSchema = ferryWriteBaseSchema.partial();

// Maps a (possibly partial) parsed input into store write fields. `undefined`
// values are left as `undefined` so the update path skips them; explicit
// `null`s pass through to clear a column. The `scheduledDepartureAt` string is
// coerced to a Date here (the single place that owns the conversion).
function normalizeWriteFields(
  input: Partial<z.infer<typeof ferryWriteBaseSchema>>,
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
      ferryCreateSchema.extend({
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
      ferryUpdateSchema.extend({
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

  // OCR pre-fill: parse a ferry ticket image into structured fields for the
  // form to review before submit. Persists nothing; never throws to the client.
  extractFromImage: tripProcedure()
    .input(ferryExtractInputSchema)
    .mutation(({ input }) =>
      extractFerryFromImage({
        imageBase64: input.imageBase64,
        mimeType: input.mimeType,
      }),
    ),
} satisfies TRPCRouterRecord;
