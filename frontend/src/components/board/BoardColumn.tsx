"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
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
  colorIndex,
  disabled,
  canEdit,
  onAddCard,
  onRenameColumn,
  onDeleteColumn,
  onCardClick,
}: {
  column: ColumnWithCardsResponse;
  colorIndex: number;
  // Transient: the connection dropped. Controls stay visible but inert, since
  // the ability is coming back.
  disabled: boolean;
  // Permanent for this session: the viewer role can't mutate at all, so the
  // controls are removed rather than disabled -- a greyed-out button implies
  // "not right now" when the truth is "not you".
  canEdit: boolean;
  onAddCard: (columnId: string, title: string) => Promise<void>;
  onRenameColumn: (columnId: string, name: string) => Promise<void>;
  onDeleteColumn: (columnId: string) => Promise<void>;
  onCardClick: (card: CardResponse) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(column.name);

  const { setNodeRef } = useDroppable({ id: `column:${column.id}` });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await onAddCard(column.id, title.trim());
      setTitle("");
      setAdding(false);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRenameSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    setRenaming(false);
    if (!trimmed || trimmed === column.name) {
      setName(column.name);
      return;
    }
    await onRenameColumn(column.id, trimmed);
  }

  return (
    <div className="flex-none w-[262px] h-full flex flex-col">
      <div className="flex items-center gap-2 px-0.5 pb-3 shrink-0 group">
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
              className="w-full text-[11px] font-semibold tracking-wider uppercase bg-surface-2 border border-border rounded px-1 py-0.5 outline-none focus-visible:border-accent"
            />
          </form>
        ) : (
          <span
            onClick={() => canEdit && !disabled && setRenaming(true)}
            className={`text-[11px] font-semibold tracking-wider uppercase text-text-muted truncate ${
              canEdit ? "cursor-pointer" : "cursor-default"
            }`}
          >
            {column.name}
          </span>
        )}
        <span className="text-[11px] font-medium text-text-dim bg-surface-2 border border-border rounded px-1.5 leading-[1.9] shrink-0">
          {column.cards.length}
        </span>
        <div className="flex-1" />
        {canEdit && (
        <button
          onClick={() => onDeleteColumn(column.id)}
          disabled={disabled}
          title="Delete column"
          className="w-5 h-5 shrink-0 hidden group-hover:flex items-center justify-center rounded text-text-dim hover:text-danger hover:bg-surface-2 cursor-pointer disabled:opacity-50"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M2 3h8M4.5 3V2a1 1 0 011-1h1a1 1 0 011 1v1M3 3l.5 7a1 1 0 001 1h3a1 1 0 001-1L9 3"
              stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        )}
      </div>

      <div ref={setNodeRef} className="flex-1 overflow-y-auto flex flex-col gap-2 min-h-0 pb-3">
        <SortableContext items={column.cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {column.cards.map((card) => (
            <SortableKanbanCard
              key={card.id}
              card={card}
              canDrag={canEdit}
              onClick={() => onCardClick(card)}
            />
          ))}
        </SortableContext>
      </div>

      {!canEdit ? null : adding ? (
        <form onSubmit={handleSubmit} className="flex flex-col gap-2 shrink-0">
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
          className="flex items-center gap-1.5 w-full py-2 px-2.5 rounded-lg border-[1.5px] border-dashed border-border text-text-dim text-xs font-medium transition-colors shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:border-accent hover:text-accent"
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
