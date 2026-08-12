"use client";

import { useEffect, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { KanbanCard } from "@/components/board/KanbanCard";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/Menu";
import { SortableKanbanCard } from "@/components/board/SortableKanbanCard";
import type { CardResponse, ColumnWithCardsResponse } from "@/lib/api";

// Purely decorative column identifiers -- the backend doesn't track a column
// color, so this just cycles a fixed palette by position (matches the
// reference design's per-column dot, not real data).
// S1.2 documented exception: these identify a column by position rather than
// expressing the theme, and are deliberately stable across light and dark.
// eslint-disable-next-line no-restricted-syntax
const DOT_COLORS = ["#909090", "#4A9EFF", "#F5A623", "#4A9E62", "#8058A8"];

export function BoardColumn({
  column,
  totalCards,
  filtering = false,
  colorIndex,
  disabled,
  canEdit,
  startAdding = false,
  tourAnchors = false,
  memberNames,
  onAddCard,
  onRenameColumn,
  onDeleteColumn,
  onCardClick,
}: {
  /** Already filtered — `cards` is what should be drawn, not what exists. */
  column: ColumnWithCardsResponse;
  /** How many cards the column actually holds, filter or no filter. */
  totalCards?: number;
  /** True when a filter is hiding something, which changes what "empty" means. */
  filtering?: boolean;
  colorIndex: number;
  // Transient: the connection dropped. Controls stay visible but inert, since
  // the ability is coming back.
  disabled: boolean;
  // Permanent for this session: the viewer role can't mutate at all, so the
  // controls are removed rather than disabled -- a greyed-out button implies
  // "not right now" when the truth is "not you".
  canEdit: boolean;
  // Opens the add-card form from outside, for the first-run introduction's call
  // to action. Only acted on when it turns true, so cancelling the form doesn't
  // reopen it on the next render.
  startAdding?: boolean;
  /** True for the first column only, so the walkthrough has one of each anchor. */
  tourAnchors?: boolean;
  /** Assignee id -> display name. Anyone absent reads as unassigned. */
  memberNames?: Map<string, string>;
  onAddCard: (columnId: string, title: string) => Promise<void>;
  onRenameColumn: (columnId: string, name: string) => Promise<void>;
  onDeleteColumn: (columnId: string) => Promise<void>;
  onCardClick: (card: CardResponse) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Held separately from `title`, which the form clears on success -- the
  // placeholder needs to keep showing what is in flight.
  const [pendingTitle, setPendingTitle] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(column.name);
  // Escape leaves the field, which fires onBlur -- and onBlur commits. Without
  // this flag, cancelling would save the very edit it was meant to discard.
  const escapedRef = useRef(false);

  const { setNodeRef } = useDroppable({ id: `column:${column.id}` });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (startAdding) setAdding(true);
  }, [startAdding]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setPendingTitle(trimmed);
    try {
      await onAddCard(column.id, trimmed);
      setTitle("");
      setAdding(false);
    } finally {
      setSubmitting(false);
      setPendingTitle(null);
    }
  }

  async function handleRenameSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (escapedRef.current) return;
    const trimmed = name.trim();
    setRenaming(false);
    if (!trimmed || trimmed === column.name) {
      setName(column.name);
      return;
    }
    await onRenameColumn(column.id, trimmed);
  }

  function startRenaming() {
    escapedRef.current = false;
    setName(column.name);
    setRenaming(true);
  }

  function cancelRenaming() {
    escapedRef.current = true;
    setName(column.name);
    setRenaming(false);
  }

  return (
    // A lane, not a list that happens to be in a column.
    //
    // The cards used to float on the board's own background with nothing
    // holding them, so four columns read as four unrelated stacks and an empty
    // one read as nothing at all. A tinted surface gives each column an edge to
    // drop against, which is most of what makes a kanban board legible.
    <div className="flex-none w-[272px] h-full flex flex-col rounded-xl bg-surface-2/50 border border-border/70 p-2">
      <div className="flex items-center gap-2 px-1 pb-2 shrink-0">
        <div
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: DOT_COLORS[colorIndex % DOT_COLORS.length] }}
        />
        {renaming ? (
          <form onSubmit={handleRenameSubmit} className="flex-1 min-w-0">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={(e) => e.key === "Escape" && cancelRenaming()}
              aria-label={`Rename column ${column.name}`}
              className="w-full text-[11px] font-semibold tracking-wider uppercase bg-surface-2 border border-border rounded px-1 py-0.5 outline-none focus-visible:border-accent"
            />
          </form>
        ) : canEdit ? (
          // S5.1: a <span onClick> was neither tabbable nor activatable, so
          // rename was mouse-only. S8.1 keeps the two "can't" cases distinct --
          // viewers get the plain label below (gone), a dropped connection
          // disables (coming back).
          <button
            type="button"
            onClick={startRenaming}
            disabled={disabled}
            title="Rename column"
            aria-label={`Rename column ${column.name}`}
            className="min-w-0 text-left text-[11px] font-semibold tracking-wider uppercase text-text-muted truncate rounded-sm cursor-pointer hover:text-text disabled:cursor-default disabled:hover:text-text-muted"
          >
            {column.name}
          </button>
        ) : (
          <span className="min-w-0 text-[11px] font-semibold tracking-wider uppercase text-text-muted truncate">
            {column.name}
          </span>
        )}
        {/* Plain. A bordered pill gave the count the same weight as the name
            it is qualifying, on every column, forever.

            Under a filter it reads "3 of 12", because otherwise a filtered
            column and a nearly empty one are indistinguishable — and the second
            is the more alarming reading. */}
        <span className="text-[11px] font-medium text-text-dim shrink-0 tabular-nums">
          {filtering && totalCards !== undefined && totalCards !== column.cards.length
            ? `${column.cards.length} of ${totalCards}`
            : column.cards.length}
        </span>
        <div className="flex-1" />
        {/* A menu, not a delete button revealed on hover.
            
            The old control was invisible until the pointer was already over the
            column, which meant rename (a click on the name) and delete were
            both discoverable only by accident. It also needed two nested
            elements to keep `opacity-0` from colliding with the button's own
            `disabled:opacity-50` — a fight that disappears once the control is
            simply always there. */}
        {canEdit && (
          <Menu label={`Column actions for ${column.name}`} disabled={disabled}>
            {(close) => (
              <>
                <MenuItem
                  onSelect={() => {
                    close();
                    startRenaming();
                  }}
                >
                  Rename column
                </MenuItem>
                <MenuSeparator />
                <MenuItem
                  tone="danger"
                  onSelect={() => {
                    close();
                    onDeleteColumn(column.id);
                  }}
                >
                  Delete column
                </MenuItem>
              </>
            )}
          </Menu>
        )}
      </div>

      {/* Anchors the first-run demonstration. It measures these rather than
          recomputing the column width and gap, which would desynchronise the
          moment either changes here. */}
      <div
        ref={setNodeRef}
        data-intro-dropzone
        className="flex-1 overflow-y-auto flex flex-col gap-2 min-h-0 px-1 pb-2"
      >
        <SortableContext items={column.cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {column.cards.map((card, i) => (
            <SortableKanbanCard
              key={card.id}
              card={card}
              canDrag={canEdit}
              tourAnchor={tourAnchors && i === 0}
              assigneeName={(card.assigneeId && memberNames?.get(card.assigneeId)) || null}
              onClick={() => onCardClick(card)}
            />
          ))}
        </SortableContext>

        {/* Doubles as a drop target hint: an empty column used to be blank
            space, so there was nothing to aim a dragged card at (S2.3). */}
        {column.cards.length === 0 && !submitting && (
          <p className="rounded-lg border border-dashed border-border/80 px-3 py-5 text-center text-xs text-text-dim">
            {/* A filter hiding everything is not an empty column, and saying
                "add a card" to someone who has just searched is answering a
                question they did not ask (S2.3). */}
            {filtering && totalCards
              ? `No matches — ${totalCards} hidden by the filter.`
              : canEdit
                ? "Empty — add a card, or drag one here."
                : "No cards in this column."}
          </p>
        )}

        {/* Creates are not optimistic: the server assigns the rank and the id,
            and inventing a temporary one would leave a duplicate on screen
            until the broadcast arrived. A placeholder is the honest version --
            it says the card is on its way without pretending it exists. */}
        {submitting && pendingTitle && (
          <KanbanCard card={{ title: pendingTitle, description: null }} pending />
        )}
      </div>

      {!canEdit ? null : adding ? (
        <form onSubmit={handleSubmit} className="flex flex-col gap-2 shrink-0 px-1 pb-0.5">
          <input
            autoFocus
            placeholder="Card title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={submitting}
            className="w-full py-2 px-3 bg-surface border border-border rounded-lg text-[13px] text-text placeholder:text-text-dim transition-colors focus-visible:border-accent"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="px-2.5 py-1.5 rounded-md bg-accent text-accent-fg text-xs font-medium disabled:opacity-50 cursor-pointer"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              disabled={submitting}
              className="px-2.5 py-1.5 rounded-md text-text-muted text-xs font-medium hover:bg-surface-2 disabled:opacity-50 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setAdding(true)}
          disabled={disabled}
          data-tour={tourAnchors ? "add-card" : undefined}
          // No dashed outline. Inside a lane that already has an edge it was a
          // box drawn inside a box; the control reads as an action now.
          className="flex items-center gap-1.5 w-full py-1.5 px-2 mx-1 rounded-md text-text-muted text-xs font-medium transition-colors shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:bg-surface hover:text-text"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <line x1="6" y1="2" x2="6" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Add card
        </button>
      )}
    </div>
  );
}
