"use client";

import { useCallback, useEffect, useState } from "react";

const PREFIX = "tangram-seen:";

export type SeenState = "unknown" | "unseen" | "seen";

/**
 * "Has this person already been shown X?", persisted per browser.
 *
 * Starts at `unknown` rather than `unseen`. localStorage cannot be read during
 * render on the server, and guessing `unseen` would flash the introduction at
 * someone who dismissed it months ago — the one thing a first-run experience
 * must never do.
 *
 * Deliberately per-browser, not per-account: there is no server field for this,
 * and inventing one to store a UI preference would put a migration and an
 * endpoint behind a boolean.
 */
export function useSeenOnce(key: string) {
  const [state, setState] = useState<SeenState>("unknown");

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(PREFIX + key);
    } catch {
      // Private browsing and blocked storage both throw on access. Treating
      // that as "already seen" is the quiet failure: the introduction simply
      // doesn't play, rather than replaying on every single visit.
      stored = "1";
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(stored ? "seen" : "unseen");
  }, [key]);

  const markSeen = useCallback(() => {
    setState("seen");
    try {
      window.localStorage.setItem(PREFIX + key, "1");
    } catch {
      // Nothing to do — the in-memory state above still ends the current run.
    }
  }, [key]);

  const forget = useCallback(() => {
    setState("unseen");
    try {
      window.localStorage.removeItem(PREFIX + key);
    } catch {
      /* see above */
    }
  }, [key]);

  return { state, markSeen, forget };
}
