/**
 * Reality replan presets — pure + thin DB for preview.
 * Apply is handled by planItinerary / applyDraft on the router.
 */

import type { DayPlanDraft } from "./day-plan";
import { replanDraft } from "./day-plan";
import { listDays } from "./day-plan-ops";
import { listAnchors } from "./anchor-ops";

export type ReplanReason = "behind" | "side_trip" | "stayed" | "manual";
export type ReplanMode = "soft_days" | "soft_route";

export interface ReplanPreview {
  reason: ReplanReason;
  mode: ReplanMode;
  fromDate: string;
  draftDays: DayPlanDraft[];
  keptPastDays: number;
  nextAnchor: { title: string; startDate: string } | null;
  warnings: string[];
  summary: string;
  proposedLegs: Array<{
    fromName: string;
    toName: string;
    date: string;
  }>;
}

function addDays(date: string, n: number): string {
  const t = Date.parse(`${date}T12:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Build a replan preview for UI. Does not write.
 * soft_days: replanDraft intents between fromDate and day before next anchor.
 * soft_route: same draft list + summary; apply uses planItinerary fromDate.
 */
export async function buildReplanPreview(
  // biome-ignore lint/suspicious/noExplicitAny: db
  db: any,
  p: {
    tripId: string;
    reason: ReplanReason;
    fromDate?: string;
    mode?: ReplanMode;
    origin?: { lat: number; lng: number; name?: string };
  },
): Promise<ReplanPreview> {
  const mode = p.mode ?? "soft_route";
  const today = new Date().toISOString().slice(0, 10);
  let fromDate = p.fromDate ?? today;

  if (p.reason === "stayed") {
    // Start rewriting tomorrow — today already "spent"
    fromDate = addDays(fromDate, 1);
  }

  const days = await listDays(db, p.tripId);
  const keptPastDays = days.filter((d) => d.date < fromDate).length;
  const anchors = await listAnchors(db, p.tripId);
  const nextAnchor = anchors.find((a) => (a.startDate as string) >= fromDate) as
    | { title: string; startDate: string }
    | undefined;

  const untilDate =
    nextAnchor != null
      ? addDays(nextAnchor.startDate as string, -1)
      : days[days.length - 1]?.date ?? addDays(fromDate, 7);

  const warnings: string[] = [];
  if (nextAnchor) {
    warnings.push(
      `${nextAnchor.title} on ${nextAnchor.startDate} is immovable (anchor).`,
    );
  }
  if (untilDate < fromDate) {
    warnings.push("No flexible days before next anchor — nothing to replan.");
  }

  // Preserve curated future day titles as must-visits where possible
  const future = days.filter((d) => d.date >= fromDate && d.date <= untilDate);
  const mustVisits = future
    .filter((d) => d.title && d.intent !== "drive")
    .map((d) => ({
      name: d.title!,
      nights: 1,
      intent: d.intent as "play" | "event" | "position" | "recovery",
      heroTitle: d.heroTitle ?? undefined,
      heroDetail: d.heroDetail ?? undefined,
      overnightKind: (d.overnightKind as "unknown") ?? undefined,
      cutIfBehind: d.cutIfBehind ?? undefined,
    }));

  const draftDays =
    untilDate >= fromDate
      ? replanDraft({
          fromDate,
          untilDate,
          mustVisits: mustVisits.length > 0 ? mustVisits : undefined,
          defaultOvernightKind: "unknown",
        })
      : [];

  // For stayed: if shift would help, bump titles from old future onto new dates
  if (p.reason === "stayed" && future.length > 0 && draftDays.length > 0) {
    for (let i = 0; i < draftDays.length && i < future.length; i++) {
      const src = future[i]!;
      draftDays[i] = {
        ...draftDays[i]!,
        title: src.title,
        intent: src.intent as DayPlanDraft["intent"],
        overnightName: src.overnightName,
        overnightKind: src.overnightKind as DayPlanDraft["overnightKind"],
        heroTitle: src.heroTitle,
        heroDetail: src.heroDetail,
        cutIfBehind: src.cutIfBehind,
      };
    }
  }

  const proposedLegs: ReplanPreview["proposedLegs"] = [];
  for (let i = 0; i < draftDays.length; i++) {
    const d = draftDays[i]!;
    const prev =
      i === 0
        ? (p.origin?.name ?? "Current position")
        : (draftDays[i - 1]!.title ?? draftDays[i - 1]!.date);
    proposedLegs.push({
      fromName: prev,
      toName: d.title ?? d.date,
      date: d.date,
    });
  }

  const summaryParts = [
    `Replan (${p.reason}, ${mode}) from ${fromDate}`,
    nextAnchor
      ? `until before ${nextAnchor.title} (${nextAnchor.startDate})`
      : "to trip end",
    `· ${draftDays.length} day(s)`,
    p.origin ? `· origin GPS` : "",
  ];

  return {
    reason: p.reason,
    mode,
    fromDate,
    draftDays,
    keptPastDays,
    nextAnchor: nextAnchor
      ? { title: nextAnchor.title, startDate: nextAnchor.startDate }
      : null,
    warnings,
    summary: summaryParts.filter(Boolean).join(" "),
    proposedLegs,
  };
}
