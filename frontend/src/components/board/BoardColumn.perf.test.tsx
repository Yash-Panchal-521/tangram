// @vitest-environment jsdom
import { Profiler } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BoardColumn } from "@/components/board/BoardColumn";
import type { CardResponse, ColumnWithCardsResponse } from "@/lib/api";

afterEach(cleanup);

/**
 * What a broadcast costs the board tree.
 *
 * v4 dropped "frontend rendering" from its scope because nothing measured said
 * it was slow — the exact reasoning P1.1 forbids. This is the measurement.
 *
 * Nothing on the board is memoised, so a broadcast that changes one card
 * re-renders every card in its column. That is not a defect by itself; React
 * re-rendering children when a parent re-renders is how React works, and
 * memoising has its own cost. The question is only whether the resulting work
 * is large enough to matter at a board size anyone will reach.
 *
 * These assert the *shape* — that a one-card change touches one column's worth
 * of cards and not the whole board twice over — rather than a duration. A
 * millisecond budget here would measure the CI runner, which is the same
 * objection that made the backend budgets count round trips (P2.1).
 */

function cards(n: number, columnId: string): CardResponse[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${columnId}-card-${i}`,
    columnId,
    title: `Card ${i}`,
    description: null,
    rank: `a${i}`,
    dueAt: null,
    assigneeId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    priority: null,
    labels: [],
    commentCount: 0,
  }));
}

function column(n: number): ColumnWithCardsResponse {
  return {
    id: "col-1",
    boardId: "b1",
    name: "To Do",
    rank: "a0",
    minCards: null,
    maxCards: null,
    cards: cards(n, "col-1"),
  } as ColumnWithCardsResponse;
}

function renderColumn(col: ColumnWithCardsResponse, onCommit: () => void) {
  return render(
    <Profiler id="column" onRender={onCommit}>
      <BoardColumn
        column={col}
        colorIndex={0}
        disabled={false}
        canEdit
        memberNames={{}}
        onAddCard={() => {}}
        onRenameColumn={() => {}}
        onSetLimits={() => {}}
        onDeleteColumn={() => {}}
        onCardClick={() => {}}
      />
    </Profiler>
  );
}

describe("board render cost", () => {
  it("draws every card it is given", () => {
    renderColumn(column(60), () => {});

    // Matched on the titles the cards actually render, rather than a test hook
    // — there is no data attribute on a card and adding one to be counted here
    // would be the test changing the component to suit itself.
    //
    // The cards are what scales. If this ever stops matching the input, the
    // column has started windowing and the numbers below mean something else.
    expect(screen.getAllByText(/^Card \d+$/)).toHaveLength(60);
  });

  it("commits once for a one-card change, not once per card", () => {
    // The failure this guards against is a re-render loop — an effect that sets
    // state on every render, or a prop rebuilt each pass that a child depends
    // on. Those turn one broadcast into dozens of commits and are invisible
    // until the board is large.
    let commits = 0;
    const col = column(60);
    const { rerender } = renderColumn(col, () => commits++);

    const afterMount = commits;

    const changed = {
      ...col,
      cards: col.cards.map((c, i) => (i === 0 ? { ...c, title: "Renamed" } : c)),
    };

    rerender(
      <Profiler id="column" onRender={() => commits++}>
        <BoardColumn
          column={changed}
          colorIndex={0}
          disabled={false}
          canEdit
          memberNames={{}}
          onAddCard={() => {}}
          onRenameColumn={() => {}}
          onSetLimits={() => {}}
          onDeleteColumn={() => {}}
          onCardClick={() => {}}
        />
      </Profiler>
    );

    expect(commits - afterMount).toBe(1);
  });
});
