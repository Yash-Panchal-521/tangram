import { labelSwatchStyle } from "@/lib/labelColors";
import { dueLabel, dueStatus } from "@/lib/dueDate";
import { NO_PRIORITY_TICK, PRIORITY_FACE } from "@/lib/priority";
import { relativeTime } from "@/lib/relativeTime";
import { initialsOf } from "@/lib/initials";
import type { CardResponse } from "@/lib/api";

const DUE_TONE: Record<string, string> = {
  overdue: "bg-danger-soft text-danger",
  today: "bg-warn-soft text-warn",
  soon: "bg-surface-2 text-text-muted",
  later: "bg-surface-2 text-text-dim",
};

/**
 * A card, as the board draws it.
 *
 * Three rows, and the order is the argument. Meta first — how urgent, what
 * kind, whose — because those decide whether the title is worth reading at all.
 * Then the title. Then the timing, which only matters once you have decided to
 * care.
 *
 * Everything here is words rather than ornament: the priority is spelled out
 * instead of drawn as chevrons, labels are set in micro-caps instead of filled
 * pills, and the assignee is initials rather than a coloured disc. At this size
 * a filled shape reads as decoration and costs the width the title needs, while
 * the same information as text survives being small. Colour is still present —
 * on the badge, on the label, on the card's leading edge — but never carrying
 * meaning alone (S1.2).
 *
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
    Partial<
      Pick<
        CardResponse,
        "dueAt" | "assigneeId" | "priority" | "labels" | "commentCount" | "updatedAt"
      >
    >;
  draggable?: boolean;
  pending?: boolean;
  /** Resolves an assignee id to a name. Anyone who has left the workspace
   *  simply doesn't resolve, and the card reads as unassigned. */
  assigneeName?: string | null;
}) {
  const face = card.priority ? PRIORITY_FACE[card.priority] : null;
  const hasMeta = Boolean(card.priority || card.labels?.length || assigneeName);
  const hasFoot = Boolean(card.dueAt || (card.commentCount ?? 0) > 0 || card.updatedAt);

  return (
    <div
      // The tick is a border rather than an inner strip so it cannot be
      // overlapped by the padding box, and it is always present — see
      // NO_PRIORITY_TICK for why an unset card still reserves the 3px.
      style={{ borderLeftColor: face?.tick ?? NO_PRIORITY_TICK }}
      className={`relative bg-surface border border-l-[3px] rounded-[2px] px-3 py-[11px] overflow-hidden transition-colors ${
        pending
          ? "border-dashed border-border-2 opacity-60"
          : "border-border hover:border-text-dim"
      }`}
    >
      {hasMeta && (
        <div className="flex flex-wrap items-center gap-x-[7px] gap-y-1 mb-[7px] min-w-0">
          {card.priority && face && (
            <span
              className={`px-[5px] py-px rounded-[2px] text-[9.5px] font-bold tracking-[0.04em] whitespace-nowrap ${face.badge}`}
            >
              {card.priority}
            </span>
          )}
          {card.labels?.map((l) => (
            // Micro-caps with the hue on a dot, not on the word.
            //
            // The design sets the name itself in the label's colour. That is
            // the defect `labelChipStyle` was corrected for in v5 — hue-painted
            // label text measured 2.15-4.49:1 across the palettes — and this
            // renders a pixel smaller than the chips that failed, so it would
            // land the same defect somewhere new (S1.2g). The dot carries the
            // identity, the word stays on a text token and stays readable.
            <span
              key={l.id}
              className="inline-flex items-center gap-1 min-w-0 text-[9.5px] uppercase tracking-[0.07em] font-semibold text-text-muted"
            >
              <span
                aria-hidden="true"
                style={labelSwatchStyle(l.color)}
                className="shrink-0 w-[5px] h-[5px] rounded-full"
              />
              <span className="truncate max-w-[110px]">{l.name}</span>
            </span>
          ))}
          <span className="flex-1" />
          {assigneeName && (
            <span
              className="text-[9px] font-semibold text-text-dim whitespace-nowrap"
              title={assigneeName}
            >
              {initialsOf(assigneeName)}
            </span>
          )}
        </div>
      )}

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
      <p className={`text-[12.5px] leading-[1.45] line-clamp-3 ${draggable ? "pr-5" : ""}`}>
        {card.title}
      </p>
      {/* The design's sample cards carry no description, which is not the same
          as the design removing the field — dropping it would lose content the
          board has always shown. Kept, clamped, and muted below the title. */}
      {card.description && (
        <p className="mt-1 text-[11px] text-text-muted leading-snug line-clamp-2">
          {card.description}
        </p>
      )}

      {hasFoot && (
        <div className="flex flex-wrap items-center gap-x-[7px] gap-y-1 mt-[9px] text-[10.5px] text-text-dim min-w-0">
          {card.dueAt && (
            <span
              className={`px-1.5 py-px rounded-[2px] font-semibold whitespace-nowrap ${
                DUE_TONE[dueStatus(card.dueAt)]
              }`}
            >
              {/* The status is carried by colour, so it is also said in words —
                  "2d late" reads the same to everyone. */}
              {dueLabel(card.dueAt)}
            </span>
          )}
          {(card.commentCount ?? 0) > 0 && (
            /* Spelled out rather than an icon and a number. The old face paired
               a speech bubble with a bare count, which read as a quantity of
               nothing in particular to anyone who never sees the bubble. */
            <span className="tabular-nums whitespace-nowrap">
              {card.commentCount} {card.commentCount === 1 ? "comment" : "comments"}
            </span>
          )}
          <span className="flex-1" />
          {card.updatedAt && (
            <span className="tabular-nums whitespace-nowrap">{relativeTime(card.updatedAt)}</span>
          )}
        </div>
      )}

      {pending && <span className="block mt-2 text-[11px] text-text-dim">Adding…</span>}
    </div>
  );
}
