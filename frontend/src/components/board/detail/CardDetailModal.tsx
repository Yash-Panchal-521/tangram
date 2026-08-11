"use client";

import { useId, useRef, useState } from "react";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { InlineEdit } from "@/components/ui/InlineEdit";
import { ContextPanel, type StatusOption } from "@/components/board/detail/ContextPanel";
import { useDialog } from "@/lib/useDialog";
import type { CardResponse, MemberResponse, UpdateCardRequest } from "@/lib/api";

/**
 * The card, as a ticket.
 *
 * Replaces a 420px drawer whose four fields sat behind one Save button. The
 * shape is Jira's, and each part of it is answering something the drawer got
 * wrong:
 *
 * - **Two columns.** Description on the left because it is what the work *is*
 *   and the first thing anyone reads; context on the right because assignee and
 *   due date are things you sort by, not things you read. Below 1024px they
 *   stack, description first, which is Jira's own single-column fallback.
 * - **A modal, not a drawer.** Two columns plus a description need width the
 *   drawer never had. Dimming the board rather than navigating away keeps the
 *   surrounding columns visible, which on a kanban tool is half the context.
 * - **Every field saves itself.** One Save button made the fate of four fields
 *   depend on one request, and `runMutation` swallowed the failure and closed
 *   the panel anyway — so a rejected save looked exactly like a successful one.
 *   Each field now commits alone and reports its own failure in place.
 *
 * Because of that last point there is no dirty state to guard on close, and no
 * discard confirmation: by the time you close, everything is either saved or was
 * explicitly cancelled. The one exception is the description, which keeps Save
 * and Cancel buttons rather than committing on blur — see `InlineEdit`.
 */
export function CardDetailModal({
  card,
  readOnly,
  members,
  statuses,
  onClose,
  onCommit,
  onMove,
  onDelete,
}: {
  card: CardResponse;
  readOnly: boolean;
  /** Workspace members, for the assignee picker. Empty until they load, which
   *  costs the picker its options and nothing else. */
  members: MemberResponse[];
  /** The board's columns, which are what "status" means here. */
  statuses: StatusOption[];
  onClose: () => void;
  /** Must reject on failure — that is how a field knows to revert and explain. */
  onCommit: (update: UpdateCardRequest) => Promise<void>;
  onMove: (targetColumnId: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const headingId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { confirm, dialog } = useConfirm();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Paused while a confirmation is stacked above. Both listen on `document`, so
  // an unpaused modal would take the same Escape and close underneath its own
  // dialog. The inline editors don't need this — they stop Escape themselves.
  useDialog({ containerRef: panelRef, onClose, paused: confirming });

  async function handleDelete() {
    setConfirming(true);
    const confirmed = await confirm({
      title: `Delete "${card.title}"?`,
      body: "Everyone on the board sees this immediately, and it can't be undone.",
      confirmLabel: "Delete card",
      tone: "danger",
    });
    setConfirming(false);
    if (!confirmed) return;

    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="fixed inset-0 z-50 flex items-start justify-center p-0 lg:p-8 lg:items-center pointer-events-none"
      >
        <div className="pointer-events-auto w-full h-full lg:h-auto lg:w-full lg:max-w-[960px] lg:max-h-[88vh] bg-surface lg:border lg:border-border lg:rounded-xl shadow-lg flex flex-col overflow-hidden animate-[fade-up_0.2s_ease-out]">
          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border shrink-0">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-text-dim">
              Card
            </span>
            {readOnly && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface-2 border border-border text-text-muted">
                View only
              </span>
            )}
            <div className="flex-1" />
            {!readOnly && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="text-[11px] font-medium px-2 py-1 rounded-md text-text-muted hover:text-danger hover:bg-surface-2 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text hover:bg-surface-2 transition-colors cursor-pointer"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path
                  d="M1 1L11 11M11 1L1 11"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          {/* Summary — the one field that spans both columns, because it names
              the whole thing rather than describing or classifying it. */}
          <div className="px-5 pt-4 pb-3 shrink-0">
            <h2 id={headingId} className="sr-only">
              {card.title}
            </h2>
            <InlineEdit
              label="Summary"
              value={card.title}
              readOnly={readOnly}
              placeholder="Untitled card"
              onCommit={(next) => onCommit({ title: next })}
              className="[&_button]:text-base [&_button]:font-semibold [&_input]:text-base [&_input]:font-semibold"
            />
          </div>

          {/* S7.4: the body scrolls inside itself, never the page. */}
          <div className="flex-1 overflow-y-auto px-5 pb-5">
            <div className="flex flex-col lg:flex-row gap-6">
              <div className="flex-1 min-w-0 lg:basis-[62%]">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-dim mb-1.5">
                  Description
                </h3>
                <InlineEdit
                  label="Description"
                  value={card.description ?? ""}
                  readOnly={readOnly}
                  multiline
                  placeholder="Add a description…"
                  onCommit={(next) => onCommit({ description: next || null })}
                />
              </div>

              <div className="lg:basis-[38%] shrink-0">
                <ContextPanel
                  card={card}
                  readOnly={readOnly}
                  members={members}
                  statuses={statuses}
                  onCommit={onCommit}
                  onMove={onMove}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {dialog}
    </>
  );
}
