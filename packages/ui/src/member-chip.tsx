import { cn } from "@sortey/ui";

export type MemberChipMember = {
  userId: string;
  displayName: string | null;
  colorHex: string | null;
};

export type MemberChipProps = {
  member: MemberChipMember;
  /** Override display label (e.g. "You"). */
  label?: string;
  className?: string;
};

const DEFAULT_COLOR = "#58A6FF";

/**
 * Compact chip showing a trip member's color and name.
 * Used on line-item rows to show who claimed an item.
 */
export function MemberChip({ member, label, className }: MemberChipProps) {
  const color = member.colorHex ?? DEFAULT_COLOR;
  const name = label ?? member.displayName ?? `${member.userId.slice(0, 8)}…`;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
        className,
      )}
      style={{
        backgroundColor: `${color}18`,
        borderColor: `${color}44`,
        color,
      }}
    >
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      {name}
    </span>
  );
}
