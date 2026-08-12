"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { placeMenu } from "@/components/ui/Menu";
import { useDialog } from "@/lib/useDialog";
import { useOutsideClick } from "@/lib/useOutsideClick";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** Drawn before the label in both the list and the trigger. */
  icon?: ReactNode;
  /** Dimmer, for "None" and "Unassigned" — an absence, not a choice like the others. */
  muted?: boolean;
}

/**
 * A single-choice field that draws its own list.
 *
 * Replaces `<select>` in the card's context column. The native control was
 * chosen for exactly one reason — keyboard and mobile behaviour for free — and
 * the cost turned out to be worse than the saving: the option list is painted by
 * the operating system, so it arrives as a white box with a system-blue
 * highlight in a warm-toned app, ignoring every token, and it cannot show the
 * priority icon or an assignee's avatar beside a name.
 *
 * So the keyboard contract is implemented here rather than inherited: Up and
 * Down move, Home and End reach the ends, Enter and Space choose, Escape closes
 * without choosing, and focus returns to the trigger. Options are focused
 * directly rather than tracked with `aria-activedescendant`, which keeps the
 * focus ring real and works with the dialog trap this often sits inside.
 *
 * `<select>` stays elsewhere. On a settings form a native control is still the
 * right answer; this exists because a field in the card detail has to look like
 * part of the card.
 */
export function SelectMenu<T extends string>({
  id,
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  id?: string;
  /** Accessible name — the visible label sits beside it in the context row. */
  label: string;
  value: T;
  options: SelectOption<T>[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  // Width is measured here with the position rather than read from the ref
  // at render time — a ref's value during render is whatever the last commit
  // left behind, which is not a thing React guarantees anything about.
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const selected = options.find((o) => o.value === value) ?? options[0];

  useOutsideClick(() => setOpen(false), [triggerRef, listRef], open);

  useEffect(() => {
    if (!open) return;
    // Measured once on open, so anything that moves the trigger would strand
    // the list. Closing is less jarring than a panel chasing its field.
    const close = () => setOpen(false);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      // Left-aligned and at least as wide as the field, so the list reads as
      // the field opening rather than a separate popup arriving beside it.
      const at = placeMenu(rect, window.innerWidth, "left");
      setAnchor({ top: at.top, left: at.left ?? rect.left, width: rect.width });
    }
    setOpen(true);
  }

  return (
    <div className="relative">
      <button
        id={id}
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={toggle}
        onKeyDown={(e) => {
          // Opening with an arrow is what a native select does, and it is how
          // most people reach the list without touching the mouse.
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) toggle();
          }
        }}
        className={`w-full flex items-center gap-1.5 text-[13px] rounded-md border pl-2 pr-7 py-1 text-left transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed relative ${
          open
            ? "bg-surface border-accent"
            : "bg-transparent border-transparent hover:bg-surface hover:border-border"
        }`}
      >
        {selected?.icon && (
          <span aria-hidden="true" className="flex items-center shrink-0">
            {selected.icon}
          </span>
        )}
        <span className={`flex-1 min-w-0 truncate ${selected?.muted ? "text-text-dim italic" : ""}`}>
          {selected?.label ?? "—"}
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden="true"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-text-dim"
        >
          <path d="M2 4L5 7L8 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && anchor && (
        <Listbox
          ref={listRef}
          anchor={anchor}
          label={label}
          value={value}
          options={options}
          onPick={(next) => {
            setOpen(false);
            if (next !== value) onChange(next);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function Listbox<T extends string>({
  ref,
  anchor,
  label,
  value,
  options,
  onPick,
  onClose,
}: {
  ref: React.RefObject<HTMLDivElement | null>;
  anchor: { top: number; left: number; width: number };
  label: string;
  value: T;
  options: SelectOption<T>[];
  onPick: (value: T) => void;
  onClose: () => void;
}) {
  // Starts on the current value rather than the first option, so opening a
  // field and pressing Down moves *from where you are*.
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useDialog({ containerRef: ref, onClose });

  useEffect(() => {
    itemRefs.current[active]?.focus();
  }, [active]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(options.length - 1);
    }
  }

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={{ top: anchor.top, left: anchor.left, minWidth: Math.max(anchor.width, 180) }}
      className="fixed z-50 max-h-[280px] overflow-y-auto rounded-lg border border-border bg-surface shadow-lg py-1 animate-[fade-up_0.12s_ease-out]"
    >
      {options.map((option, i) => {
        const isSelected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            type="button"
            role="option"
            aria-selected={isSelected}
            tabIndex={i === active ? 0 : -1}
            onClick={() => onPick(option.value)}
            className={`w-full flex items-center gap-2 text-left text-[13px] px-2.5 py-1.5 transition-colors cursor-pointer ${
              isSelected ? "bg-accent/10 text-text font-medium" : "hover:bg-surface-2"
            }`}
          >
            {option.icon && (
              <span aria-hidden="true" className="flex items-center shrink-0">
                {option.icon}
              </span>
            )}
            <span className={`flex-1 min-w-0 truncate ${option.muted ? "text-text-dim italic" : ""}`}>
              {option.label}
            </span>
            {/* A tick, not just a tint: the highlight is also what "focused"
                looks like, so without this the current value is ambiguous the
                moment you arrow past it (S5.2). */}
            {isSelected && (
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="shrink-0 text-accent">
                <path
                  d="M2.5 6.2l2.2 2.2 4.8-4.8"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );
}
