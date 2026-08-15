"use client";

import { useId, useRef, useState } from "react";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { InlineEdit } from "@/components/ui/InlineEdit";
import { ContextPanel, type StatusOption } from "@/components/board/detail/ContextPanel";
import { CommentThread } from "@/components/board/detail/CommentThread";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/Menu";
import { useDialog } from "@/lib/useDialog";
import type {
  CardResponse,
  CommentResponse,
  LabelColor,
  LabelResponse,
  MemberResponse,
  UpdateCardRequest,
} from "@/lib/api";

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
  labels,
  onClose,
  onCommit,
  onMove,
  onDelete,
  onCreateLabel,
  onDeleteLabel,
  comments,
}: {
  card: CardResponse;
  readOnly: boolean;
  /** Workspace members, for the assignee picker. Empty until they load, which
   *  costs the picker its options and nothing else. */
  members: MemberResponse[];
  /** The board's columns, which are what "status" means here. */
  statuses: StatusOption[];
  /** The board's label vocabulary, including labels this card doesn't carry. */
  labels: LabelResponse[];
  onClose: () => void;
  /** Must reject on failure — that is how a field knows to revert and explain. */
  onCommit: (update: UpdateCardRequest) => Promise<void>;
  onMove: (targetColumnId: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onCreateLabel: (name: string, color: LabelColor) => Promise<void>;
  onDeleteLabel: (labelId: string) => Promise<void>;
  /**
   * The card's thread, owned by the board.
   *
   * Grouped into one prop rather than eight loose ones — and owned upstream
   * because a comment from someone else arrives as a broadcast, and every other
   * piece of sync already lives there.
   */
  comments: {
    items: CommentResponse[];
    loading: boolean;
    error: string | null;
    currentUserId: string | null;
    onAdd: (body: string) => Promise<void>;
    onEdit: (commentId: string, body: string) => Promise<void>;
    onDelete: (commentId: string) => Promise<void>;
    onRetry: () => void;
  };
}) {
  const headingId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { confirm, dialog } = useConfirm();
  const [deleting, setDeleting] = useState(false);

  // Resolved from the columns rather than stored on the card: the stage *is*
  // the column, and a card that has just been moved by someone else should read
  // as its new stage without waiting for anything else to catch up.
  const currentStatus = statuses.find((s) => s.id === card.columnId)?.name;

  // Nothing here says "stand down while the calendar is open". `useDialog`
  // keeps its own stack and only the topmost dialog answers a key, so the
  // confirmation, the calendar and the label picker each take Escape without
  // this modal needing to hear about them. The inline editors are a separate
  // case — they stop Escape at the element, so it never reaches `document`.
  useDialog({ containerRef: panelRef, onClose });

  async function handleDelete() {
    const confirmed = await confirm({
      title: `Delete "${card.title}"?`,
      body: "Everyone on the board sees this immediately, and it can't be undone.",
      confirmLabel: "Delete card",
      tone: "danger",
    });
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
        className="fixed inset-0 bg-scrim backdrop-blur-[2px] z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="fixed inset-0 z-50 flex justify-end pointer-events-none"
      >
        {/* A drawer against the right edge, full height, one column.

            The board stays visible beside it, which is half the context on a
            kanban tool — where this card sits relative to everything else is
            information the panel cannot carry itself.

            One column, so the panel scrolls once. The two-column version kept
            Status and Assignee on screen while a long thread scrolled, which
            this gives up; what it buys is that the fields sit *above* the
            thread in reading order rather than beside it, so they are the first
            thing you meet on opening a card rather than something to look
            across for. Below `sm` it is the full width — a 548px drawer on a
            phone is the whole screen anyway. */}
        <div className="pointer-events-auto w-full sm:w-[548px] h-full bg-surface border-l border-border shadow-[-26px_0_64px_rgba(0,0,0,0.16)] flex flex-col overflow-hidden animate-[slide-in-right_0.24s_cubic-bezier(0.2,0.8,0.2,1)]">
          {/* One header block, not two.

              The eyebrow and the summary used to be separate bands with a rule
              between them, which cost about 50px at the top of the panel to say
              "Card" — a word that is true of every card. They are one block now
              with a single rule beneath, the way Jira runs breadcrumb straight
              into summary. */}
          <div className="shrink-0 border-b border-border">
            {/* No type icon and no "Card" eyebrow.

                Both were Jira's shape borrowed without the substance underneath
                it. Jira's tile is a *type* — Story, Bug, Task — and the text
                beside it is the issue key, which is identity. Tangram has
                neither: every card is a card, so the word was true of everything
                you can open, and the tick in the tile actively lied about a card
                sitting in Backlog.

                The slot stays empty on purpose. A card key (`TAN-14`) is what
                would earn it, and that is a per-board counter with the same
                atomic-increment care as `seq` — schema, not decoration. Until
                then the summary names the card, which is enough. */}
            <div className="flex items-center gap-3 px-[26px] pt-3.5 min-h-[28px]">
              {/* The stage, stated in the header rather than only sitting in the
                  field list below. It is the one property that says whether this
                  card is anyone's problem right now, and the drawer is narrow
                  enough that the list can be scrolled past. */}
              {currentStatus && (
                <span className="px-2 py-0.5 rounded-[2px] bg-surface-2 text-text-muted text-[10px] uppercase tracking-[0.09em] font-semibold">
                  {currentStatus}
                </span>
              )}
              {readOnly && (
                <span className="text-[10px] uppercase tracking-[0.09em] font-semibold px-2 py-0.5 rounded-[2px] bg-surface-2 border border-border text-text-muted">
                  View only
                </span>
              )}
              <div className="flex-1" />
              <CardActionsMenu
                onDelete={handleDelete}
                deleting={deleting}
                readOnly={readOnly}
              />
              {/* "Esc" rather than a cross. The key already closes this and
                  always has; the glyph kept that a secret from anyone who had
                  not tried it, and a word costs the same room at this size. */}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="px-1.5 h-7 flex items-center justify-center rounded-[2px] text-[10px] uppercase tracking-[0.1em] text-text-muted hover:text-text hover:bg-surface-2 transition-colors cursor-pointer"
              >
                Esc
              </button>
            </div>

            {/* Summary — the one field that spans both columns, because it names
                the whole thing rather than describing or classifying it. Pinned
                above the scroll area rather than scrolling with the description,
                so you can still see which card you are commenting on from the
                bottom of a long thread. */}
            <div className="px-[26px] pt-3 pb-4">
              <h2 id={headingId} className="sr-only">
                {card.title}
              </h2>
              {/* Display face at 29px. The title is the only thing on this panel
                  that names the card rather than describing or classifying it,
                  and in a 548px column it has the width to be the headline. */}
              <InlineEdit
                label="Summary"
                value={card.title}
                readOnly={readOnly}
                placeholder="Untitled card"
                onCommit={(next) => onCommit({ title: next })}
                className="[&_button]:text-[24px] [&_button]:leading-[1.24] [&_button]:tracking-[-0.011em] [&_button]:font-[family-name:var(--font-display)] [&_input]:text-[24px] [&_input]:font-[family-name:var(--font-display)]"
              />
            </div>
          </div>

          {/* S7.4: each column scrolls inside itself, never the page.

              Two scroll areas rather than one, which only becomes possible now
              that the panel has a fixed height. Scrolling to the end of a long
              thread used to take Status and Assignee off the screen with it —
              the fields you most often open a card to change. Below `lg` the
              columns stack and share one scroll, because two scrollbars in a
              phone-width sheet is worse than either problem. */}
          {/* One scroll for the whole drawer (S7.4 — inside itself, never the
              page). The two-column panel needed two, because each column could
              outrun the other; a single column cannot. */}
          <div className="flex-1 min-h-0 overflow-y-auto px-[26px] pb-11">
            {/* Fields first, under a rule in --text. In a column the reading
                order *is* the hierarchy: what the card is tracked as comes
                before what it says, because it is what you most often opened
                the card to change. */}
            <div className="pt-1">
              <ContextPanel
                card={card}
                readOnly={readOnly}
                members={members}
                statuses={statuses}
                labels={labels}
                onCommit={onCommit}
                onMove={onMove}
                onCreateLabel={onCreateLabel}
                onDeleteLabel={onDeleteLabel}
              />
            </div>

            <div className="mt-7 pt-5 border-t border-border">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-dim mb-1.5">
                Description
              </h3>
              <InlineEdit
                label="Description"
                value={card.description ?? ""}
                readOnly={readOnly}
                multiline
                placeholder="Add a description…"
                onCommit={(next) => onCommit({ description: next || null })}
                // Given a field's worth of height even when empty. A one-line
                // placeholder floating in a tall panel reads as a caption
                // rather than somewhere to write.
                className="[&>button]:min-h-[92px] [&>button]:items-start [&_textarea]:min-h-[140px]"
              />

            </div>

            {/* Last, and deliberately so. A thread grows without bound; putting
                it under everything else means the fields and the description
                keep a fixed home at the top of the scroll rather than being
                pushed around by how much has been said. */}
            <div className="mt-7 pt-5 border-t border-border">
              <CommentThread
                comments={comments.items}
                currentUserId={comments.currentUserId}
                loading={comments.loading}
                error={comments.error}
                readOnly={readOnly}
                onAdd={comments.onAdd}
                onEdit={comments.onEdit}
                onDelete={comments.onDelete}
                onRetry={comments.onRetry}
              />
            </div>
          </div>
        </div>
      </div>

      {dialog}
    </>
  );
}

/**
 * The card's destructive action, behind a `⋯` the way Jira puts it.
 *
 * It was a Delete button sitting in the header next to Close, which is both the
 * loudest thing in a header that should be quiet and one slip away from the
 * control people reach for most. A menu costs one extra click and buys the
 * distance.
 *
 * The menu mechanics — fixed positioning past the shell's `overflow-hidden`,
 * outside-click, and Escape belonging to the innermost layer — now live in
 * `Menu`, which the column headers share.
 */
function CardActionsMenu({
  onDelete,
  deleting,
  readOnly,
}: {
  onDelete: () => void;
  deleting: boolean;
  readOnly: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setCopyError(null);
    } catch {
      // Not silent (S3.6). Clipboard access is refusable, and a menu item that
      // appears to do nothing is worse than one that says it couldn't.
      setCopyError("Couldn't copy — copy the address bar instead.");
    }
  }

  return (
    <Menu label="Card actions" disabled={deleting}>
      {(close) => (
        <>
          {/* Here because the card has been addressable since `?card=` landed,
              and nothing in the UI said so. "See my comment on this" needs a
              link. It does not close the menu: the item's own label changing is
              the only confirmation that it worked. */}
          <MenuItem onSelect={() => void copyLink()}>
            {copied ? "Link copied" : "Copy link"}
          </MenuItem>

          {copyError && (
            <p role="alert" className="text-[11px] text-danger px-3 py-1 leading-snug">
              {copyError}
            </p>
          )}

          {/* A viewer gets the menu for the link and nothing that changes the
              card (S8.1) — removed, not disabled. */}
          {!readOnly && (
            <>
              <MenuSeparator />
              <MenuItem
                tone="danger"
                onSelect={() => {
                  close();
                  onDelete();
                }}
              >
                Delete card
              </MenuItem>
            </>
          )}
        </>
      )}
    </Menu>
  );
}
