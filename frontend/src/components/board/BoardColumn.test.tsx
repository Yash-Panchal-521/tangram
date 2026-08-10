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
    ...extra,
  };
}

function column(cards: CardResponse[] = []): ColumnWithCardsResponse {
  return { id: "col-1", name: "To Do", rank: "a0", cards };
}

function renderColumn(overrides: Partial<Parameters<typeof BoardColumn>[0]> = {}) {
  const onAddCard = vi.fn(async () => {});
  const onRenameColumn = vi.fn(async () => {});
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
        onDeleteColumn={onDeleteColumn}
        onCardClick={onCardClick}
        {...overrides}
      />
    </DndContext>
  );

  return { onAddCard, onRenameColumn, onDeleteColumn, onCardClick };
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

describe("BoardColumn — delete", () => {
  it("stays focusable while visually hidden (S5.1)", () => {
    renderColumn();

    // `hidden` can't take focus, which made delete mouse-only; the reveal lives
    // on a wrapper so the button itself is always in the tab order.
    const button = screen.getByRole("button", { name: "Delete column To Do" });
    button.focus();
    expect(document.activeElement).toBe(button);
    expect((button.parentElement as HTMLElement).className).toContain("focus-within:opacity-100");
  });

  it("is absent for a viewer", () => {
    renderColumn({ canEdit: false });
    expect(screen.queryByRole("button", { name: /Delete column/ })).toBeNull();
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
