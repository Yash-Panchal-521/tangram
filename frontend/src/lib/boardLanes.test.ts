import { describe, expect, it } from "vitest";
import { lanesFor, visibleLanes } from "@/lib/boardLanes";
import type { BoardDetailResponse, CardResponse } from "@/lib/api";

function card(id: string, over: Partial<CardResponse> = {}): CardResponse {
  return {
    id,
    columnId: "c1",
    title: id,
    description: null,
    rank: "a0",
    dueAt: null,
    assigneeId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    priority: null,
    labels: [],
    commentCount: 0,
    ...over,
  } as CardResponse;
}

function board(cardsByColumn: CardResponse[][], labels: { id: string; name: string }[] = []) {
  return {
    id: "b1",
    workspaceId: "w1",
    name: "Board",
    role: "Owner",
    seq: 1,
    labels,
    columns: cardsByColumn.map((cards, i) => ({
      id: `col-${i}`,
      boardId: "b1",
      name: `Column ${i}`,
      rank: `a${i}`,
      minCards: null,
      maxCards: null,
      cards,
    })),
  } as unknown as BoardDetailResponse;
}

const NO_MEMBERS = new Map<string, string>();

describe("lanesFor", () => {
  it("returns nothing for the column view", () => {
    // `status` is the board that already existed. Grouping it into rows would
    // be grouping it by the thing the columns already are.
    expect(lanesFor(board([[card("a")]]), "status", NO_MEMBERS)).toEqual([]);
  });

  it("keeps a card at the crossing of its lane and its column", () => {
    const b = board([[card("a", { assigneeId: "u1" })], [card("b", { assigneeId: "u1" })]]);
    const [lane] = lanesFor(b, "person", new Map([["u1", "Rita"]]));

    expect(lane.cells).toHaveLength(2);
    expect(lane.cells[0].map((c) => c.id)).toEqual(["a"]);
    expect(lane.cells[1].map((c) => c.id)).toEqual(["b"]);
    expect(lane.count).toBe(2);
  });

  it("gives every member a lane, even with no work", () => {
    // The empty row is the point of this view: it says who is free. Dropping it
    // would make "nobody is on this" indistinguishable from "this person does
    // not exist".
    const lanes = lanesFor(board([[]]), "person", new Map([["u1", "Rita"], ["u2", "Sam"]]));

    expect(lanes.map((l) => l.name)).toEqual(["Rita", "Sam", "Unassigned"]);
    expect(visibleLanes(lanes, "person")).toHaveLength(3);
  });

  it("collects unassigned work in its own lane", () => {
    const lanes = lanesFor(board([[card("a")]]), "person", NO_MEMBERS);
    const unassigned = lanes.find((l) => l.name === "Unassigned");

    expect(unassigned?.count).toBe(1);
  });

  it("puts a card carrying two labels in both lanes", () => {
    // The decision this module is built around. Choosing the first label would
    // make the board lie about where the work is; showing it in neither would
    // hide it. The cost is a card on screen twice, which is why the label view
    // refuses drops.
    const b = board(
      [[card("a", { labels: [{ id: "l1", name: "bug", color: "red" }, { id: "l2", name: "urgent", color: "amber" }] as never })]],
      [{ id: "l1", name: "bug" }, { id: "l2", name: "urgent" }]
    );
    const lanes = visibleLanes(lanesFor(b, "label", NO_MEMBERS), "label");

    expect(lanes.map((l) => l.name)).toEqual(["bug", "urgent"]);
    expect(lanes.every((l) => l.cells[0][0].id === "a")).toBe(true);
  });

  it("refuses lane changes in the label view and accepts them everywhere else", () => {
    // Only the vertical axis. Moving sideways is a stage change, which every
    // lane allows however the board is grouped — this flag once said otherwise
    // and cost the label view ordinary kanban entirely.
    const b = board([[card("a", { assigneeId: "u1", priority: "High" as never })]], [{ id: "l1", name: "bug" }]);

    expect(lanesFor(b, "person", new Map([["u1", "Rita"]])).every((l) => l.acceptsLaneChange)).toBe(true);
    expect(lanesFor(b, "priority", NO_MEMBERS).every((l) => l.acceptsLaneChange)).toBe(true);
    expect(lanesFor(b, "label", NO_MEMBERS).every((l) => !l.acceptsLaneChange)).toBe(true);
  });

  it("orders priority lanes by urgency, not by what the cards happen to be", () => {
    // A board where only Low is used must still show Low where Low belongs, so
    // that two boards grouped the same way read the same way.
    const lanes = lanesFor(board([[card("a", { priority: "Low" as never })]]), "priority", NO_MEMBERS);

    expect(lanes.map((l) => l.name)).toEqual([
      "Highest",
      "High",
      "Medium",
      "Low",
      "Lowest",
      "No priority",
    ]);
  });

  it("keeps every priority lane, so a card can be dragged into an unused level", () => {
    // The reason is the drop target, not the tidiness. Hiding unused levels
    // meant a card could only be dragged to High once something was already
    // High — the handle was there and the gesture did nothing.
    const lanes = lanesFor(board([[card("a", { priority: "Low" as never })]]), "priority", NO_MEMBERS);

    expect(visibleLanes(lanes, "priority").map((l) => l.name)).toEqual([
      "Highest",
      "High",
      "Medium",
      "Low",
      "Lowest",
      "No priority",
    ]);
  });

  it("still drops empty label lanes, which nothing can be dragged into anyway", () => {
    const b = board(
      [[card("a", { labels: [{ id: "l1", name: "bug", color: "red" }] as never })]],
      [{ id: "l1", name: "bug" }, { id: "l2", name: "unused" }]
    );

    expect(visibleLanes(lanesFor(b, "label", NO_MEMBERS), "label").map((l) => l.name)).toEqual(["bug"]);
  });

  it("counts a multi-label card once per lane, not once overall", () => {
    // Each lane's count is what that row holds. A card in two rows contributes
    // to both, and a total across rows will exceed the number of cards — which
    // is correct and worth being explicit about.
    const b = board(
      [[card("a", { labels: [{ id: "l1", name: "bug", color: "red" }, { id: "l2", name: "urgent", color: "amber" }] as never })]],
      [{ id: "l1", name: "bug" }, { id: "l2", name: "urgent" }]
    );
    const lanes = visibleLanes(lanesFor(b, "label", NO_MEMBERS), "label");

    expect(lanes.map((l) => l.count)).toEqual([1, 1]);
  });
});
