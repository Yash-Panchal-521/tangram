import { SelectHTMLAttributes, forwardRef, useId } from "react";
import { cn } from "@/lib/cn";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
}

// Token-styled native select. Native rather than a custom listbox so keyboard
// and mobile behaviour come for free; the chevron is drawn separately because
// appearance-none removes the platform one.
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, id, children, ...props }, ref) => {
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
          <select
            ref={ref}
            id={selectId}
            className={cn(
              "w-full appearance-none rounded-md border bg-surface pl-3 pr-8 py-2.5 text-sm text-text transition-colors cursor-pointer",
              "border-border focus-visible:border-accent",
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
            className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-text-dim"
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
