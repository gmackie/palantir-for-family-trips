import { cn } from "@sortey/ui";

export type GroupModeToggleProps = {
  /** Current value when controlled. Omit for uncontrolled forms. */
  value?: boolean;
  /** Default for uncontrolled forms (native radio/checkbox). */
  defaultValue?: boolean;
  /** Called when the user changes the selection (client components only). */
  onChange?: (groupMode: boolean) => void;
  /** Field name for form posts. Defaults to "groupMode". */
  name?: string;
  /** Disable interaction (e.g. non-organizers). */
  disabled?: boolean;
  /**
   * `cards` — two-option Family vs Group selector (create flow).
   * `switch` — compact checkbox with description (settings).
   */
  variant?: "cards" | "switch";
  className?: string;
  id?: string;
};

/**
 * Orthogonal to trip mode (destination vs roadtrip).
 * Group mode unlocks shared members, expenses, and settlement.
 * Family mode keeps the solo/family dashboard without expense splitting.
 */
export function GroupModeToggle({
  value,
  defaultValue = false,
  onChange,
  name = "groupMode",
  disabled = false,
  variant = "cards",
  className,
  id = "groupMode",
}: GroupModeToggleProps) {
  const isControlled = value !== undefined;
  const effective = isControlled ? value : defaultValue;

  if (variant === "switch") {
    return (
      <label
        htmlFor={id}
        className={cn(
          "flex items-start gap-3 text-sm",
          disabled && "cursor-not-allowed opacity-50",
          !disabled && "cursor-pointer",
          className,
        )}
      >
        <input
          id={id}
          name={name}
          type="checkbox"
          value="on"
          disabled={disabled}
          className="mt-0.5 accent-primary"
          {...(isControlled
            ? {
                checked: effective,
                onChange: (e: { target: { checked: boolean } }) =>
                  onChange?.(e.target.checked),
              }
            : { defaultChecked: defaultValue })}
        />
        <span className="space-y-1">
          <span className="block font-medium">Group mode</span>
          <span className="text-muted-foreground block text-xs leading-relaxed">
            Enable shared members, expense claims, and settlement for this trip.
            Leave off for a solo/family dashboard without splitting.
          </span>
        </span>
      </label>
    );
  }

  const options = [
    {
      value: false,
      label: "Family",
      description:
        "Solo or household trip. Simple dashboard — no expense splitting.",
    },
    {
      value: true,
      label: "Group",
      description:
        "Shared members, receipt claims, and who-owes-whom settlement.",
    },
  ] as const;

  return (
    <div
      role="radiogroup"
      aria-label="Group or family mode"
      className={cn("flex flex-col gap-3 sm:flex-row", className)}
    >
      {options.map((option) => {
        const selected = effective === option.value;
        const optionId = `${id}-${option.value ? "group" : "family"}`;
        return (
          <label
            key={option.label}
            htmlFor={optionId}
            className={cn(
              "flex flex-1 cursor-pointer items-start gap-3 rounded-md border px-4 py-3 transition-colors",
              selected
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground/40",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            <input
              id={optionId}
              type="radio"
              name={name}
              value={option.value ? "true" : "false"}
              disabled={disabled}
              className="mt-1 accent-primary"
              {...(isControlled
                ? {
                    checked: selected,
                    onChange: () => onChange?.(option.value),
                  }
                : { defaultChecked: defaultValue === option.value })}
            />
            <span className="space-y-1">
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="text-muted-foreground block text-xs leading-relaxed">
                {option.description}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
