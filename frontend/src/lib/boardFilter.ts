import type { BoardDetailResponse, CardResponse } from "@/lib/api";

/**
 * What the board is currently showing.
 *
 * Deliberately not board state: a filter is one person's view, so it never goes
 * through `SaveAsync` and is never broadcast. It lives in the URL instead, which
 * makes a filtered board linkable — "here are the cards still assigned to me".
 *
 * Unlike `?card=`, changing a filter replaces the history entry rather than
 * pushing one. Search runs per keystroke, so pushing would bury the board under
 * an entry per character and leave Back meaning "delete one letter" for the next
 * twenty presses.
 */
export interface BoardFilter {
  /** Matched against title and description, case-insensitively. */
  text: string;
  /** User ids. Empty means every assignee, including nobody. */
  assignees: string[];
  /** Label ids. A card matches if it carries *any* of them, not all. */
  labels: string[];
  /** Updated within the last 24 hours — Jira's own "Recently Updated". */
  recent: boolean;
}

export const EMPTY_FILTER: BoardFilter = {
  text: "",
  assignees: [],
  labels: [],
  recent: false,
};

/** A day in milliseconds; the window "Recently updated" means. */
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isFilterActive(filter: BoardFilter): boolean {
  return (
    filter.text.trim().length > 0 ||
    filter.assignees.length > 0 ||
    filter.labels.length > 0 ||
    filter.recent
  );
}

export function matchesFilter(card: CardResponse, filter: BoardFilter, now: number): boolean {
  const text = filter.text.trim().toLowerCase();
  if (text) {
    // Description included, because half of what makes a card findable is
    // written there rather than in a summary someone kept short.
    const haystack = `${card.title} ${card.description ?? ""}`.toLowerCase();
    if (!haystack.includes(text)) return false;
  }

  // Unassigned cards match no assignee filter. Selecting people is a question
  // about people, and "nobody" is not one of them — it is what the empty
  // selection already means.
  if (filter.assignees.length > 0) {
    if (!card.assigneeId || !filter.assignees.includes(card.assigneeId)) return false;
  }

  // Any, not all. Labels here are tags rather than facets, and requiring every
  // selected label makes two-label selections almost always empty.
  if (filter.labels.length > 0) {
    if (!card.labels.some((l) => filter.labels.includes(l.id))) return false;
  }

  if (filter.recent && now - Date.parse(card.updatedAt) > RECENT_WINDOW_MS) return false;

  return true;
}

/**
 * The board as the filter leaves it.
 *
 * Columns are kept even when every card in them is hidden. A column is the
 * board's structure, not its contents — dropping one from the view would make a
 * filter look like it deleted a stage of the workflow, and would leave nowhere
 * to drop a card that would then match.
 */
export function filterBoard(
  board: BoardDetailResponse,
  filter: BoardFilter,
  now: number
): BoardDetailResponse {
  if (!isFilterActive(filter)) return board;

  return {
    ...board,
    columns: board.columns.map((column) => ({
      ...column,
      cards: column.cards.filter((card) => matchesFilter(card, filter, now)),
    })),
  };
}

export function countMatches(board: BoardDetailResponse): number {
  return board.columns.reduce((total, column) => total + column.cards.length, 0);
}

/** `?q=&assignee=&label=&recent=` — read straight from a query string. */
export function parseFilter(search: string): BoardFilter {
  const params = new URLSearchParams(search);
  const list = (key: string) =>
    (params.get(key) ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

  return {
    text: params.get("q") ?? "",
    assignees: list("assignee"),
    labels: list("label"),
    recent: params.get("recent") === "1",
  };
}

/**
 * Writes the filter onto a URL, deleting rather than emptying each parameter.
 *
 * `?q=&assignee=` is a URL that says nothing and does not round-trip to the same
 * thing it came from — and it is what people copy and send each other.
 */
export function applyFilterToUrl(url: URL, filter: BoardFilter): URL {
  const set = (key: string, value: string) => {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  };

  set("q", filter.text.trim());
  set("assignee", filter.assignees.join(","));
  set("label", filter.labels.join(","));
  set("recent", filter.recent ? "1" : "");
  return url;
}
