import type { CardResponse } from "@/lib/api";

/**
 * `draggable` only controls the grip — the drag itself is wired up by
 * SortableKanbanCard, which owns the `group` this reveals against. Viewers and
 * the drag overlay pass false: one can't drag, the other is already mid-drag.
 */
export function KanbanCard({
  card,
  draggable = false,
  pending = false,
}: {
  card: Pick<CardResponse, "title" | "description">;
  draggable?: boolean;
  pending?: boolean;
}) {
  return (
    <div
      className={`relative bg-surface border rounded-[8px] p-3.5 flex flex-col gap-2 transition-shadow ${
        pending
          ? "border-dashed border-border-2 opacity-60"
          : "border-border hover:shadow-[0_3px_14px_rgba(0,0,0,0.08)] hover:border-border-2"
      }`}
    >
      {draggable && (
        // Hover alone said "draggable" only through the cursor, which is
        // invisible until you are already over the card. Revealed on
        // group-focus-visible too, so a keyboard user sees the same hint at the
        // moment the drag keys become live.
        <span
          aria-hidden="true"
          className="absolute top-2.5 right-2.5 text-text-dim opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <circle cx="3" cy="2" r="1" />
            <circle cx="7" cy="2" r="1" />
            <circle cx="3" cy="5" r="1" />
            <circle cx="7" cy="5" r="1" />
            <circle cx="3" cy="8" r="1" />
            <circle cx="7" cy="8" r="1" />
          </svg>
        </span>
      )}

      {/* Clamped: a card is a summary. Before this, one long paragraph grew a
          card tall enough to push everything below it out of the column. */}
      <p
        className={`text-[13px] font-medium leading-snug line-clamp-3 ${draggable ? "pr-5" : ""}`}
      >
        {card.title}
      </p>
      {card.description && (
        <p className="text-xs text-text-muted leading-snug line-clamp-2">{card.description}</p>
      )}

      {pending && <span className="text-[11px] text-text-dim">Adding…</span>}
    </div>
  );
}
