import { cn } from "@/lib/cn";
import { identityColor } from "@/lib/identityColors";
import { initialsOf } from "@/lib/initials";

interface AvatarProps {
  name: string;
  size?: "xs" | "sm" | "md";
  className?: string;
}

const sizeClasses = {
  // For the card face, where the row is 9px type and a 24px disc would set the
  // whole card's height.
  xs: "w-[18px] h-[18px] text-[8.5px]",
  sm: "w-6 h-6 text-[10px]",
  md: "w-8 h-8 text-xs",
};

export function Avatar({ name, size = "md", className }: AvatarProps) {
  return (
    <div
      title={name}
      style={{ background: identityColor(name) }}
      className={cn(
        "inline-flex items-center justify-center rounded-full text-white font-semibold shrink-0",
        sizeClasses[size],
        className
      )}
    >
      {initialsOf(name)}
    </div>
  );
}
