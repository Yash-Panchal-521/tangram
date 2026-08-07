// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CardDetailPanel } from "@/components/board/CardDetailPanel";
import type { CardResponse } from "@/lib/api";

afterEach(cleanup);

const CARD: CardResponse = {
  id: "card-1",
  columnId: "col-1",
  title: "Ship the thing",
  description: "With tests",
  rank: "a0",
};

function renderPanel(overrides: Partial<Parameters<typeof CardDetailPanel>[0]> = {}) {
  const onClose = vi.fn();
  const onSave = vi.fn(async () => {});
  const onDelete = vi.fn(async () => {});
  render(
    <CardDetailPanel
      card={CARD}
      readOnly={false}
      onClose={onClose}
      onSave={onSave}
      onDelete={onDelete}
      {...overrides}
    />
  );
  return { onClose, onSave, onDelete };
}

describe("CardDetailPanel — closing", () => {
  it("closes straight away when nothing has been edited", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel();

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("asks before discarding unsaved edits (S4.2)", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel();

    await user.type(screen.getByLabelText("Title"), "!");
    await user.keyboard("{Escape}");

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Discard your changes?")).toBeTruthy();
  });

  it("keeps the panel open when the guard is declined", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel();

    await user.type(screen.getByLabelText("Title"), "!");
    await user.keyboard("{Escape}");
    await user.click(screen.getByText("Keep editing"));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Title")).toBeTruthy();
  });

  it("closes once the guard is accepted", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel();

    await user.type(screen.getByLabelText("Title"), "!");
    await user.keyboard("{Escape}");
    await user.click(screen.getByText("Discard changes"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not let one Escape dismiss both the guard and the panel", async () => {
    // The regression the `paused` flag exists for: both dialogs listen on
    // document, so an un-paused panel would close underneath its own
    // confirmation -- discarding the edit the confirmation was protecting.
    const user = userEvent.setup();
    const { onClose } = renderPanel();

    await user.type(screen.getByLabelText("Title"), "!");
    await user.keyboard("{Escape}");
    await user.keyboard("{Escape}");

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Title")).toBeTruthy();
  });

  it("guards the overlay and the close button too, not just Escape", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel();

    await user.type(screen.getByLabelText("Title"), "!");
    await user.click(screen.getByLabelText("Close"));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Discard your changes?")).toBeTruthy();
  });
});

describe("CardDetailPanel — saving", () => {
  it("saves on Cmd/Ctrl+Enter from inside the description", async () => {
    const user = userEvent.setup();
    const { onSave } = renderPanel();

    const description = screen.getByLabelText("Description");
    await user.type(description, " and docs");
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(onSave).toHaveBeenCalledWith("Ship the thing", "With tests and docs");
  });

  it("ignores the shortcut when nothing has changed", async () => {
    const user = userEvent.setup();
    const { onSave } = renderPanel();

    await user.click(screen.getByLabelText("Title"));
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(onSave).not.toHaveBeenCalled();
  });

  it("refuses to save an empty title", async () => {
    const user = userEvent.setup();
    const { onSave } = renderPanel();

    await user.clear(screen.getByLabelText("Title"));
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(onSave).not.toHaveBeenCalled();
    expect((screen.getByText("Save") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows an unsaved marker as soon as the card diverges", async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(screen.queryByText("Unsaved")).toBeNull();
    await user.type(screen.getByLabelText("Title"), "!");
    expect(screen.getByText("Unsaved")).toBeTruthy();
  });
});

describe("CardDetailPanel — deleting", () => {
  it("confirms before deleting, naming the card (S4.2)", async () => {
    const user = userEvent.setup();
    const { onDelete } = renderPanel();

    await user.click(screen.getByText("Delete card"));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('Delete "Ship the thing"?')).toBeTruthy();
  });

  it("deletes once confirmed", async () => {
    const user = userEvent.setup();
    const { onDelete } = renderPanel();

    await user.click(screen.getByText("Delete card"));
    // Both the footer control and the confirmation say "Delete card", so this
    // has to name the dialog it means -- which is itself the point: the
    // confirmation repeats the verb rather than saying "OK" (S4.2).
    const confirmation = screen.getByRole("dialog", { name: 'Delete "Ship the thing"?' });
    await user.click(within(confirmation).getByText("Delete card"));

    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

describe("CardDetailPanel — read-only", () => {
  it("removes the actions rather than disabling them (S8.1)", () => {
    renderPanel({ readOnly: true });

    expect(screen.queryByText("Delete card")).toBeNull();
    expect(screen.queryByText("Save")).toBeNull();
    expect(screen.getByText("You have view-only access to this board.")).toBeTruthy();
  });

  it("keeps the text readable rather than greying it out", () => {
    renderPanel({ readOnly: true });

    const title = screen.getByLabelText("Title") as HTMLInputElement;
    expect(title.readOnly).toBe(true);
    expect(title.disabled).toBe(false);
  });
});
