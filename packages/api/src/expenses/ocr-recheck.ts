// Re-run OCR reconciliation against an expense's *current* (possibly
// user-corrected) values, so fixing the amounts refreshes the stored
// confidence/warnings and can clear a "needs review" flag.
//
// We reuse the pure `reconcileReceipt` validator but DO NOT write its
// `sanitized` extraction back — the user's edits are authoritative; we only
// take the recomputed confidence + warnings.

import { reconcileReceipt } from "../ocr/reconcile";
import type { ReceiptExtraction } from "../ocr/schema";

export interface ExpenseAmounts {
  merchant: string;
  occurredAt: Date;
  currency: string;
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
}

export interface RecheckLineItem {
  name: string;
  // `numeric` columns come back as strings from the driver.
  quantity: number | string;
  unitPriceCents: number;
  lineTotalCents: number;
}

export function recheckExpenseOcr(
  amounts: ExpenseAmounts,
  lineItems: RecheckLineItem[],
): { ocrConfidence: number; ocrWarnings: string[]; ocrStatus: "success" } {
  const extraction: ReceiptExtraction = {
    merchant: amounts.merchant,
    occurredAt: amounts.occurredAt.toISOString(),
    currency: amounts.currency,
    subtotalCents: amounts.subtotalCents,
    taxCents: amounts.taxCents,
    tipCents: amounts.tipCents,
    totalCents: amounts.totalCents,
    lineItems: lineItems.map((li) => ({
      name: li.name,
      quantity: Number(li.quantity) || 0,
      unitPriceCents: li.unitPriceCents,
      lineTotalCents: li.lineTotalCents,
    })),
  };

  const result = reconcileReceipt(extraction);
  return {
    ocrConfidence: result.confidence,
    ocrWarnings: result.warnings,
    ocrStatus: "success",
  };
}
