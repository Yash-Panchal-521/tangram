"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Select } from "@/components/ui/Select";
import { useDialog } from "@/lib/useDialog";
import { fromDateInputValue, toDateInputValue } from "@/lib/dueDate";
import type { CardResponse, MemberResponse, UpdateCardRequest } from "@/lib/api";

// Read once, during the first render rather than in an effect. Safe from
// hydration mismatch because this panel only ever mounts in response to a
// click -- it is never part of the server-rendered markup.
function shortcutLabel() {
  if (typeof navigator === "undefined") return "Ctrl + Enter";
  return /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘ + Enter" : "Ctrl + Enter";
}

export function CardDetailPanel({
  card,
  readOnly,
  members,
  onClose,
  onSave,
  onDelete,
}: {
  card: CardResponse;
  readOnly: boolean;
  /** Workspace members, for the assignee picker. Empty until they load, which
   *  only costs the picker its options -- never the rest of the panel. */
  members: MemberResponse[];
  onClose: () => void;
  onSave: (update: UpdateCardRequest) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const headingId = useId();
  const titleId = useId();
  const descriptionId = useId();
  const dueId = useId();
  const assigneeId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { confirm, dialog } = useConfirm();
  const [shortcut] = useState(shortcutLabel);

  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description ?? "");
  const [due, setDue] = useState(toDateInputValue(card.dueAt));
  const [assignee, setAssignee] = useState(card.assigneeId ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const dirty =
    title !== card.title ||
    description !== (card.description ?? "") ||
    due !== toDateInputValue(card.dueAt) ||
    assignee !== (card.assigneeId ?? "");
  const canSave = dirty && !saving && title.trim().length > 0;

  // An assignee who has left the workspace no longer appears in `members`, so
  // the select would silently fall back to "Unassigned" and a save would clear
  // them. Keeping a placeholder option makes the state visible instead.
  const assigneeMissing = assignee !== "" && !members.some((m) => m.userId === assignee);

  useDialog({ containerRef: panelRef, onClose: requestClose, paused: confirming });

  /**
   * Every route out of the panel goes through here — Escape, the close button
   * and the overlay. Guarding only one of them would make the panel
   * inconsistent about when it protects your work, which is worse than
   * guarding none: you would learn to trust it and then lose an edit.
   */
  async function requestClose() {
    if (!dirty || saving) {
      onClose();
      return;
    }

    setConfirming(true);
    const discard = await confirm({
      title: "Discard your changes?",
      body: "This card has edits that haven't been saved. Closing now loses them.",
      confirmLabel: "Discard changes",
      cancelLabel: "Keep editing",
      tone: "danger",
    });
    setConfirming(false);
    if (discard) onClose();
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        description: description.trim() || null,
        // Clearing and leaving alone are different requests. Without the flags
        // an edit that only changed the title would wipe the rest.
        dueAt: fromDateInputValue(due),
        clearDueAt: due === "",
        assigneeId: assignee || null,
        clearAssignee: assignee === "",
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    // Deleting used to happen on the first click, with no confirmation at all
    // -- the one destructive action in the app that skipped it (S4.2).
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
        className="absolute inset-0 bg-black/20 z-30"
        onClick={requestClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onKeyDown={(e) => {
          // The panel is two multi-line-ish fields, so a bare Enter can't mean
          // save. Cmd/Ctrl+Enter is the convention for committing from inside
          // one, and it saves from either field.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSave();
          }
        }}
        className="absolute top-0 right-0 bottom-0 w-[420px] bg-surface border-l border-border flex flex-col z-40 animate-[fade-up_0.2s_ease-out] overflow-hidden"
      >
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-border shrink-0">
          <h2
            id={headingId}
            className="text-xs font-semibold uppercase tracking-wider text-text-dim"
          >
            {readOnly ? "Card · read-only" : "Card"}
          </h2>
          <div className="flex items-center gap-2 shrink-0">
            {/* Says the panel is holding something, so closing it isn't a
                no-op. Without it the guard's confirmation is the first hint
                anything was unsaved. */}
            {dirty && !saving && (
              <span className="text-[11px] font-medium text-warn">Unsaved</span>
            )}
            <button
              onClick={requestClose}
              className="w-6 h-6 flex items-center justify-center rounded-md text-text-muted hover:bg-surface-2 cursor-pointer"
              aria-label="Close"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={titleId} className="text-[11px] font-semibold uppercase tracking-wider text-text-dim">
              Title
            </label>
            {/* readOnly rather than disabled: the text stays selectable and
                copyable at full contrast, instead of greying out content the
                viewer is entitled to read. */}
            <input
              id={titleId}
              value={title}
              readOnly={readOnly}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Card title"
              className={`w-full text-base font-medium bg-transparent outline-none border rounded-md px-2 py-1 -mx-2 ${
                readOnly
                  ? "border-transparent cursor-default"
                  : "border-transparent focus-visible:border-accent focus-visible:bg-surface-2"
              }`}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={dueId}
                className="text-[11px] font-semibold uppercase tracking-wider text-text-dim"
              >
                Due
              </label>
              <input
                id={dueId}
                type="date"
                value={due}
                readOnly={readOnly}
                disabled={readOnly}
                onChange={(e) => setDue(e.target.value)}
                className="w-full text-[13px] bg-surface-2 border border-border rounded-lg px-2.5 py-1.5 outline-none focus-visible:border-accent disabled:opacity-70 disabled:cursor-default"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={assigneeId}
                className="text-[11px] font-semibold uppercase tracking-wider text-text-dim"
              >
                Assignee
              </label>
              <Select
                id={assigneeId}
                value={assignee}
                disabled={readOnly}
                onChange={(e) => setAssignee(e.target.value)}
              >
                <option value="">Unassigned</option>
                {assigneeMissing && (
                  <option value={assignee}>Someone who has left the workspace</option>
                )}
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={descriptionId}
              className="text-[11px] font-semibold uppercase tracking-wider text-text-dim"
            >
              Description
            </label>
            {readOnly && !card.description ? (
              <p className="text-sm text-text-dim italic">No description.</p>
            ) : (
              <textarea
                id={descriptionId}
                value={description}
                readOnly={readOnly}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add a description…"
                rows={7}
                className={`w-full text-sm text-text-muted bg-surface-2 border border-border rounded-lg p-3 outline-none resize-none ${
                  readOnly ? "cursor-default" : "focus-visible:border-accent"
                }`}
              />
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border shrink-0">
          {readOnly ? (
            // States why the actions are absent. Without it the footer just
            // looks empty and the panel reads as broken.
            <p className="text-xs text-text-muted">You have view-only access to this board.</p>
          ) : (
            <>
              <button
                onClick={handleDelete}
                disabled={deleting || saving}
                className="text-xs font-medium text-danger hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {deleting ? "Deleting…" : "Delete card"}
              </button>
              <div className="flex items-center gap-2.5 shrink-0">
                {canSave && <span className="text-[11px] text-text-dim">{shortcut}</span>}
                <Button size="sm" onClick={handleSave} disabled={!canSave}>
                  {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {dialog}
    </>
  );
}
