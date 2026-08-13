import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClasses: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-h",
  secondary: "bg-surface text-text border border-border hover:bg-surface-2",
  ghost: "bg-transparent text-text-muted hover:bg-surface-2 hover:text-text",
  // Each filled role owns its foreground. This borrowed `--accent-fg` — a value
  // defined against a different background, correct here only by luck, and it
  // measured 4.28:1 in Terracotta dark. Exactly the mistake the hardcoded white
  // made before palettes were switchable, one role over.
  //
  // The hover darkens the fill rather than fading the whole button: `opacity-90`
  // faded the label with it, which is S1.2b's instinct — do not dilute a correct
  // colour to make it subtler — applied to a control.
  danger: "bg-danger text-danger-fg hover:bg-danger-h",
};

const sizeClasses: Record<Size, string> = {
  sm: "text-xs px-2.5 py-1.5 gap-1.5",
  md: "text-sm px-4 py-2.5 gap-2",
};

const baseClasses =
  "inline-flex items-center justify-center rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";

/**
 * The same look, for something that has to be a real `<a>`.
 *
 * A navigation rendered as a button loses middle-click, open-in-new-tab and the
 * link semantics a screen reader announces. Exported rather than copied because
 * `cn()` does no Tailwind conflict resolution — a hand-rolled duplicate drifts
 * silently the first time a class here changes.
 */
export function buttonClasses(
  { variant = "primary", size = "md" }: { variant?: Variant; size?: Size } = {},
  className?: string
) {
  return cn(baseClasses, variantClasses[variant], sizeClasses[size], className);
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button ref={ref} className={buttonClasses({ variant, size }, className)} {...props} />
  )
);
Button.displayName = "Button";
