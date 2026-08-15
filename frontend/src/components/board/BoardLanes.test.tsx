// @vitest-environment jsdom
import { DndContext } from "@dnd-kit/core";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardLanes } from "@/components/board/BoardLanes";
import type { BoardDetailResponse, CardResponse } from "@/lib/api";

afterEach(cleanup);

/**
 * The wiring around `resolveLaneDrop`, which is the half that keeps breaking.
 *
 * `laneDrop.test.ts` covers what a drop *means* and has been right throughout;
 * both lane-drag defects were in the component that decides which cells and
 * cards are live in the first place. That had no test, so:
 *
 * - the label view shipped with every cell refusing drops, which cost it the
 *   ordinary sideways move as well as the lane change it meant to refuse, and
 * - the fix for that subscribed every cell to the drag and broke dropping
 *   everywhere.
 *
 * What this can and cannot do is worth being straight about. jsdom has no
 * layout, so every rect is zero and dnd-kit's collision detection can never
 * match — a real drag is not simulatable here, and the second defect above was
 * a render-cascade only a browser would show. These assert the contract that
 * *is* checkable: which crossings register as targets, and which cards carry a
 * handle. That is exactly the first defect, and it is the layer a future one is
 * most likely to land in.
 */

function card(id: string, over: Partial<CardResponse> = {}): CardResponse {
  return {
    id,
    columnId: "col-0",
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

const MEMBERS = new Map([["u1", "Rita Menon"]]);

function mount(
  b: BoardDetailResponse,
  view: "person" | "priority" | "label",
  { canEdit = true, members = MEMBERS } = {}
) {
  const { container } = render(
    <DndContext>
      <BoardLanes
        board={b}
        view={view}
        memberNames={members}
        onCardClick={vi.fn()}
        canEdit={canEdit}
      />
    </DndContext>
  );
  return container;
}

const cells = (c: HTMLElement) => [...c.querySelectorAll("[data-lane]")] as HTMLElement[];

describe("BoardLanes — where a card may be dropped", () => {
  it("registers a target at every crossing, not only where cards already are", () => {
    // An empty crossing is the useful one: it is how work reaches somebody who
    // has none, and how a card reaches a stage nothing is in yet.
    const c = mount(board([[card("a", { assigneeId: "u1" })], [], []]), "person");

    // Two lanes (Rita, Unassigned) times three columns.
    expect(cells(c)).toHaveLength(6);
  });

  it("keeps label cells live, because a sideways drop is still only a stage change", () => {
    // The defect this exists for. Labels refuse a *lane* change — a card can
    // carry several, so which one a drop would set has no answer — and that
    // refusal was applied to the whole cell, which took the horizontal axis
    // with it and left the view unable to move a card between columns at all.
    const b = board([[card("a", { labels: [{ id: "l1", name: "bug", color: "red" }] as never })], []], [
      { id: "l1", name: "bug" },
    ]);
    const c = mount(b, "label");

    expect(cells(c)).toHaveLength(2);
    // Live as drop targets, and none of them accepting a lane change.
    expect(cells(c).every((cell) => !cell.hasAttribute("data-accepts-lane-change"))).toBe(true);
  });

  it("marks person and priority lanes as taking a lane change", () => {
    const person = mount(board([[card("a", { assigneeId: "u1" })]]), "person");
    expect(cells(person).every((cell) => cell.hasAttribute("data-accepts-lane-change"))).toBe(true);
    cleanup();

    const priority = mount(board([[card("a")]]), "priority");
    expect(cells(priority).every((cell) => cell.hasAttribute("data-accepts-lane-change"))).toBe(
      true
    );
  });

  it("names each cell by its lane, so a drop knows which row it landed in", () => {
    const c = mount(board([[card("a", { assigneeId: "u1" })], []]), "person");

    expect(new Set(cells(c).map((cell) => cell.dataset.lane))).toEqual(
      new Set(["lane:person:u1", "lane:unassigned"])
    );
  });
});

describe("BoardLanes — which cards may be picked up", () => {
  it("gives a card a handle in the label view too", () => {
    // It can only travel sideways there, but it can travel.
    const b = board([[card("a", { labels: [{ id: "l1", name: "bug", color: "red" }] as never })]], [
      { id: "l1", name: "bug" },
    ]);
    const c = mount(b, "label");

    // dnd-kit renders `aria-disabled="false"` on a live draggable, so presence
    // says nothing — the value does.
    const handle = c.querySelector("[aria-roledescription]") as HTMLElement;
    expect(handle).not.toBeNull();
    expect(handle.getAttribute("aria-disabled")).toBe("false");
  });

  it("removes the handle for a viewer rather than disabling it (S8.1)", () => {
    const c = mount(board([[card("a", { assigneeId: "u1" })]]), "person", { canEdit: false });

    // The cell is still drawn — a viewer reads the matrix — but nothing in it
    // advertises a drag.
    expect(cells(c).length).toBeGreaterThan(0);
    expect(c.querySelector("[aria-roledescription]")).toBeNull();
  });
});
