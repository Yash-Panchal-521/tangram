import { daysUntilDue } from "@/lib/dueDate";
import { PRIORITIES } from "@/lib/priority";
import type { BoardDetailResponse, CardPriority, CardResponse } from "@/lib/api";

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
  /**
   * User ids, plus `UNASSIGNED` for cards with nobody on them. Empty means every
   * assignee, including nobody.
   */
  assignees: string[];
  /** Label ids. A card matches if it carries *any* of them, not all. */
  labels: string[];
  /** Priority levels. Empty means all, including cards with no priority. */
  priorities: CardPriority[];
  /** One window, not several — "overdue and due this week" is just "this week". */
  due: DueWindow;
  /** Updated within the last 24 hours — Jira's own "Recently Updated". */
  recent: boolean;
}

/**
 * A card with nobody on it, as an entry in `assignees`.
 *
 * A sentinel rather than a separate flag because it belongs to the same
 * question: "whose cards?" A flag would need its own control, and two controls
 * over one axis is what made the first version of this bar confusing. Firebase
 * uids are 28-character alphanumerics, so this cannot collide with one.
 */
export const UNASSIGNED = "unassigned";

export type DueWindow = "any" | "overdue" | "today" | "week" | "none";

export const EMPTY_FILTER: BoardFilter = {
  text: "",
  assignees: [],
  labels: [],
  priorities: [],
  due: "any",
  recent: false,
};

/** A day in milliseconds; the window "Recently updated" means. */
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isFilterActive(filter: BoardFilter): boolean {
  return (
    filter.text.trim().length > 0 ||
    filter.assignees.length > 0 ||
    filter.labels.length > 0 ||
    filter.priorities.length > 0 ||
    filter.due !== "any" ||
    filter.recent
  );
}

/**
 * Whether a card falls in the chosen due window.
 *
 * Windows nest rather than stack: "this week" includes what is overdue and what
 * is due today, because a person asking what is due this week is not asking to
 * be shown only the days after tomorrow. Offering them separately as checkboxes
 * would let someone pick "overdue" *and* "this week" and get exactly "this
 * week", which reads as a broken control.
 *
 * Counted in days here rather than borrowed from `dueStatus`, which answers a
 * different question: its "soon" is a two-day horizon chosen for the pill on a
 * card face, where the point is "act on this now". A filter window called "this
 * week" has to mean a week, or it quietly returns two days of cards.
 */
function matchesDue(card: CardResponse, due: DueWindow, now: number): boolean {
  if (due === "any") return true;
  if (due === "none") return card.dueAt === null;
  if (card.dueAt === null) return false;

  const days = daysUntilDue(card.dueAt, now);
  if (due === "overdue") return days < 0;
  if (due === "today") return days <= 0;
  return days <= 7;
}

export function matchesFilter(card: CardResponse, filter: BoardFilter, now: number): boolean {
  const text = filter.text.trim().toLowerCase();
  if (text) {
    // Description included, because half of what makes a card findable is
    // written there rather than in a summary someone kept short.
    const haystack = `${card.title} ${card.description ?? ""}`.toLowerCase();
    if (!haystack.includes(text)) return false;
  }

  // "Unassigned" is a choice in the same list, so it composes: Sara plus
  // unassigned means both, which is how you find work that is either yours to
  // pick up or already hers.
  if (filter.assignees.length > 0) {
    const matched = card.assigneeId
      ? filter.assignees.includes(card.assigneeId)
      : filter.assignees.includes(UNASSIGNED);
    if (!matched) return false;
  }

  // Any, not all. Labels here are tags rather than facets, and requiring every
  // selected label makes two-label selections almost always empty.
  if (filter.labels.length > 0) {
    if (!card.labels.some((l) => filter.labels.includes(l.id))) return false;
  }

  // Empty means all, including cards with no priority — the same rule the
  // other lists follow. "No priority" is a level in the menu, not the absence
  // of a choice.
  if (filter.priorities.length > 0) {
    if (!card.priority || !filter.priorities.includes(card.priority)) return false;
  }

  if (!matchesDue(card, filter.due, now)) return false;

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

  const due = params.get("due");

  return {
    text: params.get("q") ?? "",
    assignees: list("assignee"),
    labels: list("label"),
    // Validated against the enum rather than trusted: this comes from a URL
    // somebody may have hand-edited, and an unknown level would silently match
    // nothing while the bar showed a filter nobody could remove.
    priorities: list("priority").filter((p): p is CardPriority =>
      (PRIORITIES as readonly string[]).includes(p)
    ),
    due: isDueWindow(due) ? due : "any",
    recent: params.get("recent") === "1",
  };
}

function isDueWindow(value: string | null): value is DueWindow {
  return value === "overdue" || value === "today" || value === "week" || value === "none";
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
  set("priority", filter.priorities.join(","));
  set("due", filter.due === "any" ? "" : filter.due);
  set("recent", filter.recent ? "1" : "");
  return url;
}
