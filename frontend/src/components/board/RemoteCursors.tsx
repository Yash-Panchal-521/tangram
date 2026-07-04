import type { CursorUpdate } from "@/lib/signalr";

export function RemoteCursors({ cursors }: { cursors: Record<string, CursorUpdate> }) {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
      {Object.values(cursors).map((cursor) => (
        <div
          key={cursor.userId}
          className="absolute flex flex-col items-start gap-0.5 transition-[left,top] duration-100 ease-linear"
          style={{ left: `${cursor.x}%`, top: `${cursor.y}%` }}
        >
          <svg width="16" height="20" viewBox="0 0 16 20" fill="none">
            <path
              d="M1 1L1 15L5 11.5L8 18L10.5 17L7.5 10.5L14 10.5Z"
              fill="white"
              stroke="rgba(0,0,0,0.35)"
              strokeWidth="1"
              strokeLinejoin="round"
            />
          </svg>
          <div className="bg-accent text-accent-fg text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ml-1 shadow-[0_2px_8px_rgba(0,0,0,0.18)]">
            {cursor.displayName}
          </div>
        </div>
      ))}
    </div>
  );
}
