import { Avatar } from "@/components/ui/Avatar";
import { PriorityIcon } from "@/components/ui/PriorityIcon";
import { LabelChip } from "@/components/ui/LabelChip";
import { dueLabel, dueStatus } from "@/lib/dueDate";
import type { CardResponse } from "@/lib/api";

const DUE_TONE: Record<string, string> = {
  overdue: "bg-danger/10 text-danger border-danger/30",
  today: "bg-warn/10 text-warn border-warn/30",
  soon: "bg-surface-2 text-text-muted border-border",
  later: "bg-surface-2 text-text-dim border-border",
};

/**
 * `draggable` only controls the grip — the drag itself is wired up by
 * SortableKanbanCard, which owns the `group` this reveals against. Viewers and
 * the drag overlay pass false: one can't drag, the other is already mid-drag.
 */
export function KanbanCard({
  card,
  draggable = false,
  pending = false,
  assigneeName = null,
}: {
  card: Pick<CardResponse, "title" | "description"> &
    Partial<Pick<CardResponse, "dueAt" | "assigneeId" | "priority" | "labels" | "commentCount">>;
  draggable?: boolean;
  pending?: boolean;
  /** Resolves an assignee id to a name. Anyone who has left the workspace
   *  simply doesn't resolve, and the card reads as unassigned. */
  assigneeName?: string | null;
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

      {/* Above the title, not below it. A label says what *kind* of work this
          is, which frames the title rather than qualifying it — and putting
          them at the bottom would push them under the due pill where they
          compete with it for the same glance. */}
      {card.labels && card.labels.length > 0 && (
        <div className={`flex flex-wrap gap-1 ${draggable ? "pr-5" : ""}`}>
          {card.labels.map((l) => (
            <LabelChip key={l.id} label={l} size="sm" />
          ))}
        </div>
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

      {(card.dueAt || assigneeName || card.priority || (card.commentCount ?? 0) > 0) && (
        <div className="flex items-center gap-2 pt-0.5">
          {/* Ahead of the due pill: how urgent something is changes whether you
              care about its deadline, so it is read first. Icon only -- a word
              would cost the width the title needs, and the icon carries its own
              label for anyone not reading shapes. */}
          {card.priority && <PriorityIcon priority={card.priority} size={13} />}
          {/* Only when there are some. A "0" on every card would be noise on
              the one row where width is scarcest, and the absence of the icon
              already says the same thing. */}
          {(card.commentCount ?? 0) > 0 && (
            <span
              className="inline-flex items-center gap-1 text-[11px] text-text-dim"
              title={`${card.commentCount} comment${card.commentCount === 1 ? "" : "s"}`}
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path
                  d="M10.5 7.5a1 1 0 0 1-1 1H4L1.5 10.5V2.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
              </svg>
              {card.commentCount}
              {/* The number alone reads as a quantity of nothing in particular
                  to a screen reader, which never sees the speech bubble. */}
              <span className="sr-only"> comments</span>
            </span>
          )}
          {card.dueAt && (
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium ${
                DUE_TONE[dueStatus(card.dueAt)]
              }`}
            >
              <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <rect x="1.5" y="2.5" width="9" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                <path d="M1.5 5h9M4 1.5v2M8 1.5v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              {/* The status is carried by colour, so it is also said in words --
                  "2d late" reads the same to everyone. */}
              {dueLabel(card.dueAt)}
            </span>
          )}
          <div className="flex-1" />
          {assigneeName && <Avatar name={assigneeName} size="sm" />}
        </div>
      )}

      {pending && <span className="text-[11px] text-text-dim">Adding…</span>}
    </div>
  );
}
