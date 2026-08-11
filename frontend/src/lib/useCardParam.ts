"use client";

import { useEffect, useState } from "react";

/**
 * Which card is open, kept in the URL as `?card={id}`.
 *
 * In the URL rather than in component state for two reasons. A card becomes
 * linkable, which matters as soon as it holds anything worth pointing someone
 * at. And Back closes it, which is what a person expects of something that
 * covers the page.
 *
 * Jira does the same thing on a board — `?selectedIssue=` — rather than routing
 * to a separate page, and for the same reason: the board behind stays mounted,
 * so closing the card is instant and the board never reloads.
 *
 * Read from `window.location` rather than `useSearchParams()`, matching the auth
 * pages: the hook would force a statically prerendered route to become dynamic
 * or demand a Suspense boundary, for one parameter.
 */
export function useCardParam(): {
  openCardId: string | null;
  openCard: (id: string) => void;
  closeCard: () => void;
} {
  const [openCardId, setOpenCardId] = useState<string | null>(null);

  useEffect(() => {
    function read() {
      setOpenCardId(new URLSearchParams(window.location.search).get("card"));
    }

    read();
    // What makes the Back button close the card rather than leave the board.
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  function openCard(id: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("card", id);
    window.history.pushState(null, "", url);
    setOpenCardId(id);
  }

  function closeCard() {
    const url = new URL(window.location.href);
    url.searchParams.delete("card");
    // replaceState, not pushState. Closing must not leave an entry that Back
    // then re-opens, which would make the button look broken -- you would press
    // it expecting to leave the board and get the card again instead.
    window.history.replaceState(null, "", url);
    setOpenCardId(null);
  }

  return { openCardId, openCard, closeCard };
}
