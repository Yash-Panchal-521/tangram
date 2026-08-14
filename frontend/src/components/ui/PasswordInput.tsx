"use client";

import { InputHTMLAttributes, forwardRef, useId, useState } from "react";
import { cn } from "@/lib/cn";

// Matches Input's field styling so an unstyled PasswordInput sits alongside a
// plain Input without drifting.
const DEFAULT_FIELD_CLASSES =
  "w-full rounded-md border bg-surface px-3 py-2.5 text-sm text-text placeholder:text-text-dim transition-colors border-border focus-visible:border-accent";

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
  error?: string;
  // Replaces DEFAULT_FIELD_CLASSES outright rather than merging with it --
  // cn() is a plain join with no Tailwind conflict resolution, so appending a
  // second `rounded-*`/`px-*` would leave the winner up to stylesheet order.
  className?: string;
}

// A password field with a show/hide control. The toggle is a real focusable
// button (not tabIndex={-1}) so it's reachable by keyboard, and type="button"
// so it can never submit the surrounding form.
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const [visible, setVisible] = useState(false);
    const generatedId = useId();
    const inputId = id ?? generatedId;

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-xs font-medium text-text-muted">
            {label}
          </label>
        )}

        <div className="relative">
          <input
            ref={ref}
            id={inputId}
            type={visible ? "text" : "password"}
            className={cn(
              className ?? DEFAULT_FIELD_CLASSES,
              // Room for the "Show"/"Hide" word, which is wider than the icon it replaced.
              "pr-12",
              error && "border-danger"
            )}
            aria-invalid={Boolean(error)}
            {...props}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            disabled={props.disabled}
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
            title={visible ? "Hide password" : "Show password"}
            // A word, not an icon (v7). The eye had a hover fill and a radius,
            // which on an unboxed field put a small rounded box inside a field
            // whose whole point is not having one. "Show"/"Hide" also says which
            // way the control goes, where an eye leaves you to guess whether it
            // means "it is hidden" or "press to hide".
            //
            // Still a 24px target: the text is 10px but the button is not.
            className="absolute right-0 top-1/2 -translate-y-1/2 h-6 px-1 flex items-center text-[10px] font-medium uppercase tracking-[0.1em] text-text-dim hover:text-text transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {visible ? "Hide" : "Show"}
          </button>
        </div>

        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    );
  }
);
PasswordInput.displayName = "PasswordInput";
