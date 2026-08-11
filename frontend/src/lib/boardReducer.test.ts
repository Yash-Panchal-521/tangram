import { describe, expect, it } from "vitest";
import { applyOperation, moveCardOptimistic } from "@/lib/boardReducer";
import type { BoardDetailResponse, CardResponse } from "@/lib/api";

// Ranks are fractional/lexicographic strings, so ordering is by string compare,
// never by array position. "a" < "b" < "c" throughout.
function card(id: string, columnId: string, rank: string, title = id): CardResponse {
  return {
    id, columnId, title, description: null, rank, dueAt: null, assigneeId: null,
    createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
    priority: null,
    labels: [],
    commentCount: 0,
  };
}

function board(): BoardDetailResponse {
  return {
    id: "board-1",
    workspaceId: "ws-1",
    seq: 10,
    name: "Roadmap",
    role: "Editor",
    labels: [],
    columns: [
      {
        id: "todo",
        name: "To Do",
        rank: "a",
        cards: [card("c1", "todo", "a"), card("c2", "todo", "b")],
      },
      { id: "doing", name: "Doing", rank: "b", cards: [card("c3", "doing", "a")] },
    ],
  };
}

const ids = (b: BoardDetailResponse, columnId: string) =>
  b.columns.find((c) => c.id === columnId)!.cards.map((c) => c.id);

describe("applyOperation", () => {
  it("inserts a created card in rank order, not append order", () => {
    // Rank "aa" sorts between "a" and "b", so it must land in the middle even
    // though it arrives last.
    const next = applyOperation(board(), "card.create", card("new", "todo", "aa"));

    expect(ids(next, "todo")).toEqual(["c1", "new", "c2"]);
  });

  it("moves a card between columns, removing it from the old one", () => {
    const next = applyOperation(board(), "card.move", card("c1", "doing", "aa"));

    expect(ids(next, "todo")).toEqual(["c2"]);
    expect(ids(next, "doing")).toEqual(["c3", "c1"]);
  });

  it("renames in place without reordering", () => {
    const next = applyOperation(board(), "card.rename", {
      ...card("c1", "todo", "a"),
      title: "Renamed",
    });

    expect(ids(next, "todo")).toEqual(["c1", "c2"]);
    expect(next.columns[0].cards[0].title).toBe("Renamed");
  });

  it("deletes a card by id and column", () => {
    const next = applyOperation(board(), "card.delete", { id: "c1", columnId: "todo" });

    expect(ids(next, "todo")).toEqual(["c2"]);
  });

  it("inserts a created column in rank order", () => {
    const next = applyOperation(board(), "column.create", {
      id: "backlog",
      boardId: "board-1",
      name: "Backlog",
      rank: "aa",
    });

    expect(next.columns.map((c) => c.id)).toEqual(["todo", "backlog", "doing"]);
  });

  it("keeps existing cards when a column is renamed or moved", () => {
    // The broadcast payload for a column carries no cards, so a naive merge
    // would blank the column out.
    const next = applyOperation(board(), "column.rename", {
      id: "todo",
      boardId: "board-1",
      name: "Up Next",
      rank: "a",
    });

    expect(next.columns[0].name).toBe("Up Next");
    expect(ids(next, "todo")).toEqual(["c1", "c2"]);
  });

  it("reorders on column.move", () => {
    const next = applyOperation(board(), "column.move", {
      id: "todo",
      boardId: "board-1",
      name: "To Do",
      rank: "c",
    });

    expect(next.columns.map((c) => c.id)).toEqual(["doing", "todo"]);
  });

  it("deletes a column with its cards", () => {
    const next = applyOperation(board(), "column.delete", { id: "todo" });

    expect(next.columns.map((c) => c.id)).toEqual(["doing"]);
  });

  it("ignores unknown operation types rather than throwing", () => {
    // A client on an older deploy will receive op types it doesn't know. It
    // should no-op, not crash the board.
    const before = board();
    expect(applyOperation(before, "card.archive", { id: "c1" })).toEqual(before);
  });

  // Resync replays operations the client may already have applied, so every
  // operation has to be safe to apply twice.
  it.each([
    ["card.create", card("new", "todo", "aa")],
    ["card.move", card("c1", "doing", "aa")],
    ["card.rename", { ...card("c1", "todo", "a"), title: "Renamed" }],
    ["card.delete", { id: "c1", columnId: "todo" }],
    ["column.delete", { id: "todo" }],
  ])("is idempotent for %s", (opType, payload) => {
    const once = applyOperation(board(), opType, payload);
    const twice = applyOperation(once, opType, payload);

    expect(twice).toEqual(once);
  });

  it("does not mutate the board it was given", () => {
    const before = board();
    const snapshot = structuredClone(before);

    applyOperation(before, "card.delete", { id: "c1", columnId: "todo" });

    expect(before).toEqual(snapshot);
  });
});

describe("moveCardOptimistic", () => {
  it("places the card at the drop index, ignoring rank", () => {
    // The whole point: show the card where it was dropped immediately, before
    // the server has computed a rank for it.
    const next = moveCardOptimistic(board(), "c3", "todo", "c1");

    expect(ids(next, "todo")).toEqual(["c3", "c1", "c2"]);
    expect(ids(next, "doing")).toEqual([]);
  });

  it("appends when there is no card to insert before", () => {
    const next = moveCardOptimistic(board(), "c3", "todo", null);

    expect(ids(next, "todo")).toEqual(["c1", "c2", "c3"]);
  });

  it("reassigns the card's columnId", () => {
    const next = moveCardOptimistic(board(), "c3", "todo", null);

    expect(next.columns[0].cards.at(-1)!.columnId).toBe("todo");
  });

  it("returns the board unchanged for an unknown card", () => {
    const before = board();
    expect(moveCardOptimistic(before, "nope", "todo", null)).toEqual(before);
  });

  it("leaves the original intact so a failed move can roll back to it", () => {
    const before = board();
    const snapshot = structuredClone(before);

    moveCardOptimistic(before, "c3", "todo", "c1");

    expect(before).toEqual(snapshot);
  });

  it("is reconciled by the authoritative broadcast that follows", () => {
    // Drop c3 at the top of todo, then let the server's rank arrive. The
    // server put it last; the board must end up matching the server.
    const optimistic = moveCardOptimistic(board(), "c3", "todo", "c1");
    expect(ids(optimistic, "todo")).toEqual(["c3", "c1", "c2"]);

    const reconciled = applyOperation(optimistic, "card.move", card("c3", "todo", "c"));

    expect(ids(reconciled, "todo")).toEqual(["c1", "c2", "c3"]);
  });
});

describe("card depth carried through the reducer", () => {
  it("applies a due date and assignee arriving on card.rename", () => {
    // A due-date edit is still broadcast as card.rename -- the operations log
    // holds historical rows of that type that resync replays, so a new op type
    // would mean every client understanding both forever.
    const withDepth = applyOperation(board(), "card.rename", {
      ...card("c1", "todo", "a"),
      dueAt: "2026-09-15T00:00:00.000Z",
      assigneeId: "u-7",
    });

    const updated = withDepth.columns
      .flatMap((col) => col.cards)
      .find((c) => c.id === "c1")!;

    expect(updated.dueAt).toBe("2026-09-15T00:00:00.000Z");
    expect(updated.assigneeId).toBe("u-7");
  });

  it("clears them when the broadcast says they are gone, which is how undo lands", () => {
    const withDepth = applyOperation(board(), "card.rename", {
      ...card("c1", "todo", "a"),
      dueAt: "2026-09-15T00:00:00.000Z",
      assigneeId: "u-7",
    });

    const undone = applyOperation(withDepth, "card.rename", card("c1", "todo", "a"));
    const updated = undone.columns.flatMap((col) => col.cards).find((c) => c.id === "c1")!;

    expect(updated.dueAt).toBeNull();
    expect(updated.assigneeId).toBeNull();
  });

  it("keeps depth intact across a restore, which arrives as card.create", () => {
    // Undoing a delete re-broadcasts the card as a create carrying its original
    // id, so the reducer's replace-by-id is what makes restore work at all.
    const restored = applyOperation(board(), "card.create", {
      ...card("c9", "todo", "z"),
      dueAt: "2026-10-01T00:00:00.000Z",
      assigneeId: "u-3",
    });

    const back = restored.columns.flatMap((col) => col.cards).find((c) => c.id === "c9")!;
    expect(back.dueAt).toBe("2026-10-01T00:00:00.000Z");
    expect(back.assigneeId).toBe("u-3");
  });
});

describe("applyOperation — labels", () => {
  const label = (id: string, name: string) => ({ id, name, color: "red" as const });

  it("adds a label to the board's vocabulary", () => {
    const next = applyOperation(board(), "label.create", label("l-1", "Bug"));

    expect(next.labels.map((l) => l.name)).toEqual(["Bug"]);
  });

  it("replaces by id, so a rename is not a second label", () => {
    // Same reason every other op replaces by id: resync replays operations a
    // client may already have applied.
    const created = applyOperation(board(), "label.create", label("l-1", "Bug"));
    const renamed = applyOperation(created, "label.update", label("l-1", "Defect"));

    expect(renamed.labels).toHaveLength(1);
    expect(renamed.labels[0].name).toBe("Defect");
  });

  it("is idempotent, so replaying a create twice is harmless", () => {
    const once = applyOperation(board(), "label.create", label("l-1", "Bug"));
    const twice = applyOperation(once, "label.create", label("l-1", "Bug"));

    expect(twice.labels).toHaveLength(1);
  });

  it("keeps the vocabulary sorted, wherever a label arrives from", () => {
    let next = applyOperation(board(), "label.create", label("l-2", "Zebra"));
    next = applyOperation(next, "label.create", label("l-1", "Apple"));

    expect(next.labels.map((l) => l.name)).toEqual(["Apple", "Zebra"]);
  });

  it("strips a deleted label off every card carrying it", () => {
    // The server cascades the join rows but broadcasts one operation. Without
    // this the label would vanish from the picker and linger on the cards,
    // which reads as the delete half-working.
    const withLabel = applyOperation(board(), "label.create", label("l-1", "Bug"));
    const tagged = applyOperation(withLabel, "card.rename", {
      ...card("c1", "todo", "a"),
      labels: [label("l-1", "Bug")],
    });
    expect(tagged.columns[0].cards[0].labels).toHaveLength(1);

    const deleted = applyOperation(tagged, "label.delete", { id: "l-1" });

    expect(deleted.labels).toHaveLength(0);
    expect(deleted.columns.flatMap((c) => c.cards).every((c) => c.labels.length === 0)).toBe(true);
  });

  it("leaves an unknown label delete alone rather than throwing", () => {
    const next = applyOperation(board(), "label.delete", { id: "never-existed" });

    expect(next.labels).toEqual([]);
  });
});
