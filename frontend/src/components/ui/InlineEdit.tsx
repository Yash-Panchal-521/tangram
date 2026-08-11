"use client";

import { useEffect, useId, useRef, useState } from "react";

// Read during render rather than in an effect. Safe from hydration mismatch
// because an inline editor only ever opens in response to a click, so this
// never runs during server-rendered markup.
function shortcutHint() {
  if (typeof navigator === "undefined") return "Ctrl + Enter saves";
  return /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘ + Enter saves" : "Ctrl + Enter saves";
}

/**
 * A value that reads as text until you click it, then becomes an editor.
 *
 * The interaction the card detail view is built on. A form behind a Save button
 * asks you to declare intent twice — once by typing, once by confirming — and
 * makes every field's fate depend on one button, so a failure loses all of them
 * together. Editing in place commits one field at a time, which is also why
 * `onCommit` reports failure per field rather than throwing to a shared handler.
 *
 * Rules it has to satisfy:
 *
 * - **S5.1** the read view is a real `<button>`, not text with an onClick, so it
 *   is tabbable and answers Enter and Space.
 * - **S5.3** Escape reverts and returns to the read view, and does *not* bubble
 *   — a dialog above would otherwise close on the same keystroke, which is the
 *   bug `useDialog`'s `paused` flag exists for elsewhere.
 * - **S1.3** the read and edit views swap class sets outright. Nothing appends a
 *   second `border-*`, because `cn()` would leave the winner to stylesheet order.
 * - **S8.1** `readOnly` renders the value as plain text with no affordance at
 *   all, rather than a disabled control: for a viewer the truth is "not you",
 *   not "not right now".
 */
export function InlineEdit({
  value,
  onCommit,
  readOnly = false,
  placeholder = "None",
  label,
  multiline = false,
  renderValue,
  className,
}: {
  value: string;
  /**
   * Persist the new value. Reject to reject the edit: the field reverts and
   * shows the reason next to itself (S3.6), rather than a silent revert that
   * looks like the keystroke never landed.
   */
  onCommit: (next: string) => Promise<void>;
  readOnly?: boolean;
  placeholder?: string;
  /** Names the control for assistive tech, since the read view is a button. */
  label: string;
  multiline?: boolean;
  /** Renders the read view. Defaults to the raw string. */
  renderValue?: (value: string) => React.ReactNode;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const [multilineHint] = useState(shortcutHint);

  // No effect syncing `draft` to `value`. The read view renders `value`
  // directly, so a change from outside — someone else editing this card — shows
  // up on the next render for free, and `draft` only has to be right from the
  // moment the editor opens. `open()` seeds it there. That also means a
  // broadcast can never overwrite what someone is part-way through typing.
  function open() {
    setDraft(value);
    setError(null);
    setEditing(true);
  }

  useEffect(() => {
    if (!editing) return;
    const field = fieldRef.current;
    field?.focus();
    // Caret to the end rather than selecting everything: editing an existing
    // value is usually an amendment, and select-all makes the first keystroke
    // destroy it.
    field?.setSelectionRange(field.value.length, field.value.length);
  }, [editing]);

  async function commit() {
    const next = draft.trim();
    if (next === value.trim()) {
      setEditing(false);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onCommit(next);
      setEditing(false);
    } catch (err) {
      setDraft(value);
      setError(err instanceof Error ? err.message : "That didn't save. Try again.");
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setDraft(value);
    setError(null);
    setEditing(false);
  }

  if (readOnly) {
    return (
      <div className={className}>
        <span className={`text-[13px] ${value ? "text-text" : "text-text-dim italic"}`}>
          {value ? (renderValue?.(value) ?? value) : placeholder}
        </span>
      </div>
    );
  }

  if (editing) {
    const shared =
      "w-full text-[13px] bg-surface border border-accent rounded-md px-2 py-1.5 outline-none";
    return (
      <div className={className}>
        {multiline ? (
          <textarea
            ref={fieldRef as React.RefObject<HTMLTextAreaElement>}
            aria-label={label}
            aria-describedby={error ? errorId : undefined}
            value={draft}
            rows={6}
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
            // Deliberately no commit on blur, unlike the single-line case. A
            // stray click outside a half-written paragraph would overwrite the
            // previous one, and with undo gone that is unrecoverable. One line
            // is cheap to retype; several are not, so this one asks.
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                // Contained, so the dialog above stays open.
                e.stopPropagation();
                e.preventDefault();
                cancel();
              }
              // Enter inserts a newline here; the shortcut commits. A bare
              // Enter cannot mean "save" in a field whose whole point is
              // multiple lines.
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void commit();
              }
            }}
            className={`${shared} resize-none leading-relaxed`}
          />
        ) : null}

        {multiline && (
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()} // keep focus, so blur can't race the click
              onClick={() => void commit()}
              disabled={saving}
              className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-accent text-accent-fg hover:bg-accent-h transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={cancel}
              disabled={saving}
              className="text-[11px] font-medium px-2.5 py-1 rounded-md text-text-muted hover:text-text hover:bg-surface-2 transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <span className="text-[10px] text-text-dim">{multilineHint}</span>
          </div>
        )}

        {!multiline && (
          <input
            ref={fieldRef as React.RefObject<HTMLInputElement>}
            aria-label={label}
            aria-describedby={error ? errorId : undefined}
            value={draft}
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                e.preventDefault();
                cancel();
              }
              if (e.key === "Enter") {
                e.preventDefault();
                void commit();
              }
            }}
            className={shared}
          />
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={open}
        aria-label={`${label}. Select to edit.`}
        className={`w-full text-left text-[13px] rounded-md px-2 py-1.5 border border-transparent hover:bg-surface-2 hover:border-border transition-colors cursor-pointer ${
          value ? "text-text" : "text-text-dim italic"
        } ${multiline ? "whitespace-pre-wrap leading-relaxed" : "truncate"}`}
      >
        {value ? (renderValue?.(value) ?? value) : placeholder}
      </button>

      {/* Sits under the field rather than in a shared banner: with each field
          saving on its own, "that didn't save" is meaningless unless it says
          which one (S3.2). */}
      {error && (
        <p id={errorId} role="alert" className="text-[11px] text-danger px-2 pt-1">
          {error}
        </p>
      )}
    </div>
  );
}
