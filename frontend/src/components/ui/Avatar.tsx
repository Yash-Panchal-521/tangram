import { cn } from "@/lib/cn";

interface AvatarProps {
  name: string;
  size?: "sm" | "md";
  className?: string;
}

const sizeClasses = {
  sm: "w-6 h-6 text-[10px]",
  md: "w-8 h-8 text-xs",
};

// Fixed hues rather than theme tokens, for the same reason BoardColumn's dot
// colours are fixed: these identify a *person*, so the colour must stay put
// across themes and modes. Every entry clears 4.5:1 against white, since the
// initials sit on top at 10-12px semibold.
// S1.2 documented exception: these identify a *person*, not a theme, so they
// must stay fixed across themes and modes. Every entry clears 4.5:1 against the
// white initials.
// eslint-disable-next-line no-restricted-syntax
const PALETTE = ["#AE3E2E", "#3F6B4A", "#3B5F92", "#6B4392", "#8A5A10", "#1F6B6E"];

// Deterministic, so one person keeps one colour on every render, in every list,
// for every viewer -- recognising someone at a glance is the entire point.
// Previously every avatar was the same accent red, which made a roster of five
// people five identical circles and presence avatars indistinguishable.
function colorFor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export function Avatar({ name, size = "md", className }: AvatarProps) {
  return (
    <div
      title={name}
      style={{ background: colorFor(name) }}
      className={cn(
        "inline-flex items-center justify-center rounded-full text-white font-semibold shrink-0",
        sizeClasses[size],
        className
      )}
    >
      {initials(name)}
    </div>
  );
}
