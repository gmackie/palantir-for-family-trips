// Shared command-center primitives for the trip/planning routes.
//
// Consolidates the repeated panel / empty-state / error-banner markup onto the
// Palantir system in DESIGN.md: #161B22 surface, #21262D borders, sharp 4px
// radii, NO decorative shadow, all-caps section eyebrows, left-aligned
// operational empty states, dark semantic critical banner. Use these instead of
// hand-rolling `bg-card rounded-2xl` cards or centered dashed empties.

import type { ReactNode } from "react";

import { cn } from "@sortey/ui";

/** A flat command-center panel (replaces `bg-card rounded-2xl border`). */
export function CommandPanel(props: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[4px] border border-[#21262D] bg-[#161B22] p-4",
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}

/** All-caps section eyebrow (the dashboard's section-label treatment). */
export function PanelEyebrow(props: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]",
        props.className,
      )}
    >
      {props.children}
    </p>
  );
}

/**
 * Left-aligned operational empty state (replaces centered dashed `text-center`
 * empties). Optional `action` renders inline (e.g. an "Add" button/link).
 */
export function EmptyState(props: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-[4px] border border-[#21262D] bg-[#161B22] p-4",
        props.className,
      )}
    >
      <p className="text-sm text-[#8B949E]">{props.children}</p>
      {props.action}
    </div>
  );
}

/** Dark critical banner for inline errors (replaces light `bg-red-50` banners). */
export function ErrorBanner(props: { children: ReactNode; className?: string }) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-[4px] border border-[#F85149]/30 bg-[#F85149]/10 p-3 text-sm text-[#F85149]",
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}
