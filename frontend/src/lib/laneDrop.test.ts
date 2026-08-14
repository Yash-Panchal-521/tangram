import { describe, expect, it } from "vitest";
import { cellId, parseCellId, resolveLaneDrop } from "@/lib/laneDrop";
import type { CardResponse } from "@/lib/api";

const card = (over: Partial<CardResponse> = {}) =>
  ({
    id: "card-1",
    columnId: "col-1",
    title: "Fix the collation bug",
    assigneeId: null,
    priority: null,
    labels: [],
    ...over,
  }) as CardResponse;

describe("cell ids", () => {
  it("survives a lane id that contains colons", () => {
    // `lane:person:{uuid}` has three segments, so splitting from the left would
    // put half the lane id into the column id and silently drop cards into the
    // wrong stage.
    const id = cellId("lane:person:9f1c-42", "col-7");

    expect(parseCellId(id)).toEqual({ laneId: "lane:person:9f1c-42", columnId: "col-7" });
  });

  it("refuses anything that is not a cell", () => {
    expect(parseCellId("column:col-1")).toBeNull();
    expect(parseCellId("cell:")).toBeNull();
  });
});

describe("resolveLaneDrop", () => {
  const base = { view: "person" as const, laneName: "Rita Menon" };

  it("does nothing when the card is dropped where it already was", () => {
    // The most common way a drag ends. It must not raise a confirmation asking
    // whether to assign somebody work they already have.
    expect(
      resolveLaneDrop({
        ...base,
        card: card({ assigneeId: "u1" }),
        fromLaneId: "lane:person:u1",
        toLaneId: "lane:person:u1",
        toColumnId: "col-1",
      })
    ).toBeNull();
  });

  it("moves between stages without asking", () => {
    // Sideways is the ordinary kanban action and the column board has never
    // confirmed it. Adding a dialog here would make the matrix worse than the
    // view it sits beside.
    const drop = resolveLaneDrop({
      ...base,
      card: card({ assigneeId: "u1" }),
      fromLaneId: "lane:person:u1",
      toLaneId: "lane:person:u1",
      toColumnId: "col-2",
    });

    expect(drop).toEqual({ targetColumnId: "col-2", update: null, confirm: null });
  });

  it("confirms before reassigning, and names who gets it", () => {
    const drop = resolveLaneDrop({
      ...base,
      card: card({ assigneeId: "u1" }),
      fromLaneId: "lane:person:u1",
      toLaneId: "lane:person:u2",
      toColumnId: "col-1",
    });

    expect(drop?.update).toEqual({ assigneeId: "u2" });
    expect(drop?.confirm?.body).toContain("Rita Menon");
    // S4.2: the sentence names the card, not just the action.
    expect(drop?.confirm?.body).toContain("Fix the collation bug");
    // Stage unchanged, so no move is sent alongside it.
    expect(drop?.targetColumnId).toBeNull();
  });

  it("carries both changes when a drop crosses a row and a column", () => {
    const drop = resolveLaneDrop({
      ...base,
      card: card({ assigneeId: "u1" }),
      fromLaneId: "lane:person:u1",
      toLaneId: "lane:person:u2",
      toColumnId: "col-3",
    });

    expect(drop?.targetColumnId).toBe("col-3");
    expect(drop?.update).toEqual({ assigneeId: "u2" });
  });

  it("clears the assignee for the unassigned lane, rather than assigning nobody", () => {
    // `assigneeId: null` would be indistinguishable from "not mentioned" once
    // it is JSON, which is why the API has explicit clear flags.
    const drop = resolveLaneDrop({
      ...base,
      card: card({ assigneeId: "u1" }),
      fromLaneId: "lane:person:u1",
      toLaneId: "lane:unassigned",
      toColumnId: "col-1",
      laneName: "Unassigned",
    });

    expect(drop?.update).toEqual({ clearAssignee: true });
    expect(drop?.confirm?.confirmLabel).toBe("Unassign");
  });

  it("sets and clears priority the same way", () => {
    const set = resolveLaneDrop({
      card: card(),
      fromLaneId: "lane:no-priority",
      toLaneId: "lane:priority:High",
      toColumnId: "col-1",
      view: "priority",
      laneName: "High",
    });
    expect(set?.update).toEqual({ priority: "High" });
    expect(set?.confirm?.body).toContain("High priority");

    const cleared = resolveLaneDrop({
      card: card({ priority: "High" as never }),
      fromLaneId: "lane:priority:High",
      toLaneId: "lane:no-priority",
      toColumnId: "col-1",
      view: "priority",
      laneName: "No priority",
    });
    expect(cleared?.update).toEqual({ clearPriority: true });
  });

  it("refuses a label lane entirely", () => {
    // A card can carry several labels, so a drop would also have to decide what
    // happens to the ones it already has. The lane view marks these
    // undroppable; this is the second line of defence.
    const drop = resolveLaneDrop({
      card: card(),
      fromLaneId: "lane:label:l1",
      toLaneId: "lane:label:l2",
      toColumnId: "col-1",
      view: "label",
      laneName: "urgent",
    });

    expect(drop).toBeNull();
  });

  it("falls back to a readable phrase for an untitled card", () => {
    const drop = resolveLaneDrop({
      ...base,
      card: card({ title: "   " }),
      fromLaneId: "lane:unassigned",
      toLaneId: "lane:person:u2",
      toColumnId: "col-1",
    });

    expect(drop?.confirm?.body).toContain("this card");
    expect(drop?.confirm?.body).not.toContain("“”");
  });
});
