// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DndContext } from "@dnd-kit/core";
import { BoardColumn } from "@/components/board/BoardColumn";
import type { CardResponse, ColumnWithCardsResponse } from "@/lib/api";

afterEach(cleanup);

function card(id: string, title: string, extra: Partial<CardResponse> = {}): CardResponse {
  return {
    id,
    columnId: "col-1",
    title,
    description: null,
    rank: "a0",
    dueAt: null,
    assigneeId: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    priority: null,
    labels: [],
    commentCount: 0,
    ...extra,
  };
}

function column(cards: CardResponse[] = []): ColumnWithCardsResponse {
  return { id: "col-1", name: "To Do", rank: "a0", minCards: null, maxCards: null, cards };
}

function renderColumn(overrides: Partial<Parameters<typeof BoardColumn>[0]> = {}) {
  const onAddCard = vi.fn(async () => {});
  const onRenameColumn = vi.fn(async () => {});
  const onSetLimits = vi.fn(async () => {});
  const onDeleteColumn = vi.fn(async () => {});
  const onCardClick = vi.fn();

  render(
    // A real DndContext, because useDroppable/useSortable need one.
    <DndContext>
      <BoardColumn
        column={column()}
        colorIndex={0}
        disabled={false}
        canEdit
        onAddCard={onAddCard}
        onRenameColumn={onRenameColumn}
        onSetLimits={onSetLimits}
        onDeleteColumn={onDeleteColumn}
        onCardClick={onCardClick}
        {...overrides}
      />
    </DndContext>
  );

  return { onAddCard, onRenameColumn, onSetLimits, onDeleteColumn, onCardClick };
}

describe("BoardColumn — empty state", () => {
  it("names the column as a drop target for someone who can edit (S2.3)", () => {
    renderColumn();
    // An empty column used to be blank space, so a dragged card had nothing to
    // aim at.
    expect(screen.getByText("Empty — add a card, or drag one here.")).toBeTruthy();
  });

  it("tells a viewer it is empty without suggesting an action they can't take", () => {
    renderColumn({ canEdit: false });

    expect(screen.getByText("No cards in this column.")).toBeTruthy();
    expect(screen.queryByText(/add a card/i)).toBeNull();
  });

  it("disappears once the column has cards", () => {
    renderColumn({ column: column([card("c1", "Something")]) });

    expect(screen.queryByText(/Empty —/)).toBeNull();
    expect(screen.getByText("Something")).toBeTruthy();
  });
});

describe("BoardColumn — card limits", () => {
  it("shows the count as a fraction of the maximum", () => {
    renderColumn({ column: { ...column([card("c-1", "Card 1"), card("c-2", "Card 2")]), maxCards: 5 } });

    expect(screen.getByText("2/5")).toBeTruthy();
  });

  it("marks a column over its maximum, in words as well as colour (S5.2)", () => {
    // Colour alone fails for anyone who cannot tell red from amber, and again
    // for anyone never told what these colours mean here.
    renderColumn({
      column: { ...column([card("c-1", "Card 1"), card("c-2", "Card 2"), card("c-3", "Card 3")]), maxCards: 2 },
    });

    expect(screen.getByText(/Over the limit/)).toBeTruthy();
  });

  it("marks a column under its minimum", () => {
    renderColumn({ column: { ...column([card("c-1", "Card 1")]), minCards: 3 } });

    expect(screen.getByText(/Under the minimum/)).toBeTruthy();
  });

  it("says nothing at the limit exactly", () => {
    // Off by one here lights up every full column on the board.
    renderColumn({ column: { ...column([card("c-1", "Card 1"), card("c-2", "Card 2")]), maxCards: 2 } });

    expect(screen.queryByText(/Over the limit|Under the minimum/)).toBeNull();
  });

  it("counts what the column holds, not what a filter leaves", () => {
    // A limit is about the work in a stage; a filter is one person looking at
    // part of it. Reading the filtered count would tell four people four
    // different things about the same column.
    renderColumn({
      column: { ...column([card("c-1", "Card 1")]), maxCards: 2 },
      totalCards: 9,
      filtering: true,
    });

    expect(screen.getByText(/Over the limit/)).toBeTruthy();
  });

  it("offers the limits dialog from the menu", async () => {
    const user = userEvent.setup();
    renderColumn();

    await user.click(screen.getByRole("button", { name: "Column actions for To Do" }));
    await user.click(screen.getByRole("menuitem", { name: "Set card limits" }));

    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("gives a viewer the signal but no way to change it (S8.1)", () => {
    renderColumn({
      canEdit: false,
      column: { ...column([card("c-1", "Card 1"), card("c-2", "Card 2"), card("c-3", "Card 3")]), maxCards: 1 },
    });

    expect(screen.getByText(/Over the limit/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Column actions/ })).toBeNull();
  });
});

describe("BoardColumn — actions menu", () => {
  it("keeps rename and delete visible instead of revealing them on hover", async () => {
    // Delete used to appear only once the pointer was over the column, so it
    // was discoverable by accident and unreachable without a mouse.
    const user = userEvent.setup();
    renderColumn();

    const trigger = screen.getByRole("button", { name: "Column actions for To Do" });
    expect(trigger).toBeTruthy();

    await user.click(trigger);
    expect(screen.getByRole("menuitem", { name: "Rename column" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete column" })).toBeTruthy();
  });

  it("deletes through the menu", async () => {
    // Never covered before the control moved, which is how it stayed untested.
    const user = userEvent.setup();
    const { onDeleteColumn } = renderColumn();

    await user.click(screen.getByRole("button", { name: "Column actions for To Do" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete column" }));

    expect(onDeleteColumn).toHaveBeenCalledWith("col-1");
  });

  it("opens the rename field from the menu", async () => {
    const user = userEvent.setup();
    renderColumn();

    await user.click(screen.getByRole("button", { name: "Column actions for To Do" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename column" }));

    expect(screen.getByLabelText("Rename column To Do")).toBeTruthy();
  });

  it("gives a viewer no menu at all, rather than a disabled one (S8.1)", () => {
    renderColumn({ canEdit: false });

    expect(screen.queryByRole("button", { name: "Column actions for To Do" })).toBeNull();
  });

  it("keeps the menu inert while the connection is down, because it is coming back", () => {
    renderColumn({ disabled: true });

    const trigger = screen.getByRole("button", { name: "Column actions for To Do" });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("BoardColumn — rename", () => {
  it("is a real button, so it is tabbable and keyboard-activatable (S5.1)", async () => {
    const user = userEvent.setup();
    renderColumn();

    const trigger = screen.getByRole("button", { name: "Rename column To Do" });
    expect(trigger.tagName).toBe("BUTTON");

    await user.click(trigger);
    expect(screen.getByLabelText("Rename column To Do")).toBeTruthy();
  });

  it("commits on submit", async () => {
    const user = userEvent.setup();
    const { onRenameColumn } = renderColumn();

    await user.click(screen.getByRole("button", { name: "Rename column To Do" }));
    const field = screen.getByLabelText("Rename column To Do");
    await user.clear(field);
    await user.type(field, "In Progress{Enter}");

    await waitFor(() => expect(onRenameColumn).toHaveBeenCalledWith("col-1", "In Progress"));
  });

  it("discards on Escape instead of letting blur commit it", async () => {
    // Escape leaves the field, which fires onBlur, and onBlur commits -- so
    // without the guard, cancelling would save the very edit it discarded.
    const user = userEvent.setup();
    const { onRenameColumn } = renderColumn();

    await user.click(screen.getByRole("button", { name: "Rename column To Do" }));
    const field = screen.getByLabelText("Rename column To Do");
    await user.clear(field);
    await user.type(field, "Should not persist{Escape}");

    expect(onRenameColumn).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Rename column To Do" })).toBeTruthy();
  });

  it("becomes plain text for a viewer rather than a disabled button (S8.1)", () => {
    renderColumn({ canEdit: false });

    expect(screen.queryByRole("button", { name: /Rename column/ })).toBeNull();
    expect(screen.getByText("To Do")).toBeTruthy();
  });

  it("disables rather than removes while the connection is down", () => {
    // Transient, not permanent: the ability is coming back.
    renderColumn({ disabled: true });

    const trigger = screen.getByRole("button", { name: "Rename column To Do" });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
  });
});


describe("BoardColumn — adding a card", () => {
  it("shows a placeholder while the create is in flight, then clears it", async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    const onAddCard = vi.fn(
      () => new Promise<void>((resolve) => (release = resolve))
    );
    renderColumn({ onAddCard });

    await user.click(screen.getByRole("button", { name: /Add card/ }));
    await user.type(screen.getByPlaceholderText("Card title"), "Pending one{Enter}");

    // Creates aren't optimistic -- the server assigns the id and rank -- so a
    // placeholder is the honest version of "on its way".
    await waitFor(() => expect(screen.getByText("Adding…")).toBeTruthy());
    expect(screen.getByText("Pending one")).toBeTruthy();

    release();
    await waitFor(() => expect(screen.queryByText("Adding…")).toBeNull());
  });

  it("refuses to submit an empty title", async () => {
    const user = userEvent.setup();
    const { onAddCard } = renderColumn();

    await user.click(screen.getByRole("button", { name: /Add card/ }));
    await user.type(screen.getByPlaceholderText("Card title"), "   {Enter}");

    expect(onAddCard).not.toHaveBeenCalled();
  });

  it("opens itself when the introduction hands the user over", async () => {
    renderColumn({ startAdding: true });

    await waitFor(() => expect(screen.getByPlaceholderText("Card title")).toBeTruthy());
  });

  it("gives a viewer no way to add at all", () => {
    renderColumn({ canEdit: false });
    expect(screen.queryByRole("button", { name: /Add card/ })).toBeNull();
  });
});

describe("BoardColumn — assignees on cards", () => {
  it("resolves an assignee id through the roster it is given", () => {
    renderColumn({
      column: column([card("c1", "Assigned", { assigneeId: "u-9" })]),
      memberNames: new Map([["u-9", "Sara R."]]),
    });

    expect(screen.getByText("SR")).toBeTruthy();
  });

  it("shows nothing for an assignee who has left the workspace", () => {
    renderColumn({
      column: column([card("c1", "Orphaned", { assigneeId: "gone" })]),
      memberNames: new Map(),
    });

    expect(screen.getByText("Orphaned")).toBeTruthy();
    expect(screen.queryByTitle(/gone/)).toBeNull();
  });
});
