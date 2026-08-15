import { relativeTime } from "@/lib/relativeTime";
import type { WorkspaceBoardSummary } from "@/lib/api";

/**
 * The second line of a board's row on the workspace home.
 *
 * Shape first, then the one thing worth interrupting for. "4 columns · 22
 * cards" says how big the board is; what follows is either a problem or, when
 * there is no problem, how stale it is. Those two compete for the same slot on
 * purpose — a board that is over its limits is worth saying so about even if it
 * was touched a minute ago, and freshness is only interesting when nothing else
 * is wrong.
 *
 * Archived boards lead with the fact, because it changes how everything after
 * it should be read: counts on a board nobody is working in are history.
 */
export function boardMetaLine(
  board: Pick<
    WorkspaceBoardSummary,
    "archived" | "updatedAt" | "columnCount" | "cardCount" | "overLimitColumns"
  >,
  now: number = Date.now()
): string {
  const parts: string[] = [];

  if (board.archived) parts.push("Archived");

  parts.push(plural(board.columnCount, "column"));
  parts.push(plural(board.cardCount, "card"));

  if (board.overLimitColumns > 0) {
    parts.push(
      board.overLimitColumns === 1
        ? "1 column over its limit"
        : `${board.overLimitColumns} columns over their limits`
    );
  } else {
    parts.push(`updated ${relativeTime(board.updatedAt, now)}`);
  }

  return parts.join(" · ");
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
