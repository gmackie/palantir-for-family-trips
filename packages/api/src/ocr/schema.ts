import { z } from "zod/v4";

/**
 * Zod schema for structured OCR output from Claude vision.
 *
 * The extractor uses `messages.parse()` with this schema to guarantee
 * valid JSON shape. The reconciliation + PII scrubbing passes run
 * after parse succeeds.
 */
export const receiptExtractionSchema = z.object({
  merchant: z
    .string()
    .describe("Name of the business or merchant as printed on the receipt"),
  occurredAt: z
    .string()
    .describe(
      "ISO 8601 timestamp when the transaction occurred. Use the receipt's printed date and time. If time is not visible, use 12:00:00 local.",
    ),
  currency: z
    .string()
    .min(3)
    .max(3)
    .describe(
      "ISO 4217 currency code (USD, EUR, JPY, GBP, etc.) detected from the receipt. Use the currency symbol or explicit code on the receipt.",
    ),
  subtotalCents: z
    .number()
    .int()
    .nonnegative()
    .describe("Pre-tax subtotal in minor units (cents, pence, etc.)"),
  taxCents: z
    .number()
    .int()
    .nonnegative()
    .describe("Tax amount in minor units"),
  tipCents: z
    .number()
    .int()
    .nonnegative()
    .describe("Tip or gratuity in minor units. Zero if not present."),
  totalCents: z
    .number()
    .int()
    .nonnegative()
    .describe("Final total charged in minor units"),
  lineItems: z
    .array(
      z.object({
        name: z
          .string()
          .describe(
            "Human-readable item name as printed. If abbreviated on the receipt, expand to a reasonable full name.",
          ),
        quantity: z
          .number()
          .positive()
          .default(1)
          .describe("Quantity ordered. Default 1 if not visible."),
        unitPriceCents: z
          .number()
          .int()
          .nonnegative()
          .nullable()
          .default(0)
          .transform((v) => v ?? 0)
          .describe("Price per single unit in minor units"),
        lineTotalCents: z
          .number()
          .int()
          .nonnegative()
          .nullable()
          .default(0)
          .transform((v) => v ?? 0)
          .describe(
            "Total for this line (quantity * unit price) in minor units",
          ),
      }),
    )
    .describe(
      "Itemized list of goods purchased. Omit tax, tip, and totals from this array.",
    ),
});

export type ReceiptExtraction = z.infer<typeof receiptExtractionSchema>;

/**
 * Zod schema for structured ferry-booking OCR output from a vision model.
 *
 * Used by the generalized `extractStructured` helper with `messages.parse()`
 * to guarantee a valid `FerryBooking` shape from a ferry ticket/confirmation
 * image or PDF.
 */
export const ferryBookingSchema = z.object({
  operator: z
    .string()
    .describe("Ferry operator/line, e.g. 'Washington State Ferries'"),
  departureTerminal: z.string().describe("Departure terminal/dock name"),
  arrivalTerminal: z.string().describe("Arrival terminal/dock name"),
  departureAt: z
    .string()
    .describe("ISO 8601 scheduled departure. If no time, use 12:00:00 local."),
  confirmationNumber: z
    .string()
    .nullable()
    .default(null)
    .describe("Booking/confirmation number if printed"),
  fareCents: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .default(null)
    .describe("Total fare in minor units (cents)"),
  currency: z.string().min(3).max(3).describe("ISO 4217 currency code"),
  vehicleReservation: z
    .boolean()
    .default(false)
    .describe("True if a vehicle space is reserved"),
  passengerNote: z
    .string()
    .nullable()
    .default(null)
    .describe("Free text e.g. 'Car + 2 passengers'"),
});

export type FerryBooking = z.infer<typeof ferryBookingSchema>;
