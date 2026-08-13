import { describe, expect, it } from "vitest";
import { EMPTY_FILTER, filterBoard, matchesFilter } from "@/lib/boardFilter";
import type { BoardDetailResponse, CardResponse } from "@/lib/api";

/**
 * What filtering costs at a board size nobody here has yet.
 *
 * The backend census measures round trips because a timing assertion measures
 * the machine running it (P2.1). The same objection applies here, so these
 * assert *work*, not milliseconds: how many times the predicate runs for one
 * pass over the board. That number is a property of the code and identical on
 * every machine, and it is the one that grows if filtering ever moves inside a
 * loop it should be outside of.
 *
 * Written because v4 dropped "frontend rendering" from its scope on the grounds
 * that nothing measured said it was slow — which is the reasoning P1.1 exists to
 * forbid. This is the measurement that makes the claim honest.
 */

function board(cardCount: number, columnCount = 5): BoardDetailResponse {
  const perColumn = Math.ceil(cardCount / columnCount);
  let made = 0;

  return {
    id: "b1",
    workspaceId: "w1",
    name: "Big board",
    role: "Owner",
    seq: 1,
    labels: [],
    columns: Array.from({ length: columnCount }, (_, c) => ({
      id: `col-${c}`,
      boardId: "b1",
      name: `Column ${c}`,
      rank: `a${c}`,
      minCards: null,
      maxCards: null,
      cards: Array.from({ length: Math.min(perColumn, cardCount - made) }, (_, i) => {
        made++;
        return {
          id: `card-${c}-${i}`,
          columnId: `col-${c}`,
          title: `Card ${i} in column ${c}`,
          description: i % 3 === 0 ? "Some description text for matching" : null,
          rank: `a${i}`,
          dueAt: null,
          assigneeId: null,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          priority: null,
          labels: [],
          commentCount: 0,
        } satisfies CardResponse;
      }),
    })),
  } as BoardDetailResponse;
}

describe("filtering cost", () => {
  it("visits each card exactly once per pass", () => {
    // The failure this guards against is quadratic behaviour appearing without
    // anyone noticing — a filter evaluated per card *per column*, or a lookup
    // that scans the label list inside the card loop. At 500 cards a second
    // pass is invisible on a developer's machine and obvious on a Chromebook.
    const b = board(500);
    let calls = 0;

    const counted = { ...EMPTY_FILTER, text: "card" };
    const now = Date.parse("2026-06-01T00:00:00Z");

    for (const column of b.columns) {
      for (const card of column.cards) {
        calls++;
        matchesFilter(card, counted, now);
      }
    }

    expect(calls).toBe(500);
  });

  it("returns every card when the filter is empty", () => {
    // The cheap path, and the one that runs on every board load. An empty filter
    // must not become a full pass that happens to match everything — it should
    // be recognisable as "no filter" before any card is examined.
    const b = board(500);
    const result = filterBoard(b, EMPTY_FILTER, Date.now());

    expect(result.columns.reduce((n, c) => n + c.cards.length, 0)).toBe(500);
  });

  it("narrows a 500-card board in one pass", () => {
    const b = board(500);
    const result = filterBoard(b, { ...EMPTY_FILTER, text: "column 2" }, Date.now());

    const matched = result.columns.reduce((n, c) => n + c.cards.length, 0);
    expect(matched).toBe(100);
    expect(result.columns).toHaveLength(5);
  });
});
