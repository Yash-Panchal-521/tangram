import { describe, expect, it } from "vitest";
import { boardMetaLine } from "@/lib/boardMeta";

const NOW = Date.parse("2026-08-15T12:00:00Z");
const hoursAgo = (n: number) => new Date(NOW - n * 3600_000).toISOString();

const board = (over: Partial<Parameters<typeof boardMetaLine>[0]> = {}) => ({
  archived: false,
  updatedAt: hoursAgo(2),
  columnCount: 4,
  cardCount: 22,
  overLimitColumns: 0,
  ...over,
});

describe("boardMetaLine", () => {
  it("says how big the board is, then how stale", () => {
    expect(boardMetaLine(board(), NOW)).toBe("4 columns · 22 cards · updated 2h ago");
  });

  it("replaces the timestamp with the problem when there is one", () => {
    // They share a slot deliberately: a board over its limits is worth saying so
    // about even if it was touched a minute ago, and freshness only matters when
    // nothing else is wrong.
    expect(boardMetaLine(board({ overLimitColumns: 1 }), NOW)).toBe(
      "4 columns · 22 cards · 1 column over its limit"
    );
    expect(boardMetaLine(board({ overLimitColumns: 3 }), NOW)).toBe(
      "4 columns · 22 cards · 3 columns over their limits"
    );
  });

  it("leads with archived, because it changes how the rest reads", () => {
    // Counts on a board nobody is working in are history, not status.
    expect(boardMetaLine(board({ archived: true }), NOW)).toBe(
      "Archived · 4 columns · 22 cards · updated 2h ago"
    );
  });

  it("counts one of a thing in the singular", () => {
    expect(boardMetaLine(board({ columnCount: 1, cardCount: 1 }), NOW)).toContain(
      "1 column · 1 card"
    );
  });

  it("says nothing odd about an empty board", () => {
    // A brand new board has no columns and no cards, and "0 columns" is the
    // honest thing to say — the row still has to render.
    expect(boardMetaLine(board({ columnCount: 0, cardCount: 0 }), NOW)).toBe(
      "0 columns · 0 cards · updated 2h ago"
    );
  });
});
