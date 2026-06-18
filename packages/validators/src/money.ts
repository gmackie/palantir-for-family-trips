// Shared money formatting. Amounts are stored as integer minor units (cents);
// these render them for display. Used by nextjs, expo, and api so currency
// formatting stays consistent everywhere.

/**
 * Format integer cents as a localized currency string, e.g.
 * `formatMoney(3578)` → "$35.78", `formatMoney(3578, "EUR")` → "€35.78".
 */
export function formatMoney(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

/**
 * Format integer cents as a bare decimal string with no currency symbol, e.g.
 * `formatCents(3578)` → "35.78". For form inputs / amount fields where the
 * symbol is shown separately.
 */
export function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}
