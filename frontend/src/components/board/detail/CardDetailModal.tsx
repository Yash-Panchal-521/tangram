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
        {/* A fixed height, not one that fits its contents.

            An empty card and a card with forty comments are the same panel, so
            the panel is the same size for both: opening one card after another
            no longer resizes the window under the pointer, and the Details
            column does not float halfway up the screen because the description
            happens to be one line. It is what makes this read as a view onto a
            ticket rather than a box drawn around whatever was in it. Capped in
            pixels as well as vh so a tall monitor gets a panel rather than a
            column of empty space. */}
        <div className="pointer-events-auto w-full h-full lg:h-[85vh] lg:max-h-[820px] lg:w-full lg:max-w-[1040px] bg-surface lg:border lg:border-border lg:rounded-xl shadow-lg flex flex-col overflow-hidden animate-[fade-up_0.2s_ease-out]">
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
            <div className="flex items-center gap-2 px-5 pt-3 min-h-[28px]">
              {readOnly && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface-2 border border-border text-text-muted">
                  View only
                </span>
              )}
              <div className="flex-1" />
              <CardActionsMenu
                onDelete={handleDelete}
                deleting={deleting}
                readOnly={readOnly}
              />
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
                the whole thing rather than describing or classifying it. Pinned
                above the scroll area rather than scrolling with the description,
                so you can still see which card you are commenting on from the
                bottom of a long thread. */}
            <div className="px-5 pt-1 pb-3">
              <h2 id={headingId} className="sr-only">
                {card.title}
              </h2>
              <InlineEdit
                label="Summary"
                value={card.title}
                readOnly={readOnly}
                placeholder="Untitled card"
                onCommit={(next) => onCommit({ title: next })}
                className="[&_button]:text-[17px] [&_button]:font-semibold [&_button]:leading-snug [&_input]:text-[17px] [&_input]:font-semibold"
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
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
            <div className="flex-1 min-w-0 lg:basis-[62%] px-5 py-4 lg:overflow-y-auto lg:min-h-0">
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
                // Given a field's worth of height even when empty. A one-line
                // placeholder floating in a tall panel reads as a caption
                // rather than somewhere to write.
                className="[&>button]:min-h-[92px] [&>button]:items-start [&_textarea]:min-h-[140px]"
              />

              {/* Under the description, in the left column: both are what the
                  work *is*, as opposed to how it is tracked. Jira puts
                  activity here for the same reason. */}
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

            {/* Divided by a rule and a tint rather than by whitespace: at 38%
                of the width these rows are close enough to the description to
                read as more of it. */}
            <div className="lg:basis-[38%] lg:shrink-0 px-5 py-4 border-t lg:border-t-0 lg:border-l border-border bg-surface-2 lg:overflow-y-auto lg:min-h-0">
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
