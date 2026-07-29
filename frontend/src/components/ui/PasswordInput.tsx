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

function EyeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M1 7s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="7" r="1.75" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M5.7 3.2A6.3 6.3 0 0 1 7 3c3.8 0 6 4 6 4a11.7 11.7 0 0 1-2 2.4M3.3 4.4A11.4 11.4 0 0 0 1 7s2.2 4 6 4a6.2 6.2 0 0 0 2.2-.4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M2 2L12 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
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
              // Room for the toggle so long values don't run underneath it.
              "pr-10",
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
            className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center w-8 h-8 rounded-md text-text-dim hover:text-text hover:bg-surface-2 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {visible ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>

        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    );
  }
);
PasswordInput.displayName = "PasswordInput";
