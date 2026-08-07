"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * The CSS in `globals.css` already stops declarative animation under this
 * preference. This is for the cases CSS can't reach: a scripted sequence that
 * advances on timers should not merely animate instantly, it should not play at
 * all — the user is told the ending directly instead.
 *
 * `useSyncExternalStore` rather than an effect, so there is no first paint at
 * the wrong value and no `setState` inside an effect for the linter to object
 * to. The server snapshot is `false`: the preference is unknowable there, and
 * assuming motion is fine means the client corrects downward, never upward into
 * an animation someone opted out of.
 */
export function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false
  );
}
