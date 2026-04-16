import type { ReceiptExtraction } from "./schema";

/**
 * Post-extraction validation that runs after OCR parsing succeeds.
 *
 * Catches three classes of bad output:
 * 1. **Arithmetic mismatch** — subtotal + tax + tip != total (within 2¢).
 *    This defends against the model hallucinating numbers AND against
 *    prompt injection from adversarial receipt images.
 * 2. **Currency mismatches** — non-USD receipts should surface a warning
 *    since the settlement layer refuses to mix currencies.
 * 3. **PII patterns** — card-digit-like strings in merchant names or
 *    line items are stripped to avoid persisting partial card numbers.
 */
export interface ReconcileResult {
  /** The extraction with PII scrubbed. */
  sanitized: ReceiptExtraction;
  /** True when subtotal + tax + tip == total within tolerance. */
  arithmeticOk: boolean;
  /** Mismatch amount in cents (0 when arithmetic is ok). */
  arithmeticDeltaCents: number;
  /** True when currency is USD. */
  currencyIsUsd: boolean;
  /** Extraction confidence: 1.0 = all checks pass, lower = one or more issues. */
  confidence: number;
  /** Human-readable warnings to surface in the UI. */
  warnings: string[];
}

const RECONCILIATION_TOLERANCE_CENTS = 2;

// Matches 4-digit sequences that look like credit card partials.
// Intentionally conservative — we'd rather miss some than scrub item quantities.
const CARD_DIGIT_PATTERNS: ReadonlyArray<RegExp> = [
  /\*{4,}\s?\d{4}/g, // ****1234
  /XX{2,}\s?\d{4}/gi, // XXXX1234 / xxxx1234
  /card\s*(?:ending|#|number|no\.?)[:\s]*\d{4,}/gi,
  /\b\d{4}\s+\d{4}\s+\d{4}\s+\d{4}\b/g, // full card, rare but possible
];

function stripCardDigits(value: string): {
  cleaned: string;
  hadPII: boolean;
} {
  let cleaned = value;
  let hadPII = false;
  for (const pattern of CARD_DIGIT_PATTERNS) {
    if (pattern.test(cleaned)) {
      hadPII = true;
      cleaned = cleaned.replace(pattern, "[REDACTED]");
    }
  }
  return { cleaned: cleaned.trim(), hadPII };
}

export function reconcileReceipt(
  extraction: ReceiptExtraction,
): ReconcileResult {
  const warnings: string[] = [];
  let piiScrubbed = false;

  // Strip PII from merchant and line items
  const merchantResult = stripCardDigits(extraction.merchant);
  if (merchantResult.hadPII) piiScrubbed = true;

  const sanitizedLineItems = extraction.lineItems.map((item) => {
    const nameResult = stripCardDigits(item.name);
    if (nameResult.hadPII) piiScrubbed = true;
    return {
      ...item,
      name: nameResult.cleaned,
    };
  });

  if (piiScrubbed) {
    warnings.push("Card number patterns were redacted from the receipt.");
  }

  const sanitized: ReceiptExtraction = {
    ...extraction,
    merchant: merchantResult.cleaned,
    lineItems: sanitizedLineItems,
  };

  // Arithmetic reconciliation: subtotal + tax + tip == total
  const reconstructed =
    extraction.subtotalCents + extraction.taxCents + extraction.tipCents;
  const arithmeticDeltaCents = Math.abs(reconstructed - extraction.totalCents);
  const arithmeticOk = arithmeticDeltaCents <= RECONCILIATION_TOLERANCE_CENTS;

  if (!arithmeticOk) {
    warnings.push(
      `Amounts don't reconcile: subtotal ${extraction.subtotalCents}¢ + tax ${extraction.taxCents}¢ + tip ${extraction.tipCents}¢ = ${reconstructed}¢, but total is ${extraction.totalCents}¢. Please review.`,
    );
  }

  // Currency check
  const currencyIsUsd = extraction.currency.toUpperCase() === "USD";
  if (!currencyIsUsd) {
    warnings.push(
      `This receipt is in ${extraction.currency}. Settlement requires a single currency per trip.`,
    );
  }

  // Confidence: start at 1.0, subtract for each failed check
  let confidence = 1.0;
  if (!arithmeticOk) {
    // Larger mismatch → lower confidence
    const mismatchFraction = Math.min(
      arithmeticDeltaCents / Math.max(extraction.totalCents, 1),
      1,
    );
    confidence -= 0.4 + mismatchFraction * 0.3;
  }
  if (!currencyIsUsd) confidence -= 0.1;
  if (piiScrubbed) confidence -= 0.1;
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    sanitized,
    arithmeticOk,
    arithmeticDeltaCents,
    currencyIsUsd,
    confidence,
    warnings,
  };
}
