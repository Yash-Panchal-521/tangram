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
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-accent text-accent-fg font-semibold shrink-0",
        sizeClasses[size],
        className
      )}
    >
      {initials(name)}
    </div>
  );
}
