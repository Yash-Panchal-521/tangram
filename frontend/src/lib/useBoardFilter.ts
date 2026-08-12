"use client";

import { useEffect, useState } from "react";
import { applyFilterToUrl, EMPTY_FILTER, parseFilter, type BoardFilter } from "@/lib/boardFilter";

/**
 * The board's filter, kept in the URL.
 *
 * Read from `window.location` rather than `useSearchParams()`, matching
 * `useCardParam` and the auth pages: the hook would force this route to become
 * dynamic or demand a Suspense boundary, for four parameters.
 *
 * `replaceState`, never `pushState` — see `boardFilter.ts`. The `popstate`
 * listener is still needed: `?card=` shares this URL and does push, so closing a
 * card with Back must not leave the bar showing a filter the URL no longer has.
 */
export function useBoardFilter(): {
  filter: BoardFilter;
  setFilter: (next: BoardFilter) => void;
  clear: () => void;
} {
  const [filter, setFilterState] = useState<BoardFilter>(EMPTY_FILTER);

  useEffect(() => {
    function read() {
      setFilterState(parseFilter(window.location.search));
    }

    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  function setFilter(next: BoardFilter) {
    window.history.replaceState(null, "", applyFilterToUrl(new URL(window.location.href), next));
    setFilterState(next);
  }

  return { filter, setFilter, clear: () => setFilter(EMPTY_FILTER) };
}
