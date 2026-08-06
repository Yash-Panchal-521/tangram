"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { CardResponse } from "@/lib/api";

export function CardDetailPanel({
  card,
  readOnly,
  onClose,
  onSave,
  onDelete,
}: {
  card: CardResponse;
  readOnly: boolean;
  onClose: () => void;
  onSave: (title: string, description: string | null) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const dirty = title !== card.title || description !== (card.description ?? "");

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSave(title.trim(), description.trim() || null);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="absolute inset-0 bg-black/20 z-30" onClick={onClose} />
      <div className="absolute top-0 right-0 bottom-0 w-[420px] bg-surface border-l border-border flex flex-col z-40 animate-[fade-up_0.2s_ease-out] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-dim">
            {readOnly ? "Card · read-only" : "Card"}
          </span>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-md text-text-muted hover:bg-surface-2 cursor-pointer"
            aria-label="Close"
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {/* readOnly rather than disabled: the text stays selectable and
              copyable at full contrast, instead of greying out content the
              viewer is entitled to read. */}
          <input
            value={title}
            readOnly={readOnly}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Card title"
            className={`w-full text-base font-medium bg-transparent outline-none border border-transparent rounded-md -mx-1 px-1 py-0.5 ${
              readOnly ? "cursor-default" : "focus-visible:border-accent focus-visible:bg-surface-2"
            }`}
          />
          {readOnly && !card.description ? (
            <p className="text-sm text-text-dim italic">No description.</p>
          ) : (
            <textarea
              value={description}
              readOnly={readOnly}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description…"
              rows={5}
              className={`w-full text-sm text-text-muted bg-surface-2 border border-border rounded-lg p-3 outline-none resize-none ${
                readOnly ? "cursor-default" : "focus-visible:border-accent"
              }`}
            />
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-border shrink-0">
          {readOnly ? (
            // States why the actions are absent. Without it the footer just
            // looks empty and the panel reads as broken.
            <p className="text-xs text-text-muted">You have view-only access to this board.</p>
          ) : (
            <>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="text-xs font-medium text-danger hover:opacity-80 disabled:opacity-50 cursor-pointer"
              >
                {deleting ? "Deleting…" : "Delete card"}
              </button>
              <Button size="sm" onClick={handleSave} disabled={!dirty || saving || !title.trim()}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
