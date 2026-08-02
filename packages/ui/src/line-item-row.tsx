"use client";

import { cn } from "@sortey/ui";
import { Button } from "@sortey/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@sortey/ui/dropdown-menu";
import { useState } from "react";

import { MemberChip, type MemberChipMember } from "./member-chip";

export type LineItemRowItem = {
  id: string;
  name: string;
  quantity: string | number;
  unitPriceCents: number;
  lineTotalCents: number;
  claimantUserIds: readonly string[];
};

export type LineItemRowProps = {
  item: LineItemRowItem;
  members: readonly MemberChipMember[];
  claimMode: "tap" | "organizer";
  /** Current signed-in user. */
  currentUserId: string;
  /** User whose claim tap mode toggles (pass-the-phone). Defaults to currentUserId. */
  actingUserId?: string;
  isOrganizer?: boolean;
  /** Draft expenses show remove affordance instead of claim UI. */
  isDraft?: boolean;
  currency?: string;
  pending?: boolean;
  onToggleClaim?: (lineItemId: string, currentlyClaimed: boolean) => void;
  onAssign?: (lineItemId: string, userIds: string[]) => void;
  onRemove?: (lineItemId: string) => void;
  className?: string;
};

function formatCents(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function memberLabel(
  members: readonly MemberChipMember[],
  userId: string,
  currentUserId: string,
) {
  if (userId === currentUserId) return "You";
  const member = members.find((m) => m.userId === userId);
  return member?.displayName ?? `${userId.slice(0, 8)}…`;
}

export function LineItemRow({
  item,
  members,
  claimMode,
  currentUserId,
  actingUserId,
  isOrganizer = false,
  isDraft = false,
  currency = "USD",
  pending = false,
  onToggleClaim,
  onAssign,
  onRemove,
  className,
}: LineItemRowProps) {
  const actorId = actingUserId ?? currentUserId;
  const isClaimedByActor = item.claimantUserIds.includes(actorId);
  const claimCount = item.claimantUserIds.length;
  const isShared = claimCount > 1;

  const [assignOpen, setAssignOpen] = useState(false);
  const [draftAssignees, setDraftAssignees] = useState<string[]>([
    ...item.claimantUserIds,
  ]);

  function applyAssignment() {
    onAssign?.(item.id, draftAssignees);
    setAssignOpen(false);
  }

  const quantity = Number(item.quantity);
  const priceDetail =
    quantity > 1
      ? `${quantity} × ${formatCents(item.unitPriceCents, currency)}`
      : null;

  const claimantChips = (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {item.claimantUserIds.map((userId) => {
        const member = members.find((m) => m.userId === userId) ?? {
          userId,
          displayName: null,
          colorHex: null,
        };
        return (
          <MemberChip
            key={userId}
            member={member}
            label={memberLabel(members, userId, currentUserId)}
          />
        );
      })}
      {isShared && (
        <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
          split {claimCount} ways
        </span>
      )}
    </div>
  );

  if (isDraft) {
    return (
      <div
        className={cn(
          "flex min-h-11 items-center gap-3 rounded-xl border p-3",
          className,
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{item.name}</p>
          <p className="text-muted-foreground font-mono text-xs tabular-nums">
            {formatCents(item.lineTotalCents, currency)}
            {priceDetail ? ` · ${priceDetail}` : ""}
          </p>
        </div>
        {onRemove && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRemove(item.id)}
            disabled={pending}
          >
            Remove
          </Button>
        )}
      </div>
    );
  }

  const showTapMode = claimMode === "tap";
  const showOrganizerAssign = claimMode === "organizer" && isOrganizer;

  if (showTapMode) {
    return (
      <button
        type="button"
        disabled={pending || !onToggleClaim}
        onClick={() => onToggleClaim?.(item.id, isClaimedByActor)}
        className={cn(
          "flex min-h-11 w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors",
          isClaimedByActor
            ? "border-[#3FB950]/40 bg-[#3FB950]/10"
            : claimCount > 0
              ? "border-[#58A6FF]/30 bg-[#58A6FF]/5"
              : "hover:border-muted-foreground/30",
          pending && "opacity-60",
          className,
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{item.name}</p>
          <p className="text-muted-foreground font-mono text-xs tabular-nums">
            {formatCents(item.lineTotalCents, currency)}
            {priceDetail ? ` · ${priceDetail}` : ""}
          </p>
        </div>
        <div className="shrink-0">
          {claimCount > 0 ? (
            claimantChips
          ) : (
            <span className="text-muted-foreground text-xs">Tap to claim</span>
          )}
        </div>
      </button>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-11 flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center",
        claimCount > 0 && "border-[#58A6FF]/30 bg-[#58A6FF]/5",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.name}</p>
        <p className="text-muted-foreground font-mono text-xs tabular-nums">
          {formatCents(item.lineTotalCents, currency)}
          {priceDetail ? ` · ${priceDetail}` : ""}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {claimCount > 0 && claimantChips}

        {showOrganizerAssign && onAssign && (
          <DropdownMenu
            open={assignOpen}
            onOpenChange={(open) => {
              if (open) setDraftAssignees([...item.claimantUserIds]);
              setAssignOpen(open);
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={pending}>
                Assign
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Assign to members</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {members.map((member) => {
                const checked = draftAssignees.includes(member.userId);
                return (
                  <DropdownMenuCheckboxItem
                    key={member.userId}
                    checked={checked}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={(next) => {
                      setDraftAssignees((prev) => {
                        if (next) return [...prev, member.userId];
                        return prev.filter((id) => id !== member.userId);
                      });
                    }}
                  >
                    {memberLabel(members, member.userId, currentUserId)}
                  </DropdownMenuCheckboxItem>
                );
              })}
              <DropdownMenuSeparator />
              <div className="p-1">
                <Button
                  size="sm"
                  className="w-full"
                  disabled={pending}
                  onClick={applyAssignment}
                >
                  Save ({draftAssignees.length})
                </Button>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
