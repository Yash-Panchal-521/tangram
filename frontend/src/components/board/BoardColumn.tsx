"use client";

import { useState } from "react";
import { KanbanCard } from "@/components/board/KanbanCard";
import type { ColumnWithCardsResponse } from "@/lib/api";

// Purely decorative column identifiers -- the backend doesn't track a column
// color, so this just cycles a fixed palette by position (matches the
// reference design's per-column dot, not real data).
const DOT_COLORS = ["#909090", "#4A9EFF", "#F5A623", "#4A9E62", "#8058A8"];

export function BoardColumn({
  column,
  colorIndex,
  disabled,
  onAddCard,
}: {
  column: ColumnWithCardsResponse;
  colorIndex: number;
  disabled: boolean;
  onAddCard: (columnId: string, title: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

  return (
    <div className="flex-none w-[262px] h-full flex flex-col">
      <div className="flex items-center gap-2 px-0.5 pb-3 shrink-0">
        <div
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: DOT_COLORS[colorIndex % DOT_COLORS.length] }}
        />
        <span className="text-[11px] font-semibold tracking-wider uppercase text-text-muted">
          {column.name}
        </span>
        <span className="text-[11px] font-medium text-text-dim bg-surface-2 border border-border rounded px-1.5 leading-[1.9]">
          {column.cards.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-2 min-h-0 pb-3">
        {column.cards.map((card) => (
          <KanbanCard key={card.id} card={card} />
        ))}
      </div>

      {adding ? (
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
