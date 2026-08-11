"use client";

import { useEffect, useRef, useState } from "react";
import { LabelChip } from "@/components/ui/LabelChip";
import { LABEL_COLORS, labelSwatchStyle } from "@/lib/labelColors";
import { useDialog } from "@/lib/useDialog";
import type { LabelColor, LabelResponse } from "@/lib/api";

/**
 * Applies labels to a card, and manages the board's vocabulary while it is open.
 *
 * Both in one popover on purpose. A label is nearly always invented at the
 * moment someone wants to apply it, and sending them to a separate settings
 * screen to create "Bug" before they can tag a bug is the kind of detour that
 * ends with nobody using labels at all. Trello and Linear both fold creation
 * into the picker for the same reason.
 */
export function LabelPicker({
  available,
  selected,
  readOnly,
  onApply,
  onCreate,
  onDelete,
  onOpenChange,
}: {
  /** The board's whole vocabulary, including labels this card doesn't carry. */
  available: LabelResponse[];
  selected: LabelResponse[];
  readOnly: boolean;
  /** The complete set the card should end up with — set semantics. */
  onApply: (labelIds: string[]) => Promise<void>;
  onCreate: (name: string, color: LabelColor) => Promise<void>;
  onDelete: (labelId: string) => Promise<void>;
  /**
   * Fired when the popover opens or closes.
   *
   * This traps the keyboard, and so does the card modal behind it. Both listen
   * on `document`, so without this one Escape closes the picker *and* the card
   * underneath it. Same contract as DatePicker, for the same reason.
   */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [color, setColor] = useState<LabelColor>("grey");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selectedIds = new Set(selected.map((l) => l.id));

  // Held in a ref and assigned in an effect, so an inline arrow from the caller
  // does not churn anything that depends on it.
  const openChangeRef = useRef(onOpenChange);
  useEffect(() => {
    openChangeRef.current = onOpenChange;
  });

  function setOpenAnd(next: boolean) {
    setOpen(next);
    openChangeRef.current?.(next);
  }

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function toggle(label: LabelResponse) {
    const next = selectedIds.has(label.id)
      ? selected.filter((l) => l.id !== label.id).map((l) => l.id)
      : [...selected.map((l) => l.id), label.id];
    void run(() => onApply(next));
  }

  if (readOnly) {
    return selected.length > 0 ? (
      <div className="flex flex-wrap gap-1 pt-1">
        {selected.map((l) => (
          <LabelChip key={l.id} label={l} />
        ))}
      </div>
    ) : (
      <p className="text-[13px] text-text-dim italic pt-1.5">None</p>
    );
  }

  return (
    <div className="relative flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1 pt-1">
        {selected.map((l) => (
          <LabelChip key={l.id} label={l} onRemove={() => toggle(l)} />
        ))}
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpenAnd(!open)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Add a label"
          className="text-[11px] px-2 py-0.5 rounded-full border border-dashed border-border-2 text-text-muted hover:text-text hover:border-border-2 hover:bg-surface-2 transition-colors cursor-pointer"
        >
          + Label
        </button>
      </div>

      {error && (
        <p role="alert" className="text-[11px] text-danger">
          {error}
        </p>
      )}

      {open && (
        <Popover
          ref={popoverRef}
          triggerRef={triggerRef}
          available={available}
          selectedIds={selectedIds}
          draft={draft}
          color={color}
          busy={busy}
          onDraft={setDraft}
          onColor={setColor}
          onToggle={toggle}
          onClose={() => setOpenAnd(false)}
          onCreate={() => {
            const name = draft.trim();
            if (!name) return;
            void run(async () => {
              await onCreate(name, color);
              setDraft("");
            });
          }}
          onDelete={(id) => void run(() => onDelete(id))}
        />
      )}
    </div>
  );
}

function Popover({
  ref: containerRef,
  triggerRef,
  available,
  selectedIds,
  draft,
  color,
  busy,
  onDraft,
  onColor,
  onToggle,
  onClose,
  onCreate,
  onDelete,
}: {
  ref: React.RefObject<HTMLDivElement | null>;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  available: LabelResponse[];
  selectedIds: Set<string>;
  draft: string;
  color: LabelColor;
  busy: boolean;
  onDraft: (value: string) => void;
  onColor: (color: LabelColor) => void;
  onToggle: (label: LabelResponse) => void;
  onClose: () => void;
  onCreate: () => void;
  onDelete: (labelId: string) => void;
}) {
  useDialog({ containerRef, onClose });

  // Closing on an outside click has to know about the trigger too, or a click
  // on it would close the popover and its own handler would reopen it.
  useOutsideClick(containerRef, triggerRef, onClose);

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label="Labels"
      className="absolute z-50 top-full left-0 mt-1.5 w-[248px] rounded-lg border border-border bg-surface shadow-lg p-2.5 flex flex-col gap-2 animate-[fade-up_0.12s_ease-out]"
    >
      {available.length > 0 ? (
        <div className="flex flex-col gap-0.5 max-h-[180px] overflow-y-auto">
          {available.map((label) => (
            <div key={label.id} className="flex items-center gap-1.5 group">
              <button
                type="button"
                onClick={() => onToggle(label)}
                disabled={busy}
                aria-pressed={selectedIds.has(label.id)}
                className="flex-1 min-w-0 flex items-center gap-2 px-1.5 py-1 rounded-md hover:bg-surface-2 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span
                  aria-hidden="true"
                  className={`w-3 h-3 rounded-[3px] shrink-0 border ${
                    selectedIds.has(label.id) ? "border-text" : "border-border-2"
                  }`}
                  style={selectedIds.has(label.id) ? labelSwatchStyle(label.color) : undefined}
                />
                <span className="flex-1 min-w-0 text-left">
                  <LabelChip label={label} size="sm" />
                </span>
              </button>
              {/* Revealed on the row, not the button: `opacity-0` on the button
                  itself would collide with its own `disabled:opacity-50`, and
                  the variant wins. */}
              <span className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                <button
                  type="button"
                  onClick={() => onDelete(label.id)}
                  disabled={busy}
                  aria-label={`Delete the label ${label.name}`}
                  title={`Delete "${label.name}" from this board`}
                  className="w-5 h-5 flex items-center justify-center rounded text-text-dim hover:text-danger transition-colors cursor-pointer"
                >
                  <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true">
                    <path
                      d="M1 1L11 11M11 1L1 11"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : (
        // S2.3: names the next action rather than just reporting emptiness.
        <p className="text-[11px] text-text-dim px-1.5 py-1">
          No labels on this board yet. Make the first one below.
        </p>
      )}

      <div className="border-t border-border pt-2 flex flex-col gap-1.5">
        <div className="flex items-center gap-1">
          {LABEL_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onColor(c)}
              aria-label={c}
              aria-pressed={color === c}
              style={labelSwatchStyle(c)}
              className={`w-4 h-4 rounded-[3px] cursor-pointer transition-transform ${
                color === c ? "ring-2 ring-offset-1 ring-offset-surface ring-text scale-110" : ""
              }`}
            />
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <input
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            placeholder="New label…"
            aria-label="New label name"
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onCreate();
              }
              // Contained, so the card modal behind this stays open.
              if (e.key === "Escape") {
                e.stopPropagation();
                e.preventDefault();
                onClose();
              }
            }}
            className="flex-1 min-w-0 text-[11px] bg-surface-2 border border-border rounded-md px-2 py-1 outline-none focus-visible:border-accent"
          />
          <button
            type="button"
            onClick={onCreate}
            disabled={busy || draft.trim().length === 0}
            className="text-[11px] font-medium px-2 py-1 rounded-md bg-accent text-accent-fg hover:bg-accent-h transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

function useOutsideClick(
  containerRef: React.RefObject<HTMLElement | null>,
  triggerRef: React.RefObject<HTMLElement | null>,
  onClose: () => void
) {
  // Held in a ref, assigned in an effect rather than during render: the caller
  // passes an inline arrow, and depending on it directly would tear down and
  // re-register the listener on every keystroke in the name field.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    // Registered for the popover's whole life, which is exactly the time it is
    // open — this component only exists while it is.
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      // The trigger has to be excluded too: a pointerdown on it would close the
      // popover here and its own click would immediately reopen it, so the
      // control would look like it never closes.
      if (containerRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      closeRef.current();
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [containerRef, triggerRef]);
}
