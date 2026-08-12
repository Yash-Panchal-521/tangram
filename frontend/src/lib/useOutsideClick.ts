"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Close a popover when a pointer goes down anywhere outside it.
 *
 * `pointerdown` rather than `click`, because a click only lands after the
 * button is released — long enough for the thing underneath to have taken focus
 * first, which makes the popover look like it closed a beat late.
 *
 * Takes every element that counts as "inside", not just the popover: a
 * pointerdown on the trigger must not close it here, or the trigger's own
 * toggle immediately reopens what this just closed and the popover appears
 * stuck open.
 */
export function useOutsideClick(
  onOutside: () => void,
  inside: RefObject<HTMLElement | null>[],
  active = true
) {
  // Both held in refs so callers can pass inline arrays and arrow functions
  // without re-subscribing the listener on every render.
  const onOutsideRef = useRef(onOutside);
  const insideRef = useRef(inside);
  useEffect(() => {
    onOutsideRef.current = onOutside;
    insideRef.current = inside;
  });

  useEffect(() => {
    if (!active) return;

    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node | null;
      if (insideRef.current.some((ref) => ref.current?.contains(target ?? null))) return;
      onOutsideRef.current();
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [active]);
}
