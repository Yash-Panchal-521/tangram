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
  paused = false,
}: {
  containerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  /**
   * Stand down while something is stacked on top. Both dialogs listen on
   * `document`, so without this an Escape meant for a confirmation would also
   * close the panel underneath it — dismissing the very thing the confirmation
   * was protecting.
   *
   * A pause rather than an unmount: tearing the effect down would run its
   * cleanup and hand focus back to the trigger mid-confirmation.
   */
  paused?: boolean;
}) {
  // Held in refs so a caller passing an inline arrow doesn't re-run the effect
  // on every render — that would re-fire the initial focus and yank the caret
  // back to the top of the dialog on every keystroke.
  const onCloseRef = useRef(onClose);
  const pausedRef = useRef(paused);
  useEffect(() => {
    onCloseRef.current = onClose;
    pausedRef.current = paused;
  });

  useEffect(() => {
    const container = containerRef.current;
    // Captured before anything is focused. Reading document.activeElement at
    // cleanup instead would return a control inside the dialog that is by then
    // being removed, and focus would fall to <body>.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(container?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);

    (initialFocusRef?.current ?? focusable()[0])?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (pausedRef.current) return;

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
      previouslyFocused?.focus?.();
    };
  }, [containerRef, initialFocusRef]);
}
