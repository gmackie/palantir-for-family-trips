/**
 * Consumption-rate learning — the core of VanState persistence. Given a
 * resource's level readings over time (from DriftPort telemetry or manual
 * entry), estimate the real %/day rate via linear regression, so predictive
 * service alerts use *your van's* actual behavior instead of the defaults.
 *
 * Pure — the daymap layer persists readings and calls this.
 */

export interface Reading {
  levelPct: number;
  /** ISO-8601 timestamp. */
  recordedAt: string;
}

const MS_PER_DAY = 86_400_000;
const MIN_SPAN_DAYS = 0.25; // need at least ~6h of history to trust a slope

/**
 * Least-squares slope of level vs. days → the consumption rate as a positive
 * %/day magnitude, or null when there's not enough signal (< 2 readings, no
 * time span, or the slope runs opposite to the expected direction — e.g. a
 * refill mid-window makes a "drain" look like a "fill").
 */
export function estimateRatePctPerDay(
  readings: Reading[],
  direction: "fill" | "drain",
): number | null {
  if (readings.length < 2) return null;

  const pts = readings
    .map((r) => ({ t: Date.parse(r.recordedAt), y: r.levelPct }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.y))
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2) return null;

  const t0 = pts[0]!.t;
  const xs = pts.map((p) => (p.t - t0) / MS_PER_DAY); // days since first
  const ys = pts.map((p) => p.y);
  const spanDays = xs[xs.length - 1]!;
  if (spanDays < MIN_SPAN_DAYS) return null;

  const n = xs.length;
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - meanX) * (ys[i]! - meanY);
    den += (xs[i]! - meanX) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den; // %/day (signed)

  // Fill should rise (slope > 0); drain should fall (slope < 0).
  const matches = direction === "fill" ? slope > 0 : slope < 0;
  if (!matches) return null;
  return Math.round(Math.abs(slope) * 10) / 10;
}

/**
 * Build a rates map (%/day) from per-resource reading histories, falling back
 * to `defaults` when a resource lacks enough history to learn from.
 */
export function learnRates(
  histories: Record<string, Reading[]>,
  directions: Record<string, "fill" | "drain">,
  defaults: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = { ...defaults };
  for (const [resource, readings] of Object.entries(histories)) {
    const dir = directions[resource];
    if (!dir) continue;
    const learned = estimateRatePctPerDay(readings, dir);
    if (learned != null && learned > 0) out[resource] = learned;
  }
  return out;
}
