import { cn } from "@sortey/ui";
import { Separator } from "@sortey/ui/separator";

import { MemberChip, type MemberChipMember } from "./member-chip";

export type ExpenseShareRow = {
  userId: string;
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
};

export type ExpenseSharesPanelProps = {
  shares: readonly ExpenseShareRow[];
  warnings?: readonly string[];
  payerUserId: string;
  payerRoundingAbsorptionCents?: number;
  members?: readonly MemberChipMember[];
  currentUserId?: string;
  currency?: string;
  className?: string;
};

function formatCents(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function resolveMember(
  members: readonly MemberChipMember[],
  userId: string,
): MemberChipMember {
  return (
    members.find((m) => m.userId === userId) ?? {
      userId,
      displayName: null,
      colorHex: null,
    }
  );
}

/**
 * Per-member expense share breakdown with tax/tip proration detail.
 * Tax and tip are allocated automatically from subtotal share — users
 * never assign them directly.
 */
export function ExpenseSharesPanel({
  shares,
  warnings = [],
  payerUserId,
  payerRoundingAbsorptionCents = 0,
  members = [],
  currentUserId,
  currency = "USD",
  className,
}: ExpenseSharesPanelProps) {
  return (
    <section className={cn("bg-card rounded-3xl border p-6", className)}>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Shares</h2>
        <p className="text-muted-foreground text-xs">
          Tax and tip are prorated by each member&apos;s subtotal share.
        </p>
      </div>

      {warnings.length > 0 && (
        <div className="mt-3 space-y-1">
          {warnings.map((warning) => (
            <p key={warning} className="text-xs text-[#D29922]">
              {warning}
            </p>
          ))}
        </div>
      )}

      {shares.length === 0 ? (
        <p className="text-muted-foreground mt-4 text-sm">
          No shares computed yet.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {shares.map((share) => {
            const member = resolveMember(members, share.userId);
            const label =
              share.userId === currentUserId
                ? "You"
                : (member.displayName ?? `${share.userId.slice(0, 8)}…`);

            return (
              <div
                key={share.userId}
                className="flex items-center justify-between gap-3 rounded-xl border p-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <MemberChip member={member} label={label} />
                    {share.userId === payerUserId && (
                      <span className="text-muted-foreground text-xs">
                        payer
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground font-mono text-xs tabular-nums">
                    Sub {formatCents(share.subtotalCents, currency)} + Tax{" "}
                    {formatCents(share.taxCents, currency)} + Tip{" "}
                    {formatCents(share.tipCents, currency)}
                  </p>
                </div>
                <p className="shrink-0 text-base font-bold font-mono tabular-nums">
                  {formatCents(share.totalCents, currency)}
                </p>
              </div>
            );
          })}

          {payerRoundingAbsorptionCents !== 0 && (
            <>
              <Separator />
              <p className="text-muted-foreground font-mono text-xs tabular-nums">
                Payer absorbs{" "}
                {formatCents(payerRoundingAbsorptionCents, currency)} in
                rounding
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
