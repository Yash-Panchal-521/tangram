import { Avatar } from "@/components/ui/Avatar";
import type { PresenceUser } from "@/lib/signalr";

const MAX_VISIBLE = 4;

export function PresenceAvatars({ users }: { users: PresenceUser[] }) {
  if (users.length === 0) return null;

  const visible = users.slice(0, MAX_VISIBLE);
  const overflow = users.length - visible.length;

  return (
    <div className="flex items-center">
      {visible.map((u, i) => (
        <div key={u.userId} style={{ marginLeft: i === 0 ? 0 : -7 }} className="shrink-0">
          <Avatar name={u.displayName} size="sm" className="border-2 border-surface" />
        </div>
      ))}
      {overflow > 0 && (
        <div
          style={{ marginLeft: -7 }}
          className="w-6 h-6 rounded-full bg-surface-2 border-2 border-surface flex items-center justify-center text-[10px] font-semibold text-text-muted shrink-0"
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}
