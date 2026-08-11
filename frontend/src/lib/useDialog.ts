"use client";

import { useEffect, useRef, type RefObject } from "react";

// Deliberately excludes tabindex="-1": those are programmatic focus targets,
// not stops in the tab order, so including them would make Shift+Tab land
// somewhere the user never tabbed to.
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Every dialog currently open, in the order they registered. */
const open: { id: symbol; container: HTMLElement | null }[] = [];

/**
 * Which dialog owns the keyboard: the innermost one, breaking ties by whichever
 * registered last.
 *
 * Module-level on purpose. The alternative — each dialog telling its parent
 * "something is stacked above you, stand down" — is what this replaced, and it
 * was wrong twice: the card modal closed underneath its own date picker, and
 * then again underneath a comment's delete confirmation. Both were the same
 * mistake, because that design makes correctness depend on a parent knowing
 * about an overlay two components away and remembering to forward a flag.
 *
 * Containment rather than registration order, which is the subtle part. React
 * runs child effects before parent ones, so two dialogs that mount in the same
 * commit register innermost-first and the *outer* one would be "last". Asking
 * the DOM who is inside whom is the only reading that holds either way. Dialogs
 * that are siblings rather than nested contain nothing, so they fall through to
 * the tie-break and the newest wins.
 */
function ownsKeyboard(id: symbol) {
  const innermost = open.filter(
    (d) => !open.some((other) => other !== d && d.container?.contains(other.container)),
  );
  return innermost[innermost.length - 1]?.id === id;
}

/**
 * The keyboard half of a modal overlay: Escape closes (S5.3), focus returns to
 * whatever opened it (S5.4), and Tab cycles inside it (S5.5).
 *
 * Shared rather than reimplemented per overlay because the failure mode is
 * invisible — an overlay missing the trap looks perfect and silently drops the
 * keyboard user onto the page behind it.
 */
export function useDialog({
  containerRef,
  onClose,
  initialFocusRef,
}: {
  containerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
}) {
  // Held in refs so a caller passing an inline arrow doesn't re-run the effect
  // on every render — that would re-fire the initial focus and yank the caret
  // back to the top of the dialog on every keystroke.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const id = Symbol("dialog");
    const container = containerRef.current;
    open.push({ id, container });
    // Captured before anything is focused. Reading document.activeElement at
    // cleanup instead would return a control inside the dialog that is by then
    // being removed, and focus would fall to <body>.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(container?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);

    (initialFocusRef?.current ?? focusable()[0])?.focus();

    function onKeyDown(e: KeyboardEvent) {
      // Something is stacked above: the key belongs to it, not to us.
      if (!ownsKeyboard(id)) return;

      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;

      // Re-queried on every press: a dialog's controls change while it is open
      // (Save enables once dirty, Delete becomes disabled mid-request), so a
      // list captured at mount would cycle through stale nodes.
      const items = focusable();
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const outside = !container?.contains(active);

      if (e.shiftKey && (active === first || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // By identity, not pop: a dialog can outlive one that opened after it.
      const at = open.findIndex((d) => d.id === id);
      if (at !== -1) open.splice(at, 1);
      previouslyFocused?.focus?.();
    };
  }, [containerRef, initialFocusRef]);
}
