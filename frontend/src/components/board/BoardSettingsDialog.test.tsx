// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardSettingsDialog } from "@/components/board/BoardSettingsDialog";
import type { ColumnWithCardsResponse } from "@/lib/api";

afterEach(cleanup);

function column(
  id: string,
  name: string,
  overrides: Partial<ColumnWithCardsResponse> = {}
): ColumnWithCardsResponse {
  return { id, name, rank: id, cards: [], minCards: null, maxCards: null, ...overrides };
}

const COLUMNS = [column("a", "To Do"), column("b", "Doing"), column("c", "Done")];

function mount(overrides: Partial<Parameters<typeof BoardSettingsDialog>[0]> = {}) {
  const onRename = vi.fn(async () => {});
  const onMove = vi.fn(async () => {});
  const onSetLimits = vi.fn(async () => {});
  const onDelete = vi.fn(async () => {});
  const onAdd = vi.fn(async () => {});
  const onClose = vi.fn();
  render(
    <BoardSettingsDialog
      columns={COLUMNS}
      connected
      onRename={onRename}
      onMove={onMove}
      onSetLimits={onSetLimits}
      onDelete={onDelete}
      onAdd={onAdd}
      onClose={onClose}
      {...overrides}
    />
  );
  return { onRename, onMove, onSetLimits, onDelete, onAdd, onClose };
}

describe("BoardSettingsDialog — reordering", () => {
  it("moves a column earlier by putting it before its neighbour", async () => {
    // The first UI for this at all: the move endpoint and the column.move
    // broadcast have both shipped since v1 with nothing calling them.
    const user = userEvent.setup();
    const { onMove } = mount();

    await user.click(screen.getByRole("button", { name: "Move Doing earlier" }));

    expect(onMove).toHaveBeenCalledWith("b", "a");
  });

  it("moves a column later past the one below it", async () => {
    // Two along, not one: the column being moved still occupies its old slot
    // in the list it is leaving, so "before the next one" would not move it.
    const user = userEvent.setup();
    const { onMove } = mount();

    await user.click(screen.getByRole("button", { name: "Move To Do later" }));

    expect(onMove).toHaveBeenCalledWith("a", "c");
  });

  it("sends null when a column moves to the end", async () => {
    const user = userEvent.setup();
    const { onMove } = mount();

    await user.click(screen.getByRole("button", { name: "Move Doing later" }));

    expect(onMove).toHaveBeenCalledWith("b", null);
  });

  it("cannot move the ends past themselves", () => {
    mount();

    expect(
      (screen.getByRole("button", { name: "Move To Do earlier" }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Move Done later" }) as HTMLButtonElement).disabled
    ).toBe(true);
  });
});

describe("BoardSettingsDialog — limits", () => {
  it("shows every column's limits together", () => {
    // A limit is a statement about flow through the whole board, and one
    // cannot be judged without the others — which is what the per-column menu
    // made impossible.
    mount({
      columns: [
        column("a", "To Do", { maxCards: 5, cards: [] }),
        column("b", "Doing", { maxCards: 2, cards: [] }),
      ],
    });

    expect((screen.getByLabelText("Maximum cards in To Do") as HTMLInputElement).value).toBe("5");
    expect((screen.getByLabelText("Maximum cards in Doing") as HTMLInputElement).value).toBe("2");
  });

  it("saves a limit on blur", async () => {
    const user = userEvent.setup();
    const { onSetLimits } = mount();

    await user.type(screen.getByLabelText("Maximum cards in Doing"), "4");
    await user.tab();

    await waitFor(() =>
      expect(onSetLimits).toHaveBeenCalledWith("b", {
        minCards: null,
        maxCards: 4,
        clearMinCards: true,
        clearMaxCards: false,
      })
    );
  });

  it("says nothing when a field is left exactly as it was", async () => {
    // Blur fires whether or not anything changed; a request per glance would
    // be a broadcast to everyone else's board for nothing.
    const user = userEvent.setup();
    const { onSetLimits } = mount({ columns: [column("a", "To Do", { maxCards: 3 })] });

    await user.click(screen.getByLabelText("Maximum cards in To Do"));
    await user.tab();

    expect(onSetLimits).not.toHaveBeenCalled();
  });

  it("holds back a pair that contradicts, rather than quietly swapping the numbers", async () => {
    // Started from a column that already has a maximum, because moving focus
    // from the minimum to the maximum blurs the first — and a minimum with no
    // maximum yet is a perfectly good save.
    const user = userEvent.setup();
    const { onSetLimits } = mount({ columns: [column("a", "To Do", { maxCards: 2 })] });

    await user.type(screen.getByLabelText("Minimum cards in To Do"), "9");
    await user.tab();

    expect(onSetLimits).not.toHaveBeenCalled();
  });

  it("refuses a negative at the field, since a minus sign there is a typo", async () => {
    const user = userEvent.setup();
    mount();

    await user.type(screen.getByLabelText("Maximum cards in To Do"), "-3");

    expect((screen.getByLabelText("Maximum cards in To Do") as HTMLInputElement).value).toBe("3");
  });
});

describe("BoardSettingsDialog — adding and removing", () => {
  it("adds a column and clears the field", async () => {
    const user = userEvent.setup();
    const { onAdd } = mount();

    await user.type(screen.getByLabelText("New column name"), "Review");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith("Review"));
    await waitFor(() =>
      expect((screen.getByLabelText("New column name") as HTMLInputElement).value).toBe("")
    );
  });

  it("will not add nothing", () => {
    mount();

    expect((screen.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("hands deleting to the caller, which is where the confirmation lives", async () => {
    const user = userEvent.setup();
    const { onDelete } = mount();

    await user.click(screen.getByRole("button", { name: "Delete Doing" }));

    expect(onDelete).toHaveBeenCalledWith("b");
  });

  it("says why when something is refused", async () => {
    const user = userEvent.setup();
    mount({
      onAdd: vi.fn(async () => {
        throw new Error("Can't reach Tangram right now.");
      }),
    });

    await user.type(screen.getByLabelText("New column name"), "Review");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Can't reach Tangram");
  });
});

describe("BoardSettingsDialog — offline", () => {
  it("keeps its controls visible but inert, because the connection is coming back (S8.1)", () => {
    mount({ connected: false });

    expect(
      (screen.getByRole("button", { name: "Move Doing earlier" }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect((screen.getByLabelText("New column name") as HTMLInputElement).disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Delete Doing" }) as HTMLButtonElement).disabled
    ).toBe(true);
  });
});

describe("BoardSettingsDialog — dismissal", () => {
  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const { onClose } = mount();

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
  });
});
