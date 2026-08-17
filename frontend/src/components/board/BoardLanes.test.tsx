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

function board(
  cardsByColumn: CardResponse[][],
  // Colour included: the lane header looks it up to tint the swatch, and a
  // fixture without one silently exercises the untinted path instead.
  labels: { id: string; name: string; color?: string }[] = []
) {
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
  {
    canEdit = true,
    members = MEMBERS,
    // Defaults to "nobody signed in", so a test that says nothing about
    // identity gets rows that make no claim about whose they are.
    currentUserId = null as string | null,
    roles,
  }: {
    canEdit?: boolean;
    members?: Map<string, string>;
    currentUserId?: string | null;
    roles?: Map<string, string>;
  } = {}
) {
  const { container } = render(
    <DndContext>
      <BoardLanes
        board={b}
        view={view}
        memberNames={members}
        onCardClick={vi.fn()}
        canEdit={canEdit}
        currentUserId={currentUserId}
        memberRoles={roles}
      />
    </DndContext>
  );
  return container;
}

/** Lane rows only — the column-head grid shares `border-b` but has no height. */
const laneRows = (c: HTMLElement) =>
  [...c.querySelectorAll("div.grid")].filter((r) => r.className.includes("min-h-[104px]"));

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
      { id: "l1", name: "bug", color: "red" },
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

describe("BoardLanes — telling one row from the next", () => {
  it("tints your own row, and not on a token the cards also use", () => {
    // The row you look for first. `surface-2` rather than `surface`: the cards
    // are `surface`, so tinting with the same token takes the ground out from
    // under them on exactly the row you read most.
    const c = mount(board([[card("a", { assigneeId: "u1" })]]), "person", {
      currentUserId: "u1",
    });
    const rows = laneRows(c);

    const [rita, unassigned] = rows;
    expect(rita.className).toContain("bg-surface-2");
    expect(rita.className).not.toMatch(/bg-surface(?!-2)/);
    expect(unassigned.className).not.toContain("bg-surface");
  });

  it("leaves every row plain when nobody is signed in", () => {
    const c = mount(board([[card("a", { assigneeId: "u1" })]]), "person", {
      members: MEMBERS,
    });
    const rows = laneRows(c);

    expect(rows.every((r) => !r.className.includes("bg-surface"))).toBe(true);
  });

  it("badges a person lane with their role", () => {
    const c = mount(board([[card("a", { assigneeId: "u1" })]]), "person", {
      roles: new Map([["u1", "Editor"]]),
    });

    expect(c.textContent).toContain("Editor");
  });

  it("gives a label lane a square swatch in the label's own colour", () => {
    // Shape says which kind of thing the row groups by before the name is read,
    // and the hue matches the dot the cards inside it carry.
    const b = board([[card("a", { labels: [{ id: "l1", name: "bug", color: "red" }] as never })]], [
      { id: "l1", name: "bug", color: "red" },
    ]);
    const c = mount(b, "label");

    const swatch = c.querySelector("span.w-7") as HTMLElement;
    expect(swatch.className).toContain("rounded-[2px]");
    expect(swatch.style.backgroundColor).toBeTruthy();
  });

  it("keeps person lanes round", () => {
    const c = mount(board([[card("a", { assigneeId: "u1" })]]), "person");

    const swatch = c.querySelector("span.w-7") as HTMLElement;
    expect(swatch.className).toContain("rounded-full");
  });
});

describe("BoardLanes — which cards may be picked up", () => {
  it("gives a card a handle in the label view too", () => {
    // It can only travel sideways there, but it can travel.
    const b = board([[card("a", { labels: [{ id: "l1", name: "bug", color: "red" }] as never })]], [
      { id: "l1", name: "bug", color: "red" },
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
