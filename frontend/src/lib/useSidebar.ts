"use client";

import { useSyncExternalStore } from "react";

const KEY = "tangram.sidebar.collapsed";

/**
 * Whether the sidebar is collapsed, remembered across visits and tabs.
 *
 * Persisted because the trade-off it settles is personal and permanent: the
 * board is the widest surface in the app and scrolls horizontally, so anyone on
 * a laptop wants those pixels back and wants them back *every* time. Asking
 * again each load would be asking the same question daily.
 *
 * `useSyncExternalStore` rather than state seeded in an effect. Reading storage
 * during render would make the server and the client disagree on the first
 * paint; reading it in an effect and calling `setState` is a cascading render,
 * and the sidebar visibly snaps shut after arriving open. This hook exists
 * precisely for the case of "a value that lives outside React and has no
 * meaningful server snapshot" — the server one is `false`, so it renders
 * expanded and reconciles once, without a second render pass of our own.
 *
 * The subscription also picks up the `storage` event, so collapsing it in one
 * tab collapses it in the others. That is a side effect of doing this properly
 * rather than a feature that was asked for, but it is the behaviour anyone
 * would expect of a remembered preference.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // `storage` fires in *other* tabs only, which is why the local set exists.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getSnapshot(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    // Private browsing and blocked storage both throw. A sidebar that forgets
    // is a small loss; one that crashes the page is not.
    return false;
  }
}

/** Expanded, because the server cannot know and this is the safer first paint. */
function getServerSnapshot(): boolean {
  return false;
}

export function useSidebar(): { collapsed: boolean; toggle: () => void } {
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function toggle() {
    try {
      window.localStorage.setItem(KEY, collapsed ? "0" : "1");
    } catch {
      // As above — the preference simply does not outlive the session. The
      // emit still happens, so the sidebar moves either way.
    }
    listeners.forEach((notify) => notify());
  }

  return { collapsed, toggle };
}
