"use client";

import { useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { relativeTime } from "@/lib/relativeTime";
import type { CommentResponse } from "@/lib/api";

/**
 * The conversation on a card.
 *
 * Worth being explicit about what this is not, given an activity feed was
 * deleted from this app a few commits ago: that feed was *derived history*,
 * written by the machine from the operations log, and it was removed because
 * nobody wanted the board to be that. A comment is authored — somebody chose the
 * words and chose to say them. If a "History" tab ever appears beside this, the
 * old feature has come back through a side door.
 *
 * Composer at the top, thread oldest-first below. Reversed from a chat window on
 * purpose: this is read alongside a description rather than scrolled, and the
 * card's own body sits above it, so putting the newest at the bottom keeps the
 * whole card reading top to bottom in the order things happened.
 */
export function CommentThread({
  comments,
  currentUserId,
  loading,
  error,
  readOnly,
  onAdd,
  onEdit,
  onDelete,
  onRetry,
}: {
  comments: CommentResponse[];
  /** Which comments are yours — only those get edit and delete. */
  currentUserId: string | null;
  loading: boolean;
  error: string | null;
  readOnly: boolean;
  onAdd: (body: string) => Promise<void>;
  onEdit: (commentId: string, body: string) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
  onRetry: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const { confirm, dialog } = useConfirm();

  async function submit() {
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    setSendError(null);
    try {
      await onAdd(body);
      // Cleared only on success. A failed send that emptied the box would lose
      // what somebody wrote, which is the one thing a comment box must not do.
      setDraft("");
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "That didn't send. Try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-dim">
        Comments
        {comments.length > 0 && <span className="ml-1.5 text-text-muted">{comments.length}</span>}
      </h3>

      {!readOnly && (
        <div className="flex flex-col gap-1.5">
          <textarea
            ref={composerRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a comment…"
            aria-label="Add a comment"
            rows={draft ? 3 : 2}
            disabled={sending}
            onKeyDown={(e) => {
              // The shortcut sends; a bare Enter makes a paragraph. A comment
              // long enough to need two lines is common enough that Enter
              // cannot mean submit.
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
              if (e.key === "Escape") {
                // Contained, or the card modal behind this closes too.
                e.stopPropagation();
              }
            }}
            className="w-full text-[13px] bg-surface-2 border border-border rounded-lg px-2.5 py-2 outline-none focus-visible:border-accent resize-none leading-relaxed"
          />
          {(draft.trim().length > 0 || sendError) && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void submit()}
                disabled={sending || draft.trim().length === 0}
                className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-accent text-accent-fg hover:bg-accent-h transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? "Sending…" : "Comment"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft("");
                  setSendError(null);
                }}
                disabled={sending}
                className="text-[11px] font-medium px-2 py-1 rounded-md text-text-muted hover:text-text hover:bg-surface-2 transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              {sendError && (
                <span role="alert" className="text-[11px] text-danger">
                  {sendError}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* S2.1: all four states. */}
      {loading ? (
        <p role="status" className="text-[11px] text-text-dim">
          Loading comments…
        </p>
      ) : error ? (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-[11px] text-danger">
            {error}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="text-[11px] font-medium text-accent hover:underline cursor-pointer"
          >
            Try again
          </button>
        </div>
      ) : comments.length === 0 ? (
        <p className="text-[11px] text-text-dim italic">
          {readOnly ? "No comments on this card." : "No comments yet."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((comment) => (
            <Comment
              key={comment.id}
              comment={comment}
              mine={comment.authorId === currentUserId && !readOnly}
              onEdit={(body) => onEdit(comment.id, body)}
              onDelete={async () => {
                const ok = await confirm({
                  title: "Delete this comment?",
                  body: "Everyone on the board sees this immediately, and it can't be undone.",
                  confirmLabel: "Delete comment",
                  tone: "danger",
                });
                if (ok) await onDelete(comment.id);
              }}
            />
          ))}
        </ul>
      )}

      {dialog}
    </div>
  );
}

function Comment({
  comment,
  mine,
  onEdit,
  onDelete,
}: {
  comment: CommentResponse;
  mine: boolean;
  onEdit: (body: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const body = draft.trim();
    if (!body || body === comment.body) {
      setEditing(false);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onEdit(body);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex gap-2.5 group">
      <Avatar name={comment.authorName} size="sm" className="mt-0.5 shrink-0" />

      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[13px] font-medium">{comment.authorName}</span>
          <span className="text-[11px] text-text-dim">{relativeTime(comment.createdAt)}</span>
          {/* Shown, not hidden: a reply may predate the rewrite it is replying to. */}
          {comment.editedAt && <span className="text-[11px] text-text-dim italic">edited</span>}

          {mine && !editing && (
            <span className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              {/* Named more specifically than they read. The card has its own
                  Delete in the header, and "Delete" twice on one screen is
                  ambiguous to anyone listening rather than looking (S5.6). */}
              <button
                type="button"
                onClick={() => {
                  setDraft(comment.body);
                  setError(null);
                  setEditing(true);
                }}
                aria-label="Edit this comment"
                className="text-[11px] text-text-muted hover:text-text cursor-pointer"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => void onDelete()}
                aria-label="Delete this comment"
                className="text-[11px] text-text-muted hover:text-danger cursor-pointer"
              >
                Delete
              </button>
            </span>
          )}
        </div>

        {editing ? (
          <div className="flex flex-col gap-1.5">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label={`Edit your comment`}
              rows={3}
              disabled={busy}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void save();
                }
                if (e.key === "Escape") {
                  e.stopPropagation();
                  e.preventDefault();
                  setEditing(false);
                }
              }}
              className="w-full text-[13px] bg-surface border border-accent rounded-md px-2 py-1.5 outline-none resize-none leading-relaxed"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy}
                className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-accent text-accent-fg hover:bg-accent-h transition-colors cursor-pointer disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={busy}
                className="text-[11px] font-medium px-2 py-1 rounded-md text-text-muted hover:text-text hover:bg-surface-2 transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">
            {comment.body}
          </p>
        )}

        {error && (
          <p role="alert" className="text-[11px] text-danger">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}
