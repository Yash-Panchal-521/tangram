"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useDialog } from "@/lib/useDialog";
import { useOutsideClick } from "@/lib/useOutsideClick";

/**
 * A `⋯` overflow menu.
 *
 * Extracted at the third copy — the card's actions, the column's actions, and
 * `UserMenu` before them — because two details are easy to get wrong and both
 * fail invisibly:
 *
 * - **Fixed positioning, measured from the trigger.** The board area is
 *   `overflow-x-auto overflow-y-hidden` and the page shells are
 *   `overflow-hidden`, so an absolutely positioned dropdown is clipped by an
 *   ancestor several levels up. Fixed escapes the clip without a portal.
 * - **Escape belongs to the innermost layer.** Registering with `useDialog`
 *   rather than stopping the key at the element, because React dispatches from
 *   its root container: by the time a handler runs the native event has passed
 *   the element, and a modal listening on `document` still closes underneath.
 *   That is exactly the bug the card detail hit.
 *
 * `children` is a render prop so an item can decide whether selecting it closes
 * the menu. "Delete" should; "Copy link" should not, because the confirmation
 * that it worked is the menu item's own label changing.
 */
/** Matches `min-w-[180px]` on the panel — the narrowest it can render. */
const MIN_WIDTH = 180;
/** Never flush against the viewport edge. */
const EDGE = 8;

/**
 * Where the panel goes, given the trigger.
 *
 * Pure so the clamping can be tested without layout — jsdom reports every rect
 * as zero, so this is not something a render test can check.
 *
 * Both edges are clamped, not just one. Clamping only the near edge still lets
 * a right-aligned menu run off the *left* when its trigger sits near the left
 * of the window, which is every column menu on a narrow screen once the board
 * is scrolled.
 */
export function placeMenu(
  trigger: { bottom: number; left: number; right: number },
  viewportWidth: number,
  align: "left" | "right"
): { top: number; left?: number; right?: number } {
  const top = trigger.bottom + 4;

  if (align === "right") {
    const preferred = viewportWidth - trigger.right;
    const widest = viewportWidth - MIN_WIDTH - EDGE;
    return { top, right: Math.min(Math.max(preferred, EDGE), Math.max(widest, EDGE)) };
  }

  const widest = viewportWidth - MIN_WIDTH - EDGE;
  return { top, left: Math.min(Math.max(trigger.left, EDGE), Math.max(widest, EDGE)) };
}

export function Menu({
  label,
  trigger,
  disabled = false,
  align = "right",
  children,
}: {
  /** The trigger's accessible name — "Card actions", "Column actions". */
  label: string;
  /**
   * Visible trigger content. Omitted, it is a `⋯`.
   *
   * The dots are right for *actions on this thing* — the card's, the column's —
   * where the menu is an overflow and the surrounding UI says what it belongs
   * to. They are wrong for a control that selects something, which is how the
   * label filter shipped as an unlabelled `⋯` sitting beside a search box, with
   * nothing anywhere saying it meant labels.
   */
  trigger?: ReactNode;
  disabled?: boolean;
  align?: "left" | "right";
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left?: number; right?: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => setOpen(false), []);

  useOutsideClick(close, [triggerRef, menuRef], open);

  useEffect(() => {
    if (!open) return;
    // Measured once, so anything that moves the trigger would strand the menu.
    // Closing is simpler than recomputing mid-scroll, and less jarring.
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open, close]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setAnchor(placeMenu(rect, window.innerWidth, align));
    }
    setOpen(true);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        // Two shapes, chosen per branch rather than appended — `cn()` resolves
        // no Tailwind conflicts (S1.3).
        className={
          trigger
            ? `flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-[12px] font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                open
                  ? "bg-surface-2 border-border-2 text-text"
                  : "bg-surface-2 border-border text-text-muted hover:text-text hover:border-border-2"
              }`
            : "w-6 h-6 flex items-center justify-center rounded-md text-text-muted hover:text-text hover:bg-surface-2 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        }
      >
        {trigger ?? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
            <circle cx="3" cy="7" r="1.3" />
            <circle cx="7" cy="7" r="1.3" />
            <circle cx="11" cy="7" r="1.3" />
          </svg>
        )}
        {trigger && (
          <svg
            width="9"
            height="9"
            viewBox="0 0 10 10"
            fill="none"
            aria-hidden="true"
            className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          >
            <path d="M2 4L5 7L8 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {open && anchor && (
        <MenuPanel ref={menuRef} anchor={anchor} onClose={close}>
          {children(close)}
        </MenuPanel>
      )}
    </>
  );
}

function MenuPanel({
  ref,
  anchor,
  onClose,
  children,
}: {
  ref: RefObject<HTMLDivElement | null>;
  anchor: { top: number; left?: number; right?: number };
  onClose: () => void;
  children: ReactNode;
}) {
  // Split out so `useDialog` only registers while the menu is mounted —
  // registration is what decides who owns Escape.
  useDialog({ containerRef: ref, onClose });

  return (
    <div
      ref={ref}
      role="menu"
      style={{ top: anchor.top, left: anchor.left, right: anchor.right }}
      className="fixed z-50 min-w-[180px] rounded-lg border border-border bg-surface shadow-lg py-1 animate-[fade-up_0.12s_ease-out]"
    >
      {children}
    </div>
  );
}

export function MenuItem({
  onSelect,
  tone = "default",
  children,
}: {
  onSelect: () => void;
  tone?: "default" | "danger";
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={`w-full text-left text-[13px] px-3 py-1.5 hover:bg-surface-2 transition-colors cursor-pointer ${
        tone === "danger" ? "text-danger" : "text-text"
      }`}
    >
      {children}
    </button>
  );
}

/** A rule between groups of items — destructive actions sit below one. */
export function MenuSeparator() {
  return <div className="my-1 border-t border-border" />;
}
