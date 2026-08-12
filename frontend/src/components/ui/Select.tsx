import { SelectHTMLAttributes, forwardRef, useId } from "react";
import { cn } from "@/lib/cn";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  /**
   * `quiet` is the card detail's context column: compact, and no border until
   * you are over it or in it.
   *
   * A variant rather than extra classes from the call site, because `cn()` is a
   * plain join with no Tailwind conflict resolution (S1.3) — appending
   * `border-transparent` after `border-border` leaves the winner to stylesheet
   * order, which is not a decision anyone made. Five bordered boxes stacked in a
   * narrow column read as five things to fill in; the values are what should
   * carry the weight there.
   */
  variant?: "default" | "quiet";
  /**
   * Rendered inside the field, before the value — a priority icon, a colour
   * swatch.
   *
   * A slot rather than a sibling because a native `<select>` cannot draw
   * anything in its options, and an icon placed *beside* the control pushes it
   * right: one row in a column of five then starts at a different x, which is
   * the ragged edge the context column exists to avoid. Inside, the control
   * keeps its left edge and gains left padding to clear the icon.
   */
  leading?: React.ReactNode;
}

const VARIANTS = {
  default: "bg-surface pr-8 py-2.5 text-sm border-border focus-visible:border-accent",
  quiet:
    "bg-transparent pr-7 py-1 text-[13px] border-transparent hover:bg-surface hover:border-border focus-visible:bg-surface focus-visible:border-accent",
} as const;

// Padding-left belongs to the (variant, leading) pair, so it is picked here
// rather than appended at the call site -- `cn()` would not resolve the clash.
const PADDING = {
  default: { bare: "pl-3", leading: "pl-8" },
  quiet: { bare: "pl-2", leading: "pl-7" },
} as const;

// Token-styled native select. Native rather than a custom listbox so keyboard
// and mobile behaviour come for free; the chevron is drawn separately because
// appearance-none removes the platform one.
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, id, variant = "default", leading, children, ...props }, ref) => {
    const generatedId = useId();
    const selectId = id ?? generatedId;

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={selectId} className="text-xs font-medium text-text-muted">
            {label}
          </label>
        )}

        <div className="relative">
          {leading && (
            <span
              aria-hidden="true"
              className={cn(
                "absolute top-1/2 -translate-y-1/2 pointer-events-none flex items-center",
                variant === "quiet" ? "left-2" : "left-2.5"
              )}
            >
              {leading}
            </span>
          )}
          <select
            ref={ref}
            id={selectId}
            className={cn(
              "w-full appearance-none rounded-md border text-text transition-colors cursor-pointer",
              VARIANTS[variant],
              PADDING[variant][leading ? "leading" : "bare"],
              error && "border-danger",
              className
            )}
            aria-invalid={Boolean(error)}
            {...props}
          >
            {children}
          </select>
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            aria-hidden="true"
            className={cn(
              "absolute top-1/2 -translate-y-1/2 pointer-events-none text-text-dim",
              variant === "quiet" ? "right-2" : "right-3"
            )}
          >
            <path
              d="M2 4L5 7L8 4"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    );
  }
);
Select.displayName = "Select";
