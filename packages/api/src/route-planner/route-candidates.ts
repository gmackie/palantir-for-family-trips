/**
 * Dual-candidate route labeling for road-trip planning.
 *
 * Google Routes may return alternatives; we rank and label them so the UI can
 * present "Primary" vs "Shorter" / "Scenic (west)" without inventing geometry.
 */

export interface RouteCandidateInput {
  distanceMiles: number;
  durationMinutes: number;
  /** Sample points along the route for geography heuristics (optional). */
  samplePoints?: Array<{ lat: number; lng: number }>;
  encodedPolyline?: string;
}

export interface LabeledRouteCandidate extends RouteCandidateInput {
  id: string;
  label: string;
  rank: number;
  /** Why this label was chosen (for UI subtitle). */
  reason: string;
}

/**
 * Label and rank 1–N routes. First input is treated as the API primary.
 * Heuristics:
 * - Shortest distance → "Shorter"
 * - If midpoints differ by >0.4° longitude, westerner → "Coastal bias", easterner → "Inland bias"
 * - Otherwise secondary → "Alternate"
 */
export function labelRouteCandidates(
  routes: RouteCandidateInput[],
): LabeledRouteCandidate[] {
  if (routes.length === 0) return [];

  const withMeta = routes.map((r, i) => {
    const midLng = midpointLng(r.samplePoints);
    return { ...r, index: i, midLng };
  });

  const minMiles = Math.min(...withMeta.map((r) => r.distanceMiles));
  const lngs = withMeta
    .map((r) => r.midLng)
    .filter((v): v is number => v != null);
  const hasCoastSplit =
    lngs.length >= 2 && Math.max(...lngs) - Math.min(...lngs) >= 0.4;

  const labeled: LabeledRouteCandidate[] = withMeta.map((r) => {
    let label = r.index === 0 ? "Primary" : "Alternate";
    let reason =
      r.index === 0
        ? "Default Google route"
        : "Alternative returned by Directions";

    if (r.index > 0 && r.distanceMiles <= minMiles + 0.05) {
      label = "Shorter";
      reason = "Lowest distance among candidates";
    } else if (hasCoastSplit && r.midLng != null) {
      const west = Math.min(...lngs);
      const east = Math.max(...lngs);
      if (r.midLng <= west + 0.05) {
        label = r.index === 0 ? "Primary · coastal" : "Coastal bias";
        reason = "Route midpoint is farther west";
      } else if (r.midLng >= east - 0.05) {
        label = r.index === 0 ? "Primary · inland" : "Inland bias";
        reason = "Route midpoint is farther east";
      }
    }

    return {
      id: `candidate-${r.index}`,
      label,
      rank: r.index,
      reason,
      distanceMiles: r.distanceMiles,
      durationMinutes: r.durationMinutes,
      samplePoints: r.samplePoints,
      encodedPolyline: r.encodedPolyline,
    };
  });

  // Prefer shorter as rank 0 only when it is substantially shorter (>5%).
  const primary = labeled[0]!;
  const shorter = labeled.find((c) => c.label === "Shorter");
  if (
    shorter &&
    shorter.id !== primary.id &&
    shorter.distanceMiles < primary.distanceMiles * 0.95
  ) {
    return labeled
      .map((c) =>
        c.id === shorter.id
          ? { ...c, rank: 0 }
          : c.id === primary.id
            ? { ...c, rank: 1 }
            : c,
      )
      .sort((a, b) => a.rank - b.rank);
  }

  return labeled;
}

function midpointLng(
  points: Array<{ lat: number; lng: number }> | undefined,
): number | null {
  if (!points || points.length === 0) return null;
  const mid = points[Math.floor(points.length / 2)]!;
  return mid.lng;
}
