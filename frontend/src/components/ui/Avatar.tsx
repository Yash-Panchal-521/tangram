import { cn } from "@/lib/cn";
import { identityColor } from "@/lib/identityColors";
import { initialsOf } from "@/lib/initials";

interface AvatarProps {
  name: string;
  size?: "sm" | "md";
  className?: string;
}

const sizeClasses = {
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
